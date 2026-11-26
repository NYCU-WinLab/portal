// Single source of truth for enums, formats and limits. Imports nothing,
// because drizzle-kit loads this file.

export const APPLICATION_STATUSES = [
  "unverified",
  "pending",
  "changes_requested",
  "provisioning",
  "accepted",
  "rejected",
  "withdrawn",
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const ACTIVE_STATUSES = [
  "pending",
  "changes_requested",
  "provisioning",
] as const
export const CLOSED_STATUSES = ["accepted", "rejected", "withdrawn"] as const

export const REQUESTED_STATUSES = ["master", "doctoral"] as const
export type RequestedStatus = (typeof REQUESTED_STATUSES)[number]

export const LAB_STATUSES = [
  "teacher",
  "assistant",
  "doctoral",
  "master",
  "undergrad",
] as const
export type LabStatus = (typeof LAB_STATUSES)[number]

export const STEP_NAMES = [
  "create_account",
  "join_keycloak_groups",
  "join_mail_groups",
  "activate_and_mail",
  "finish",
] as const
export type StepName = (typeof STEP_NAMES)[number]

export const EVENT_KINDS = [
  "submitted",
  "verified",
  "edited",
  "changes_requested",
  "resubmitted",
  "accepted",
  "provision_step",
  "provision_failed",
  "provision_blocked",
  "provision_retried",
  "provisioned",
  "rejected",
  "withdrawn",
  "link_sent",
  "password_mail_requested",
  "password_mail_sent",
  "password_mail_expired",
  "password_set",
  "purged",
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const PASSWORD_MAIL_EVENT_KINDS = [
  "password_mail_requested",
  "password_mail_sent",
  "password_mail_expired",
  "password_set",
] as const

export const ACTOR_KINDS = ["applicant", "admin", "system"] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

export const TOKEN_PURPOSES = ["verify", "access"] as const
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number]

export const ANONYMOUS_MAIL_KINDS = ["verify", "has_account", "link"] as const
export type AnonymousMailKind = (typeof ANONYMOUS_MAIL_KINDS)[number]

export const MAIL_KINDS = [
  "verify",
  "link",
  "received",
  "changes_requested",
  "has_account",
  "rejected",
  "approved",
  "processor_notice",
  "digest",
  "password_mail_expired",
  "closed_has_account",
  "notifiee",
  "cohort_missing",
] as const
export type MailKind = (typeof MAIL_KINDS)[number]

/** Kinds whose text carries a token link; the outbox blanks them after sending. */
export const LINK_MAIL_KINDS = [
  "verify",
  "link",
  "received",
  "changes_requested",
] as const satisfies readonly MailKind[]

export const USERNAME_PATTERN = "^[a-z][a-z0-9._-]{2,31}$"
/**
 * The same rule for an input's `pattern` attribute. Browsers compile it with
 * the `v` flag, which rejects an unescaped `-` in a class (and ignores the
 * whole pattern), so the hyphen is escaped. The attribute anchors it itself.
 */
export const USERNAME_PATTERN_CLIENT = "[a-z][a-z0-9._\\-]{2,31}"
/**
 * A conservative ASCII addr-spec, checked after trim and lowercase: no quotes,
 * comments, brackets, `,` or `;`, so mailers cannot read another recipient
 * out of it.
 */
export const EMAIL_PATTERN =
  "^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9-]+(\\.[a-z0-9-]+)+$"
export const PHONE_PATTERN = "^09[0-9]{8}$"
export const TOKEN_HASH_PATTERN = "^[0-9a-f]{64}$"

export const LIMITS = {
  email: 254,
  chineseName: 32,
  firstName: 64,
  lastName: 64,
  studentId: 16,
  department: 64,
  lineId: 64,
} as const

/** Inclusive on both ends. */
export const BIRTHDAY_RANGE = ["1900-01-01", "2100-01-01"] as const
/** Inclusive on both ends. */
export const COHORT_RANGE = [100, 999] as const
