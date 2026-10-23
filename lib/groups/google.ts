// Admin SDK Directory API, the slice /groups needs. The caller injects fetch
// and a token source (lib/groups/google-auth.ts), which keeps this file free
// of credentials and testable with a fake fetch.
//
// The service account holds a custom admin role (GROUPS_RETRIEVE +
// GROUPS_UPDATE) over every group in the domain. Which groups the portal may
// touch is decided by lib/groups/scope.ts, not by Google; everything here
// only ever creates or deletes MEMBER rows，see isPlainMember.
//
// Two things Google taught us the hard way (2026-10-19):
//   * As a service account, `customer=my_customer` is a 400; ask by domain.
//   * Looking a member up by email is unreliable: GET members/{email} 404s
//     for some outside addresses that are on the list, and hasMember 400s.
//     So removal lists the members, matches the address itself, and deletes
//     by the member's id.

import { isPlainMember } from "@/lib/groups/plan"
import type { GroupMember, ManagedGroup } from "@/lib/groups/types"

const BASE = "https://admin.googleapis.com/admin/directory/v1"
const PAGE_SIZE = "200"

export type GroupsApi = {
  fetch: typeof fetch
  token: () => Promise<string>
  /** The Workspace domain, e.g. "winlab.tw". */
  domain: string
  /** Per-request deadline in ms. Default CALL_TIMEOUT_MS. */
  timeoutMs?: number
  /** Clock and sleep, injectable so tests need no real timers. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /**
   * Absolute time (per `now`) that bounds the whole action. No Google call
   * (token acquisition included) starts after it, a retry that would sleep
   * past it is not made, and each call's timeout is cut to what is left.
   */
  deadline?: number
}

/** One Directory call gets this long before it is abandoned. */
export const CALL_TIMEOUT_MS = 15_000
/** A POST/DELETE is not started with less than this left of the deadline. */
export const MIN_WRITE_BUDGET_MS = 3_000
/** Attempts at a rate-limited call, the first included. */
const MAX_ATTEMPTS = 3
const BACKOFF_MS = 1000
const RATE_LIMIT_REASONS = new Set([
  "userRateLimitExceeded",
  "rateLimitExceeded",
  "quotaExceeded",
])

/** Google answered with a status this module does not treat as an outcome. */
export class GoogleGroupsError extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
    /** Google's `error.errors[0].reason`, e.g. "rateLimitExceeded". */
    readonly reason?: string
  ) {
    super(`google groups failed: ${status}${detail ? `，${detail}` : ""}`)
    this.name = "GoogleGroupsError"
  }
}

/**
 * Google's retryable throttling. It answers 403 (or 429) with a rate-limit
 * reason; that is not a broken credential and must not stop a batch.
 */
export function isRateLimited(err: unknown): boolean {
  return (
    err instanceof GoogleGroupsError &&
    (err.status === 429 ||
      (err.status === 403 &&
        err.reason !== undefined &&
        RATE_LIMIT_REASONS.has(err.reason)))
  )
}

/**
 * A call got no answer in time. For a write (`mayHaveLanded`) whether Google
 * applied it is unknown; for a read, or while still getting a token (nothing
 * was sent yet), nothing can have changed and the message says so.
 */
export class GoogleTimeoutError extends Error {
  constructor(readonly mayHaveLanded = true) {
    super(
      mayHaveLanded
        ? "Google 沒有在時限內回應，結果未知（可能已經套用），請重新整理確認"
        : "Google 沒有在時限內回應，請稍後再試"
    )
    this.name = "GoogleTimeoutError"
  }
}

/**
 * The action's deadline had passed, so this call was not started. Nothing
 * was sent for it, which makes it a pre-send failure like a token timeout.
 */
export class GoogleDeadlineError extends Error {
  constructor() {
    super("處理太久，已停止，這個步驟沒有送出")
    this.name = "GoogleDeadlineError"
  }
}

/** No Google access token could be had (WIF, STS or impersonation failed). */
export class GroupsCredentialError extends Error {
  /**
   * `message` is safe to show a manager; `cause` (the STS / IAM error) is
   * for the server log only.
   */
  constructor(
    message: string,
    readonly cause?: string
  ) {
    super(message)
    this.name = "GroupsCredentialError"
  }
}

type RawGroup = { id?: string; email?: string; name?: string }
type RawMember = {
  id?: string
  email?: string
  role?: string
  type?: string
  status?: string
}

/** `promise`, or a rejection as soon as `signal` aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      // Nobody will read the late result; keep it from being unhandled.
      promise.catch(() => {})
      return reject(signal.reason)
    }
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(e)
      }
    )
  })
}

async function attempt(
  api: GroupsApi,
  path: string,
  init?: RequestInit
): Promise<Response> {
  // The deadline bounds everything: past it nothing starts (not even the
  // token), and a call gets the shorter of its own timeout and what is left.
  let timeoutMs = api.timeoutMs ?? CALL_TIMEOUT_MS
  const writes = init?.method === "POST" || init?.method === "DELETE"
  if (api.deadline !== undefined) {
    const left = api.deadline - (api.now ?? Date.now)()
    // A write that starts with almost nothing left would near-certainly
    // abort and then read as "result unknown"; refuse it before anything is
    // sent instead. Reads keep the plain rule.
    if (left <= 0 || (writes && left < MIN_WRITE_BUDGET_MS))
      throw new GoogleDeadlineError()
    timeoutMs = Math.min(timeoutMs, left)
  }
  const timer = AbortSignal.timeout(timeoutMs)
  const signal = init?.signal ? AbortSignal.any([init.signal, timer]) : timer
  // Getting the token counts against the same deadline: a stalled STS / IAM
  // exchange must not hang the action. Nothing has been sent yet, so a
  // timeout here cannot have changed anything. Whichever settles first
  // wins: a credential error that arrives after the timer fired is dropped
  // and the call reads as the timeout.
  let token: string
  try {
    token = await raceAbort(api.token(), timer)
  } catch (err) {
    if (timer.aborted) throw new GoogleTimeoutError(false)
    throw err
  }
  // A slow token can eat the margin checked above: look again before the
  // write goes out. Nothing has been sent, so this is a plain deadline.
  if (writes && api.deadline !== undefined) {
    const left = api.deadline - (api.now ?? Date.now)()
    if (left < MIN_WRITE_BUDGET_MS) throw new GoogleDeadlineError()
  }
  try {
    return await api.fetch(`${BASE}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal,
    })
  } catch (err) {
    if (timer.aborted) throw new GoogleTimeoutError(writes)
    throw err
  }
}

/**
 * A reply's JSON. The call's timer also covers reading the body, and an
 * abort there surfaces as a DOMException; it is the read timeout, not an
 * unexpected error. (Only used for reads, so nothing may have changed.)
 */
async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    )
      throw new GoogleTimeoutError(false)
    throw err
  }
}

/** Google's reason for an error reply, read from a copy of the response. */
async function reasonOf(res: Response): Promise<string | undefined> {
  try {
    const parsed = (await res.clone().json()) as {
      error?: { errors?: { reason?: string }[] }
    }
    return parsed.error?.errors?.[0]?.reason
  } catch {
    return undefined
  }
}

// Throttled calls (403/429 with a rate-limit reason) are retried with
// backoff and jitter, never past api.deadline. GET is plain idempotent; a
// repeated member POST answers 409, which addMember reads as "already".
// DELETE is never retried here: removeMember checked the member's role just
// before it, and a promotion during the backoff would make the retry delete
// an OWNER. A throttled DELETE was not applied, so it surfaces as the
// throttling error and the caller decides. Once attempts run out the
// throttled reply is returned for the caller's fail() like any other.
async function call(
  api: GroupsApi,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const now = api.now ?? Date.now
  const sleep =
    api.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let n = 1; ; n++) {
    const res = await attempt(api, path, init)
    if (res.status !== 403 && res.status !== 429) return res
    const reason = await reasonOf(res)
    const limited =
      res.status === 429 ||
      (reason !== undefined && RATE_LIMIT_REASONS.has(reason))
    if (!limited || n >= MAX_ATTEMPTS || init?.method === "DELETE") return res
    const wait = BACKOFF_MS * 2 ** (n - 1) * (0.5 + Math.random() / 2)
    if (api.deadline !== undefined && now() + wait >= api.deadline) return res
    await sleep(wait)
  }
}

async function fail(res: Response): Promise<never> {
  let detail: string | undefined
  let reason: string | undefined
  try {
    const text = await res.text()
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; errors?: { reason?: string }[] }
      }
      detail = parsed.error?.message || text.slice(0, 500) || undefined
      reason = parsed.error?.errors?.[0]?.reason
    } catch {
      detail = text.slice(0, 500) || undefined
    }
  } catch {
    detail = undefined
  }
  throw new GoogleGroupsError(res.status, detail, reason)
}

function toGroup(g: RawGroup): ManagedGroup | null {
  if (!g.id || !g.email) return null
  const email = g.email.toLowerCase()
  return { id: g.id, email, name: g.name || email }
}

const groupPath = (groupId: string) => `groups/${encodeURIComponent(groupId)}`

export async function listDomainGroups(
  api: GroupsApi
): Promise<ManagedGroup[]> {
  const out: ManagedGroup[] = []
  let pageToken = ""
  do {
    const q = new URLSearchParams({ domain: api.domain, maxResults: PAGE_SIZE })
    if (pageToken) q.set("pageToken", pageToken)
    const res = await call(api, `groups?${q}`)
    if (!res.ok) await fail(res)
    const data = await readJson<{
      groups?: RawGroup[]
      nextPageToken?: string
    }>(res)
    for (const g of data.groups ?? []) {
      const group = toGroup(g)
      if (group) out.push(group)
    }
    pageToken = data.nextPageToken ?? ""
  } while (pageToken)
  return out
}

export async function getGroup(
  api: GroupsApi,
  groupId: string
): Promise<ManagedGroup | null> {
  const res = await call(api, groupPath(groupId))
  // An id that matches isValidGroupId but that Google cannot parse is a 400,
  // not a 404 (measured 2026-10-19). The path carries nothing else, so both
  // mean "no such group".
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) await fail(res)
  return toGroup(await readJson<RawGroup>(res))
}

/**
 * The addresses of the groups `groupEmail` is a direct member of
 * (lower-cased). Used by the nesting fence in membership.ts.
 *
 * `userKey` takes a group's address (or id) as well as a user's. Google's
 * guide sends it alone, but measured as this service account (2026-10-22)
 * that is a 404 "Domain not found.", `userKey` + `customer` is a 400, and
 * only `userKey` + `domain` returns the parents. The Workspace has one
 * domain, and the Directory API can't see another organisation's groups
 * anyway, so the filter hides no parent the fence could have seen.
 */
export async function listParentGroups(
  api: GroupsApi,
  groupEmail: string
): Promise<string[]> {
  const out: string[] = []
  let pageToken = ""
  do {
    const q = new URLSearchParams({
      userKey: groupEmail,
      domain: api.domain,
      maxResults: PAGE_SIZE,
    })
    if (pageToken) q.set("pageToken", pageToken)
    const res = await call(api, `groups?${q}`)
    if (!res.ok) await fail(res)
    const data = await readJson<{
      groups?: RawGroup[]
      nextPageToken?: string
    }>(res)
    for (const g of data.groups ?? []) {
      // Skipping a nameless parent would let the fence miss it: fail closed.
      if (!g.email)
        throw new Error("Google returned a parent group with no address")
      out.push(g.email.toLowerCase())
    }
    pageToken = data.nextPageToken ?? ""
  } while (pageToken)
  return out
}

export async function listMembers(
  api: GroupsApi,
  groupId: string
): Promise<GroupMember[]> {
  const out: GroupMember[] = []
  let pageToken = ""
  do {
    const q = new URLSearchParams({ maxResults: PAGE_SIZE })
    if (pageToken) q.set("pageToken", pageToken)
    const res = await call(api, `${groupPath(groupId)}/members?${q}`)
    if (!res.ok) await fail(res)
    const data = await readJson<{
      members?: RawMember[]
      nextPageToken?: string
    }>(res)
    for (const m of data.members ?? []) {
      out.push({
        id: m.id ?? null,
        email: m.email ? m.email.toLowerCase() : null,
        role: m.role ?? "",
        type: m.type ?? null,
        status: m.status ?? null,
      })
    }
    pageToken = data.nextPageToken ?? ""
  } while (pageToken)
  return out
}

export type AddedMember = {
  outcome: "ok" | "already"
  /** As Google lists it, lower-cased; the address asked for if Google didn't say. */
  email: string
}

/**
 * Works for addresses with no Google account too. The first outside address
 * makes Google switch the group to "allow external members (admins only)",
 * and it stays that way; the UI warns before this runs.
 *
 * Google may store an address under another spelling than the one sent (a
 * Gmail address without its dots, say), and its member list then uses that
 * spelling. So the address in the reply is passed back for the caller to key
 * on.
 */
export async function addMember(
  api: GroupsApi,
  groupId: string,
  email: string
): Promise<AddedMember> {
  const res = await call(api, `${groupPath(groupId)}/members`, {
    method: "POST",
    body: JSON.stringify({ email, role: "MEMBER" }),
  })
  if (res.status === 409) return { outcome: "already", email }
  if (!res.ok) await fail(res)
  const reply = (await res.json().catch(() => null)) as RawMember | null
  return {
    outcome: "ok",
    email: reply?.email ? reply.email.toLowerCase() : email,
  }
}

export async function removeMember(
  api: GroupsApi,
  groupId: string,
  email: string
): Promise<"ok" | "not_found" | "protected"> {
  const target = email.trim().toLowerCase()
  const member = (await listMembers(api, groupId)).find(
    (m) => m.email === target
  )
  if (!member) return "not_found"
  // Read the role before deleting: a forged request naming an OWNER or
  // MANAGER must never reach DELETE.
  if (!isPlainMember(member.role)) return "protected"
  if (!member.id)
    throw new Error(
      "Google did not return this member's id, so it can't be removed"
    )

  // The list can be stale, and a promotion can land after it. Re-read this
  // one member by id (never by email, see the header) right before DELETE.
  // Residual: a promotion in the milliseconds between this read and the
  // DELETE is still possible; Google offers no precondition on a delete.
  const memberPath = `${groupPath(groupId)}/members/${encodeURIComponent(member.id)}`
  const fresh = await call(api, memberPath)
  if (fresh.status === 404) return "not_found"
  if (!fresh.ok) await fail(fresh)
  const current = await readJson<RawMember | null>(fresh).catch((err) => {
    if (err instanceof GoogleTimeoutError) throw err
    return null
  })
  // An unreadable reply says nothing about the role: that is a failure, not
  // a "protected" member. Only an explicit MEMBER passes.
  if (!current || typeof current.role !== "string" || current.role === "")
    throw new Error("Google's re-read of the member had no readable role")
  if (!isPlainMember(current.role)) return "protected"

  const res = await call(api, memberPath, { method: "DELETE" })
  if (res.status === 404) return "not_found"
  if (!res.ok) await fail(res)
  return "ok"
}
