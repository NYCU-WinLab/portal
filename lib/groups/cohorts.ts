import { type KeycloakGroupMember, labCohorts } from "@/lib/keycloak"

export type Cohort = { name: string; members: KeycloakGroupMember[] }

/** The whole lookup gets this long; then the picker is hidden. */
export const COHORT_DEADLINE_MS = 8_000

/** Newest cohort first, or null when Keycloak cannot be read in time: the
 * page then hides the cohort picker and everything else still works. */
export async function fetchCohorts(
  deadlineMs = COHORT_DEADLINE_MS
): Promise<Cohort[] | null> {
  const read = labCohorts()
  read.catch(() => {})
  const timeout = new Promise<null>((done) =>
    setTimeout(() => done(null), deadlineMs)
  )
  try {
    return await Promise.race([read, timeout])
  } catch {
    return null
  }
}
