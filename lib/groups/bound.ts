// lib/groups/bound.ts
import { ROLE_CHECK_TIMEOUT_MS } from "@/lib/groups/membership"

/** The bound on a /groups read that runs outside an action's deadline. */
export const READ_BOUND_MS = ROLE_CHECK_TIMEOUT_MS

/**
 * `promise`, or `null` once `ms` has passed. Callers use it for a lookup whose
 * absence already means "refuse" (the signed-in user), so a timeout can never
 * grant anything. A late rejection of the abandoned promise is swallowed.
 */
export async function orNullAfter<T>(
  promise: PromiseLike<T>,
  ms: number = READ_BOUND_MS
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  const work = Promise.resolve(promise)
  work.catch(() => {})
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}
