// lib/groups/batch.ts
// At most `limit` calls in flight，Directory API quotas are per project ，
// with results in input order. Once stop() is true no further item starts;
// the ones already running finish, and items never started are left out.
//
// `fn` must not reject. A rejection rejects this whole call at once while
// the other workers keep starting items in the background, and the caller
// loses the results，the audit of what already reached Google included. So
// callers catch inside `fn` and return an outcome (lib/groups/membership.ts).

export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  stop: () => boolean = () => false
): Promise<R[]> {
  const out = new Array<R>(items.length)
  const done = new Array<boolean>(items.length).fill(false)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !stop()) {
        const i = next++
        out[i] = await fn(items[i]!)
        done[i] = true
      }
    })
  )
  return out.filter((_, i) => done[i])
}
