import type {
  Application,
  Changed,
  EventActor,
  RecordedActor,
} from "./domain/application"
import type {
  AnonymousMailKind,
  ApplicationStatus,
  EventKind,
  MailKind,
  TokenPurpose,
} from "./domain/constants"
import type { ProvisioningRun } from "./domain/provisioning-run"
import type { Email, TokenHash, Username } from "./domain/values"

/** Source of the current time; the domain never reads the clock itself. */
export interface Clock {
  now(): Date
}
export const systemClock: Clock = { now: () => new Date() }

/** Makes link tokens and hashes them; only the hash is ever stored. */
export interface TokenGenerator {
  generate(): { token: string; hash: TokenHash }
  hash(token: string): TokenHash
}

export type ComposedMail = {
  kind: MailKind
  to: string
  subject: string
  text: string
  html: string
}

export type SaveResult = "ok" | "active_email_taken" | "username_claimed"
export type TokenLookup = {
  application: Application
  tokenCreatedAt: Date
}
export type EventRecord = {
  id: number
  kind: EventKind
  actor: RecordedActor
  changes: Record<string, unknown> | null
  at: Date
}
export type HistoryRow = {
  id: string
  status: ApplicationStatus
  createdAt: Date
  closedAt: Date | null
}
export type ReviewRow = {
  application: Application
  run: ProvisioningRun | null
  events: EventRecord[]
  history: HistoryRow[]
}

export interface ApplicationStore {
  /** Transactions do not nest. */
  transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T>
  readonly reader: ApplicationReader
}

export interface ApplicationReader {
  byToken(hash: TokenHash, purpose: TokenPurpose): Promise<TokenLookup | null>
  list(filter: { closed: boolean }): Promise<ReviewRow[]>
  claimedUsernames(
    names: readonly Username[],
    exceptId?: string
  ): Promise<Set<string>>
  history(email: Email, exceptId: string): Promise<HistoryRow[]>
}

/**
 * Everything a command may do inside one transaction. Both the in-memory
 * store and the Postgres store follow these semantics.
 */
export interface UnitOfWork {
  /** Locks and returns the application, or null. */
  lock(id: string): Promise<Application | null>
  lockByToken(
    hash: TokenHash,
    purpose: TokenPurpose
  ): Promise<TokenLookup | null>
  /**
   * The application with this email whose status is in the list and whose
   * `createdAt` is the latest, or null.
   */
  lockByEmail(
    email: Email,
    statuses: readonly ApplicationStatus[]
  ): Promise<Application | null>
  lockRun(applicationId: string): Promise<ProvisioningRun | null>
  /**
   * Finds applications in `provisioning` or `accepted` whose run
   * `isDue(now)`, and returns the one with the earliest `nextAt`.
   */
  claimDue(
    now: Date
  ): Promise<{ application: Application; run: ProvisioningRun } | null>
  /**
   * Writes the application row (version-checked), its profile, ends and
   * inserts change requests, inserts mail-group rows when an assignment
   * first appears, and appends the transition's events. `keycloak_id` is
   * written only by `setKeycloakId`.
   */
  save(t: Changed): Promise<SaveResult>
  saveRun(run: ProvisioningRun): Promise<void>
  deleteRun(applicationId: string): Promise<void>
  /** A token of the same purpose is replaced. */
  putToken(
    applicationId: string,
    purpose: TokenPurpose,
    hash: TokenHash,
    now: Date
  ): Promise<void>
  markMailGroupAdded(
    applicationId: string,
    groupId: string,
    at: Date
  ): Promise<void>
  setKeycloakId(applicationId: string, id: string | null): Promise<void>
  appendEvent(
    applicationId: string,
    kind: EventKind,
    changes: Record<string, unknown> | null,
    actor: EventActor,
    at: Date
  ): Promise<void>
  queueMail(applicationId: string | null, mail: ComposedMail): Promise<void>
  /**
   * Takes the lock `reserveMail` takes, held until the transaction ends. A
   * command that reserves mail and also locks rows calls this first, so
   * every such command takes the locks in one order.
   */
  lockMailLimit(): Promise<void>
  /**
   * Counts records with the same rate key at > now - 1h and > now - 24h, and
   * all records at > now - 1h, and hands them to `MailRatePolicy.allows`.
   * Records one entry only when the result is `ok`.
   */
  reserveMail(
    recipient: Email,
    kind: AnonymousMailKind,
    now: Date
  ): Promise<"ok" | "recipient_limit" | "key_limit">
  /**
   * No row for the key: write it and return true. A row with
   * `sentAt < notBefore`: set it to `now` and return true. Otherwise false.
   */
  claimAlert(key: string, notBefore: Date, now: Date): Promise<boolean>
  savepoint<T>(work: () => Promise<T>): Promise<T>
  /**
   * Deletes the mail it queued in the outbox, then the application; child
   * tables go with it.
   */
  delete(applicationId: string): Promise<void>
  /**
   * Deletes the tokens and the mail it queued in the outbox; sets a change
   * request's note and `provisioning.error` to null; keeps each event's
   * `changes` keys with every value set to null. `save` only writes the main
   * table and the profile.
   */
  purge(applicationId: string, at: Date): Promise<void>
}

export interface SettingsStore {
  notifiees(): Promise<{ userId: string; name: string; email: string }[]>
  setNotifiee(
    userId: string,
    notify: boolean,
    by: string,
    now: Date
  ): Promise<void>
  defaultMailGroups(): Promise<string[]>
  setMailGroup(
    groupId: string,
    enabled: boolean,
    by: string,
    now: Date
  ): Promise<void>
  /** Null fields until a processor sets the apply site's address. */
  applySite(): Promise<{
    url: string | null
    updatedAt: Date | null
    updatedBy: string | null
  }>
  /** Upserts the single settings row; the latest call wins. */
  setApplySite(url: string, by: string, now: Date): Promise<void>
}

export interface ReservedNames {
  has(name: string): Promise<boolean>
}

/** Keycloak answered 5xx or timed out: the service is broken. */
export class KeycloakUnavailable extends Error {}

/**
 * Google Groups cannot be asked: no credentials are set up, or Google failed.
 * Unlike "not manageable" this is nobody's refusal; it is setup or a broken
 * service, so it is an Error (alerts), not an ApplicationRefusal.
 */
export class MailGroupsUnavailable extends Error {}

/** A user is always created disabled. */
export type NewKeycloakUser = {
  username: string
  email: string
  firstName: string
  lastName: string
  attributes: Record<string, string[]>
  groups: readonly string[]
}

export interface KeycloakDirectory {
  emailExists(email: Email): Promise<boolean>
  usernamesTaken(names: readonly Username[]): Promise<Set<string>>
  groupExists(path: string): Promise<boolean>
  forgetCaches(): void
}

export interface KeycloakProvisioner {
  /** Looks up attributes.portal_application_id. */
  findByApplicationId(id: string): Promise<string | null>
  createUser(
    user: NewKeycloakUser
  ): Promise<
    | { ok: true; id: string }
    | { ok: false; reason: "username_taken" | "email_taken" | "invalid" }
  >
  readUser(id: string): Promise<{
    username: string
    email: string
    enabled: boolean
    attributes: Record<string, string[]>
  } | null>
  joinGroup(
    id: string,
    path: string
  ): Promise<"ok" | "user_gone" | "group_missing">
  leaveGroup(id: string, path: string): Promise<"ok" | "gone">
  setEnabled(id: string, enabled: boolean): Promise<"ok" | "user_gone">
  executeActionsEmail(
    id: string,
    opts: { lifespanSeconds: number; signal: AbortSignal }
  ): Promise<"ok" | "user_gone" | "invalid">
}

export interface MailGroups {
  add(
    groupId: string,
    email: Email,
    as: { actorId: string | null; isManager(groupId: string): Promise<boolean> }
  ): Promise<"ok" | "already" | "protected" | "denied" | "error">
  /** Throws MailGroupsUnavailable when Google cannot be asked; callers stay fail-closed. */
  isManageable(groupId: string): Promise<boolean>
  addresses(groupIds: readonly string[]): Promise<Map<string, string>>
}

export interface ProcessorAuthority {
  isPortalAdmin(userId: string): Promise<boolean>
  /** Admin of the accounts app (admins.app = 'accounts'). */
  isAccountsAdmin(userId: string): Promise<boolean>
  managesGroup(userId: string, groupId: string): Promise<boolean>
  /** Ids of the groups the user manages per group_managers (admins not counted). */
  managedGroups(userId: string): Promise<string[]>
  processorEmails(): Promise<string[]>
  portalAdminEmails(): Promise<string[]>
  notifieeEmails(): Promise<string[]>
}

export interface ChangeNotifier {
  changed(): Promise<void>
}

export interface Tracer {
  span<T>(
    name: string,
    attrs: Record<string, string | number>,
    fn: () => Promise<T>,
    expected?: (error: unknown) => boolean
  ): Promise<T>
}

/**
 * A second unverified application for the same email. Both stores throw
 * this class; callers match on the class, never on a message.
 */
export class UnverifiedEmailTaken extends Error {
  constructor() {
    super("lab_applications_unverified_email")
    this.name = "UnverifiedEmailTaken"
  }
}
