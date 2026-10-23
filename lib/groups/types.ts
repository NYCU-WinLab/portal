// Shapes shared by the Directory API client, the audit and the /groups UI.

/** A Google group in the portal's domain, as the Directory API reports it. */
export type ManagedGroup = {
  /** Directory group id, e.g. "03znysh71oj6qxe". Stable across renames; the Supabase key. */
  id: string
  /** The group's address, lower-cased, e.g. "lab-all@winlab.tw". */
  email: string
  /** Display name; falls back to the address when Google has none. */
  name: string
}

/** One member row as the Directory API reports it. */
export type GroupMember = {
  /** Directory member id，the key removal deletes by. Google may omit it. */
  id: string | null
  /** Lower-cased address; null for a member with no address (type CUSTOMER). */
  email: string | null
  /** "OWNER" / "MANAGER" / "MEMBER", as Google sends it. */
  role: string
  /** "USER" / "GROUP" / "CUSTOMER"; null when Google leaves it out. */
  type: string | null
  /** Often missing for outside addresses. */
  status: string | null
}

/**
 * Why a request was refused. `denied` and `not_managed` are the portal's own
 * checks; `google_permission` is Google refusing the service account itself
 * (its admin role, the API, or WIF), which an admin has to fix.
 */
export type ForbiddenReason = "denied" | "not_managed" | "google_permission"

/**
 * `sent` on a failed result is the server's word on whether a write request
 * (an add POST or a remove DELETE) may have reached Google: false when the
 * failure came before any was sent, true when at least one was. Absent means
 * unknown, which the UI treats like true.
 */
export type GroupsResult<T> =
  | { status: "ok"; data: T }
  | { status: "unconfigured" }
  | {
      status: "forbidden"
      reason: ForbiddenReason
      detail: string
      sent?: boolean
      results?: MemberChangeResult[]
    }
  | {
      status: "error"
      detail: string
      sent?: boolean
      /**
       * Set only by an add batch that stopped part-way (a fatal Google error
       * or the deadline): what came back for the addresses that were tried,
       * so the UI can show the ones that landed. Addresses with no entry
       * were never attempted.
       */
      results?: MemberChangeResult[]
    }

export type MembershipOutcome =
  "ok" | "already" | "not_found" | "protected" | "denied" | "error"

export type MemberChangeResult = {
  /** The address as asked for, normalised. */
  email: string
  outcome: MembershipOutcome
  detail?: string
  /**
   * The address Google reported back for an add, when it differs from
   * `email`，e.g. a Gmail address without its dots. Google's member list
   * uses this spelling, so the "同步中" overlay has to key on it.
   */
  listedAs?: string
}
