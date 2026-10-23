// What the member panel shows when a re-read of Google fails. The page is
// re-rendered by the server after every change; if that read fails (Google
// misbehaving is exactly when it will), the panel must keep the last good
// list, the addresses typed for retry and the 同步中 overlay, not be replaced
// by an error message.

/** The latest good value; a failed read (null) keeps the previous one. */
export function retainLastGood<T>(prev: T | null, next: T | null): T | null {
  return next ?? prev
}

/**
 * What to say about a failed read. With a list already on screen it is an
 * inline note about that list; with none the failure is the whole page.
 */
export function readFailureNotice(
  error: string | null,
  hasKept: boolean
):
  | { kind: "none" }
  | { kind: "stale"; text: string }
  | { kind: "empty"; text: string } {
  if (!error) return { kind: "none" }
  if (hasKept)
    return { kind: "stale", text: "重新讀取成員失敗，顯示的是上次的清單。" }
  return { kind: "empty", text: `讀取成員失敗：${error}` }
}
