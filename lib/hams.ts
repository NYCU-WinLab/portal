// hams-bridge (hams.winlab.tw, on the lab's host): the HTTP side of the
// card reader, a Hundure RAC-960PME that keeps its own card table and only
// speaks a binary protocol on the lab network. The bridge holds one lock
// for the reader and reads the count back after every write, so its error
// code already says whether a change landed:
//   GET    /health        -> { card_count, clock_skew_s, ... }
//   GET    /cards         -> { count, cards: [{ card_id, name }] }
//   POST   /cards         -> 201 { count_before, count_after }
//   PUT    /cards/{id}    -> 200 (rename: delete, then add)
//   DELETE /cards/{id}    -> 200 { count_before, count_after }
//   errors                -> { error, code, unconfirmed?, observed? }

export type HamsCode =
  | "unauthorized"
  | "validation"
  | "exists"
  | "not_found"
  | "controller_unreachable"
  | "controller_busy"
  | "table_suspect"
  | "verify_failed"
  | "verify_inconclusive"
  | "rename_lost_card"
  | "unknown"

const CODES = new Set<string>([
  "unauthorized",
  "validation",
  "exists",
  "not_found",
  "controller_unreachable",
  "controller_busy",
  "table_suspect",
  "verify_failed",
  "verify_inconclusive",
  "rename_lost_card",
])

/** A failure the bridge reported. unconfirmed: it could not read the
 * reader back, so the card's state there is unknown. */
export class HamsError extends Error {
  constructor(
    readonly code: HamsCode,
    readonly status: number,
    readonly unconfirmed = false
  ) {
    super(`hams-bridge ${status} ${code}`)
    this.name = "HamsError"
  }
}

export type ReaderCard = { card_id: string; name: string }

export function hamsConfigured() {
  return Boolean(process.env.HAMS_API_URL && process.env.HAMS_API_SECRET)
}

async function call<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown
): Promise<T> {
  const base = process.env.HAMS_API_URL
  const secret = process.env.HAMS_API_SECRET
  if (!base || !secret) throw new Error("卡機服務沒有設定")
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    // A write waits for the bridge's lock and its read back.
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    // Timed out or unreachable: a write may still have reached the reader.
    throw new HamsError("controller_unreachable", 0, method !== "GET")
  })
  const payload = (await response.json().catch(() => null)) as {
    code?: unknown
    unconfirmed?: unknown
  } | null
  if (!response.ok) {
    const code =
      typeof payload?.code === "string" && CODES.has(payload.code)
        ? (payload.code as HamsCode)
        : "unknown"
    throw new HamsError(code, response.status, payload?.unconfirmed === true)
  }
  return payload as T
}

/** The reader's card table. count is what the reader claims, which can
 * differ from the cards it could list. */
export async function readerCards() {
  const list = await call<{ count?: number; cards?: ReaderCard[] }>(
    "/cards",
    "GET"
  )
  return { count: list.count ?? 0, cards: list.cards ?? [] }
}

export const addReaderCard = (cardId: string, name: string) =>
  call<unknown>("/cards", "POST", { card_id: cardId, name })

export const renameReaderCard = (cardId: string, name: string) =>
  call<unknown>(`/cards/${cardId}`, "PUT", { name })

export const deleteReaderCard = (cardId: string) =>
  call<unknown>(`/cards/${cardId}`, "DELETE")
