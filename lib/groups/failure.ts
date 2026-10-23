// lib/groups/failure.ts
// Turning what went wrong into something a group manager can act on. Two
// failures are not about any one address: Google refusing the service
// account (401/403，its admin role, the API or WIF is wrong) and no token
// at all. Those stop a batch and are shown as such, never as an empty list
// or as N separate per-address errors.

import {
  GoogleDeadlineError,
  GoogleGroupsError,
  GoogleTimeoutError,
  GroupsCredentialError,
  isRateLimited,
} from "@/lib/groups/google"
import type { GroupsResult } from "@/lib/groups/types"

export const PERMISSION_MESSAGE =
  "portal 的 Google 服務帳號沒有權限操作群組（admin 角色、API 或 WIF 設定有誤），請通知 Portal 管理員。"

export function isFatal(err: unknown): boolean {
  return (
    err instanceof GroupsCredentialError ||
    (err instanceof GoogleGroupsError &&
      (err.status === 401 || err.status === 403) &&
      !isRateLimited(err))
  )
}

export const RATE_LIMIT_MESSAGE = "Google 暫時限流，請稍後再試"

/**
 * Everything we know, for the server log only. Neither the browser nor the
 * audit row gets it: it can hold STS errors, up to 500 characters of
 * Google's reply, PostgREST messages and a gcp-* group's address, and
 * managers can read the audit table. Both get clientMessage.
 */
export function describeError(err: unknown): string {
  if (isRateLimited(err)) return RATE_LIMIT_MESSAGE
  if (err instanceof GroupsCredentialError)
    return err.cause ? `${err.message}（${err.cause}）` : err.message
  if (err instanceof GoogleGroupsError)
    return `Google ${err.status}${err.detail ? `：${err.detail}` : ""}`
  return err instanceof Error ? err.message : "unknown"
}

export const UNEXPECTED_MESSAGE = "發生未預期的錯誤，請稍後再試"

// Google's `reason` is a short camelCase word ("notFound"); anything else is
// upstream text that doesn't belong in a toast.
function safeReason(reason: string | undefined): string {
  return reason !== undefined && /^[A-Za-z]{1,64}$/.test(reason)
    ? reason
    : "error"
}

/**
 * What a manager is shown: a status and a stable reason, never upstream
 * text. The full detail is logged by whoever caught the error.
 */
export function clientMessage(err: unknown): string {
  if (isRateLimited(err)) return RATE_LIMIT_MESSAGE
  if (err instanceof GroupsCredentialError) return err.message
  if (err instanceof GoogleTimeoutError) return err.message
  if (err instanceof GoogleDeadlineError) return err.message
  if (err instanceof GoogleGroupsError)
    return `Google ${err.status}（${safeReason(err.reason)}）`
  return UNEXPECTED_MESSAGE
}

/**
 * `sent`: whether a write may have reached Google before this failed (see
 * GroupsResult). Leave it out when the caller can't tell.
 */
export function failure(err: unknown, sent?: boolean): GroupsResult<never> {
  const tail = sent === undefined ? {} : { sent }
  if (err instanceof GroupsCredentialError)
    return { status: "error", detail: clientMessage(err), ...tail }
  if (isFatal(err))
    return {
      status: "forbidden",
      reason: "google_permission",
      detail: `${PERMISSION_MESSAGE}（${clientMessage(err)}）`,
      ...tail,
    }
  return { status: "error", detail: clientMessage(err), ...tail }
}
