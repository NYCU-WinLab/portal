/** A same-origin path to return to after sign-in; anything else is "/". */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
}
