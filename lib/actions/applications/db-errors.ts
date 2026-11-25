import { DrizzleQueryError } from "drizzle-orm"

/**
 * A failed query, named by its pg code and constraint only. Drizzle's own
 * error puts the SQL and its parameters in the message, and here those are
 * an applicant's email and profile: the message reaches the action span and
 * the apply site's 400 body. `cause` is the pg error, which neither the span
 * nor errorMessage reads, so `cause.code` and `cause.constraint` still work.
 */
export class StoreQueryError extends Error {
  override name = "StoreQueryError"
}

/** The error with the query and its parameters gone; others as they are. */
export function withoutParams(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error
  const pg = error.cause as { code?: unknown; constraint?: unknown } | undefined
  const code = typeof pg?.code === "string" ? pg.code : "unknown"
  const constraint =
    typeof pg?.constraint === "string" ? ` on ${pg.constraint}` : ""
  return new StoreQueryError(`database query failed: ${code}${constraint}`, {
    cause: error.cause,
  })
}

/** Runs work and rethrows its query error without parameters. */
export async function scrubbed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw withoutParams(error)
  }
}

/** The same methods, each throwing query errors without parameters. */
export function scrubbedMethods<T extends object>(target: T): T {
  const out = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(target)) {
    out[key] =
      typeof value === "function"
        ? (...args: unknown[]) =>
            scrubbed(async () => value.apply(target, args) as unknown)
        : value
  }
  return out as T
}
