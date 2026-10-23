// lib/groups/membership.ts
// The read / add / remove flows behind app/groups/actions.ts, with
// everything they talk to passed in: the member's is_group_manager() check,
// the Directory API and the audit sink. actions.ts only wires in the real
// ones, so the order of checks is tested here with fakes:
//
//   1. Input first. A server action takes whatever a forged request sends,
//      so anything the UI never sends，a non-string, an over-long string,
//      an address normalizeEmail refuses，rejects the whole request with no
//      Google call and no audit row, as a malformed group id does. It is
//      logged instead: who sent it and which check failed, never the content.
//   2. is_group_manager() before Google: a non-manager never causes a call.
//   3. Google's own address for the group decides gcp-* and the domain, and
//      the id Google returns must be the id the manager check was made for.
//   3b. Before a write, the group's ancestors are walked: a group nested in
//      a gcp-* group (or one outside the domain) is refused, because editing
//      it would change that group's effective membership.
//      One deadline is taken when the action starts and covers all of it:
//      authorisation (is_group_manager() too: it is aborted and abandoned
//      at the deadline), the ancestor walk and the writes. Past it no Google
//      call starts (token included), no retry is made and, for an add, no
//      new address; each call's timeout is also cut to what is left.
//   4. Every write attempt past (1) is audited, handed to the sink once, in
//      `finally`: a row per address tried, one row for a refusal however
//      many addresses it carried, one row when authorisation itself failed
//      or the ancestor walk failed (those land in the same catch).

import { buildAuditRow, type AuditInsert } from "@/lib/groups/audit"
import { authorizeGroup } from "@/lib/groups/authorize"
import { mapLimited } from "@/lib/groups/batch"
import {
  MAX_EMAIL_LENGTH,
  normalizeEmail,
  sameMailbox,
} from "@/lib/groups/email"
import {
  clientMessage,
  describeError,
  failure,
  isFatal,
} from "@/lib/groups/failure"
import {
  addMember,
  getGroup,
  GoogleDeadlineError,
  listMembers,
  MIN_WRITE_BUDGET_MS,
  listParentGroups,
  removeMember,
  type GroupsApi,
} from "@/lib/groups/google"
import { INVALID_INPUT, MAX_BATCH } from "@/lib/groups/messages"
import {
  findForbiddenAncestor,
  NestingTooDeepError,
} from "@/lib/groups/nesting"
import { isValidGroupId } from "@/lib/groups/scope"
import type {
  GroupMember,
  GroupsResult,
  ManagedGroup,
  MemberChangeResult,
} from "@/lib/groups/types"

export { MAX_BATCH }
// Small on purpose: Directory API quotas are per project.
const CONCURRENCY = 4
/** The action's whole budget: no retry or new address starts after it. */
export const BATCH_BUDGET_MS = 60_000
/** Bound on a role check that runs outside an action's deadline (is_portal_admin). */
export const ROLE_CHECK_TIMEOUT_MS = 10_000

export const READ_TIMEOUT_MESSAGE = "讀取逾時，請稍後重新整理"
export const DENIED = "你不是這個群組的管理者"
export const NOT_MANAGED = "這個群組不存在，或不開放給 portal 管理"
// A group that is on screen, so "doesn't exist" would be false. Does not name
// the ancestor: it may be a gcp-* group.
export const NESTED_MESSAGE =
  "此群組是其他受保護群組的成員，無法在 portal 修改成員"
export { INVALID_INPUT }
const UNKNOWN_GROUP = "(unknown)"

export type GroupAccess = {
  userId: string
  api: GroupsApi
  /**
   * is_group_manager() with the member's own client. Throws if the RPC
   * fails. `signal` aborts at the action's deadline; the check is abandoned
   * then whether or not the RPC honours it.
   */
  isManager: (groupId: string, signal: AbortSignal) => Promise<boolean>
}

export type MembershipDeps = GroupAccess & {
  /** Gets each request's audit rows once. Must not throw. */
  audit: (rows: AuditInsert[]) => void
  /** Overrides BATCH_BUDGET_MS, the action-wide deadline (tests). */
  batchBudgetMs?: number
}

const notManaged = (detail = NOT_MANAGED): GroupsResult<never> => ({
  status: "forbidden",
  reason: "not_managed",
  detail,
  sent: false,
})

export const TOO_DEEP = "此群組位於過深的巢狀結構中，無法在 portal 管理"
export const ANCESTORS_UNVERIFIED =
  "portal 無法確認這個群組的上層群組，請稍後再試"
const NESTED = "nested in a group the portal may not manage"

export function parseGroupId(value: unknown): string | null {
  return typeof value === "string" && isValidGroupId(value) ? value : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseUserId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null
}

function parseAddress(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_EMAIL_LENGTH
    ? normalizeEmail(value)
    : null
}

// A malformed request is not audited (it could carry anything), but a forged
// one should still leave a trace: who, and which check it failed.
export function malformed<T>(userId: string, check: string, result: T): T {
  console.warn("[groups] malformed request", { userId, check })
  return result
}

/** Every one valid, at least one, duplicates dropped，or null. */
function parseAddresses(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: string[] = []
  for (const raw of value as unknown[]) {
    const email = parseAddress(raw)
    if (email === null) return null
    if (!out.includes(email)) out.push(email)
  }
  return out
}

type Verdict =
  | { ok: true; group: ManagedGroup }
  | {
      ok: false
      result: GroupsResult<never>
      groupEmail: string | null
      why: string
    }

/**
 * is_group_manager() within what is left of the action's deadline. A check
 * that can't finish in time is a pre-send failure (GoogleDeadlineError):
 * nothing has gone to Google yet.
 */
async function checkManager(
  access: GroupAccess,
  groupId: string
): Promise<boolean> {
  const now = access.api.now ?? Date.now
  const left = (access.api.deadline ?? now() + BATCH_BUDGET_MS) - now()
  if (left <= 0) throw new GoogleDeadlineError()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GoogleDeadlineError())
    }, left)
  })
  try {
    return await Promise.race([
      access.isManager(groupId, controller.signal),
      expired,
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function authorize(
  access: GroupAccess,
  groupId: string
): Promise<Verdict> {
  const isManager = await checkManager(access, groupId)
  // Only a manager makes the portal ask Google about the group.
  const group = isManager ? await getGroup(access.api, groupId) : null
  // The manager check was made for the id the caller sent; every write uses
  // the id Google returned. They must be the same group.
  const verdict = authorizeGroup({
    isManager,
    group: group && group.id === groupId ? group : null,
    domain: access.api.domain,
  })
  if (verdict.ok) return verdict
  const denied = verdict.reason === "denied"
  return {
    ok: false,
    result: {
      status: "forbidden",
      reason: verdict.reason,
      detail: denied ? DENIED : NOT_MANAGED,
      sent: false,
    },
    // Only a group whose id is the one asked about: otherwise the address
    // belongs to some other group and must not land in this one's row.
    groupEmail: group && group.id === groupId ? group.email : null,
    why: denied ? "not a manager" : "not manageable",
  }
}

/** The ancestor walk failed for a reason other than "too deep" or a fatal one. */
class AncestorLookupError extends Error {
  constructor(readonly underlying: unknown) {
    super(ANCESTORS_UNVERIFIED)
    this.name = "AncestorLookupError"
  }
}

type Fence =
  { ok: true } | { ok: false; result: GroupsResult<never>; why: string }

/**
 * Before a write: is the group nested (up to a few levels) in a group the
 * portal may not touch, or too deep to tell? Either refuses the write. A
 * failing lookup is thrown (a fatal Google or credential failure as it is,
 * anything else as an AncestorLookupError) and the caller treats it like any
 * failed authorisation: an error, audited, nothing written. The offending
 * ancestor's address goes to the log, not to the audit row or the browser:
 * managers can read the audit table and the ancestor may be a gcp-* group.
 */
async function checkNesting(
  access: GroupAccess,
  group: ManagedGroup
): Promise<Fence> {
  try {
    const ancestor = await findForbiddenAncestor(
      (email) => listParentGroups(access.api, email),
      group.email,
      access.api.domain
    )
    if (ancestor === null) return { ok: true }
    console.warn("[groups] write refused, nested in a forbidden group", {
      actor: access.userId,
      group: group.id,
      ancestor,
    })
    return { ok: false, result: notManaged(NESTED_MESSAGE), why: NESTED }
  } catch (err) {
    if (err instanceof NestingTooDeepError)
      return { ok: false, result: notManaged(TOO_DEEP), why: TOO_DEEP }
    if (isFatal(err)) throw err
    throw new AncestorLookupError(err)
  }
}

/**
 * Wraps the api so it notes whether a write request (POST / DELETE) was
 * handed to fetch. A failure before that cannot have changed anything, and
 * the UI is told so (GroupsResult.sent).
 */
function trackWrites(api: GroupsApi): { api: GroupsApi; sent: () => boolean } {
  let sent = false
  return {
    api: {
      ...api,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST" || init?.method === "DELETE") sent = true
        return api.fetch(input, init)
      }) as typeof fetch,
    },
    sent: () => sent,
  }
}

/**
 * The result and the audit detail for a request that threw. Both carry the
 * short client message; the full text goes to the log with who and which
 * group, so the log line and the row can be matched.
 */
function failedRequest(
  err: unknown,
  sent: boolean,
  ctx: { actor: string; group: string; action: "add" | "remove" }
): { result: GroupsResult<never>; detail: string } {
  console.error(`[groups] ${ctx.action} failed`, ctx, describeError(err), err)
  if (err instanceof AncestorLookupError) {
    console.error("[groups] ancestor lookup failed", err.underlying)
    return {
      result: { status: "error", detail: ANCESTORS_UNVERIFIED, sent: false },
      detail: ANCESTORS_UNVERIFIED,
    }
  }
  return { result: failure(err, sent), detail: clientMessage(err) }
}

/** One row for a whole request, however many addresses it carried. */
function requestRow(
  userId: string,
  group: { id: string; email: string | null },
  action: "add" | "remove",
  emails: string[],
  outcome: "denied" | "error",
  why: string
): AuditInsert {
  return buildAuditRow(
    userId,
    { id: group.id, email: group.email ?? UNKNOWN_GROUP },
    action,
    {
      email: emails[0] ?? "",
      outcome,
      detail:
        emails.length > 1
          ? `${why} (${emails.length} addresses in this request)`
          : why,
    }
  )
}

export async function readGroup(
  access: GroupAccess,
  groupIdInput: unknown
): Promise<GroupsResult<{ group: ManagedGroup; members: GroupMember[] }>> {
  const groupId = parseGroupId(groupIdInput)
  if (!groupId) return malformed(access.userId, "group id", notManaged())
  // Same bound as a write: a page render must not outlive the budget.
  const now = access.api.now ?? Date.now
  const api: GroupsApi = {
    ...access.api,
    deadline: access.api.deadline ?? now() + BATCH_BUDGET_MS,
  }
  try {
    const auth = await authorize({ ...access, api }, groupId)
    if (!auth.ok) return auth.result
    const members = await listMembers(api, auth.group.id)
    return { status: "ok", data: { group: auth.group, members } }
  } catch (err) {
    console.error("[groups] read failed", err)
    // A read has nothing to "send"; the write wording would mislead.
    if (err instanceof GoogleDeadlineError)
      return { status: "error", detail: READ_TIMEOUT_MESSAGE, sent: false }
    return failure(err, false)
  }
}

export async function addToGroup(
  deps: MembershipDeps,
  groupIdInput: unknown,
  emailsInput: unknown
): Promise<GroupsResult<MemberChangeResult[]>> {
  const groupId = parseGroupId(groupIdInput)
  if (!groupId) return malformed(deps.userId, "group id", notManaged())
  if (Array.isArray(emailsInput) && emailsInput.length > MAX_BATCH)
    return malformed(deps.userId, "batch size", {
      status: "error",
      detail: `一次最多加入 ${MAX_BATCH} 個地址`,
      sent: false,
    })
  const emails = parseAddresses(emailsInput)
  if (!emails)
    return malformed(deps.userId, "addresses", {
      status: "error",
      detail: INVALID_INPUT,
      sent: false,
    })

  // One deadline for the whole action, taken before the first Google call.
  const now = deps.api.now ?? Date.now
  const deadline = now() + (deps.batchBudgetMs ?? BATCH_BUDGET_MS)
  const tracked = trackWrites({ ...deps.api, deadline })
  const api = tracked.api
  const access: GroupAccess = { ...deps, api }

  const rows: AuditInsert[] = []
  // The group's address once Google has told us, for the audit row.
  let knownEmail: string | null = null
  try {
    const auth = await authorize(access, groupId)
    if (!auth.ok) {
      rows.push(
        requestRow(
          deps.userId,
          { id: groupId, email: auth.groupEmail },
          "add",
          emails,
          "denied",
          auth.why
        )
      )
      return auth.result
    }
    const group = auth.group
    knownEmail = group.email
    const fence = await checkNesting(access, group)
    if (!fence.ok) {
      rows.push(
        requestRow(deps.userId, group, "add", emails, "denied", fence.why)
      )
      return fence.result
    }
    // A credential or permission failure is the same for every address:
    // stop sending the rest and report it once.
    const abort: { cause: unknown } = { cause: null }
    // A 409 doesn't say how Google spells the existing member; the member
    // list does. Read it at most once per batch, and only if a 409 happens.
    let listing: Promise<GroupMember[] | null> | null = null
    const listed = () =>
      (listing ??= listMembers(api, group.id).catch((err: unknown) => {
        console.error("[groups] member list for a 409 failed", err)
        return null
      }))
    const results = await mapLimited(
      emails,
      CONCURRENCY,
      async (email): Promise<MemberChangeResult> => {
        // All of it inside the try: mapLimited must never reject (batch.ts).
        try {
          const added = await addMember(api, group.id, email)
          let listedAs = added.email
          if (added.outcome === "already") {
            const members = await listed()
            const hit =
              members?.find((m) => m.email === email) ??
              members?.find((m) => m.email && sameMailbox(m.email, email))
            if (hit?.email) listedAs = hit.email
          }
          return listedAs === email
            ? { email, outcome: added.outcome }
            : { email, outcome: added.outcome, listedAs }
        } catch (err) {
          if (isFatal(err) && abort.cause === null) abort.cause = err
          console.error(
            "[groups] add failed for an address",
            { actor: deps.userId, group: group.id, address: email },
            describeError(err)
          )
          return { email, outcome: "error", detail: clientMessage(err) }
        }
      },
      // Stop at the write floor, not the deadline: attempt() refuses a write
      // with under MIN_WRITE_BUDGET_MS left, so starting more would only
      // log instant failures for every remaining address.
      () => abort.cause !== null || now() >= deadline - MIN_WRITE_BUDGET_MS
    )
    for (const r of results)
      rows.push(buildAuditRow(deps.userId, group, "add", r))
    if (abort.cause !== null) {
      console.error("[groups] add stopped", {
        actor: deps.userId,
        group: group.id,
        started: results.length,
        total: emails.length,
        cause: describeError(abort.cause),
      })
      return {
        ...failure(abort.cause, tracked.sent()),
        results,
      } as GroupsResult<never>
    }
    if (results.length < emails.length) {
      // Out of time: the rest were never sent. What did run is audited.
      const sent = tracked.sent()
      console.error("[groups] add stopped at the deadline", {
        actor: deps.userId,
        group: group.id,
        started: results.length,
        total: emails.length,
        sent,
      })
      return {
        status: "error",
        detail:
          `處理太久，已停止：${emails.length} 個地址中只處理了 ${results.length} 個，其餘沒有送出。` +
          (sent
            ? "已送出的結果可能已套用，請重新整理確認後再試。"
            : "沒有任何變更送出，可以直接再試。"),
        sent,
        results,
      }
    }
    return { status: "ok", data: results }
  } catch (err) {
    // Authorisation, the ancestor walk or anything after them failed. Unlike
    // a malformed request this was a real attempt, so it is recorded，once.
    const failed = failedRequest(err, tracked.sent(), {
      actor: deps.userId,
      group: groupId,
      action: "add",
    })
    rows.push(
      requestRow(
        deps.userId,
        { id: groupId, email: knownEmail },
        "add",
        emails,
        "error",
        failed.detail
      )
    )
    return failed.result
  } finally {
    if (rows.length > 0) deps.audit(rows)
  }
}

export async function removeFromGroup(
  deps: MembershipDeps,
  groupIdInput: unknown,
  emailInput: unknown
): Promise<GroupsResult<MemberChangeResult>> {
  const groupId = parseGroupId(groupIdInput)
  if (!groupId) return malformed(deps.userId, "group id", notManaged())
  const email = parseAddress(emailInput)
  if (!email)
    return malformed(deps.userId, "address", {
      status: "error",
      detail: INVALID_INPUT,
      sent: false,
    })

  const now = deps.api.now ?? Date.now
  const tracked = trackWrites({
    ...deps.api,
    deadline: now() + (deps.batchBudgetMs ?? BATCH_BUDGET_MS),
  })
  const access: GroupAccess = { ...deps, api: tracked.api }

  const rows: AuditInsert[] = []
  let knownEmail: string | null = null
  try {
    const auth = await authorize(access, groupId)
    if (!auth.ok) {
      rows.push(
        requestRow(
          deps.userId,
          { id: groupId, email: auth.groupEmail },
          "remove",
          [email],
          "denied",
          auth.why
        )
      )
      return auth.result
    }
    knownEmail = auth.group.email
    const fence = await checkNesting(access, auth.group)
    if (!fence.ok) {
      rows.push(
        requestRow(
          deps.userId,
          auth.group,
          "remove",
          [email],
          "denied",
          fence.why
        )
      )
      return fence.result
    }
    let result: MemberChangeResult
    let fatal: unknown = null
    try {
      result = {
        email,
        outcome: await removeMember(tracked.api, auth.group.id, email),
      }
    } catch (err) {
      // Fatal, or the deadline stopped it before the DELETE: a failure of the
      // request, not of the address, and told to the UI with `sent`.
      if (isFatal(err) || err instanceof GoogleDeadlineError) fatal = err
      console.error(
        "[groups] remove failed for an address",
        { actor: deps.userId, group: auth.group.id, address: email },
        describeError(err)
      )
      result = { email, outcome: "error", detail: clientMessage(err) }
    }
    rows.push(buildAuditRow(deps.userId, auth.group, "remove", result))
    if (fatal !== null) return failure(fatal, tracked.sent())
    return { status: "ok", data: result }
  } catch (err) {
    const failed = failedRequest(err, tracked.sent(), {
      actor: deps.userId,
      group: groupId,
      action: "remove",
    })
    rows.push(
      requestRow(
        deps.userId,
        { id: groupId, email: knownEmail },
        "remove",
        [email],
        "error",
        failed.detail
      )
    )
    return failed.result
  } finally {
    if (rows.length > 0) deps.audit(rows)
  }
}
