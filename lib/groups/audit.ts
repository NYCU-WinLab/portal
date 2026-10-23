// lib/groups/audit.ts
// Every /groups add or remove, refused and failed ones included. Rows are
// inserted with the service-role client: the table has no insert policy, so
// a member can never write a row about something that did not happen.

import { MAX_EMAIL_LENGTH } from "@/lib/groups/email"
import type { MemberChangeResult } from "@/lib/groups/types"

const MAX_DETAIL_LENGTH = 500

// Postgres text can't hold U+0000, and one bad row fails the whole insert,
// taking every other row of that request with it. So control characters and
// lone surrogates go, and lengths are cut by code point，the way
// char_length() counts them, and without splitting a surrogate pair.
const CONTROL = /[\p{Cc}\p{Cs}]+/gu

function clip(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("")
}

export type AuditInsert = {
  actor_id: string
  /** The Directory group id. */
  group_id: string
  group_email: string
  member_email: string
  action: "add" | "remove"
  outcome: MemberChangeResult["outcome"]
  detail: string | null
}

export function buildAuditRow(
  actorId: string,
  group: { id: string; email: string },
  action: "add" | "remove",
  result: MemberChangeResult
): AuditInsert {
  const detail =
    result.detail ??
    (result.listedAs ? `listed by Google as ${result.listedAs}` : undefined)
  return {
    actor_id: actorId,
    group_id: group.id,
    group_email: clip(group.email.replace(CONTROL, ""), MAX_EMAIL_LENGTH),
    member_email: clip(result.email.replace(CONTROL, ""), MAX_EMAIL_LENGTH),
    action,
    outcome: result.outcome,
    detail: detail
      ? clip(detail.replace(CONTROL, " "), MAX_DETAIL_LENGTH)
      : null,
  }
}

/** Denied rows one actor may add per hour; past it they are only logged. */
export const DENIED_ROWS_PER_HOUR = 30

/**
 * Any signed-in member can call the actions with any group id, and every
 * refusal is a row in that group's 最近變更. So refusals are bounded per
 * actor: of `rows`, `ok` / `error` always stay; `denied` ones stay only while
 * the actor's last hour holds fewer than the limit. Pure so it can be tested;
 * the sink only supplies the count.
 */
export function splitDenied(
  rows: AuditInsert[],
  recentDenied: number,
  limit = DENIED_ROWS_PER_HOUR
): { keep: AuditInsert[]; dropped: AuditInsert[] } {
  let room = Math.max(0, limit - recentDenied)
  const keep: AuditInsert[] = []
  const dropped: AuditInsert[] = []
  for (const row of rows) {
    if (row.outcome !== "denied" || room-- > 0) keep.push(row)
    else dropped.push(row)
  }
  return { keep, dropped }
}

// Never throws: the change already happened in Google, and a lost audit line
// must not turn it into an error toast. Failures go to the server console.
// The denied count filters on actor_id, which has no index (only
// (group_id, created_at) does); at lab scale that is a small scan, and it
// runs only for requests that were refused.
