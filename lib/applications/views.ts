// Plain data returned to pages and MCP; every time is an ISO string.
import type {
  ActorKind,
  ApplicationStatus,
  EventKind,
  LabStatus,
  RequestedStatus,
  StepName,
} from "./domain/constants"

export type ProfileView = {
  username: string
  chineseName: string
  firstName: string
  lastName: string
  studentId: string | null
  birthday: string
  phone: string
  nycuEmail: string | null
  department: string
  lineId: string
}
export type ChangeRequestView = {
  note: string | null
  dueAt: string
  expired: boolean
}
export type PasswordMailView = {
  lastSentAt: string | null
  expiresAt: string | null
  passwordSet: boolean
  canResend: boolean
}
export type OkResult = { ok: true }
export type ConfirmResult =
  { ok: true; already: boolean } | { ok: false; code: "already_applied" }
export type ConfirmSummaryView = {
  chineseName: string
  firstName: string
  lastName: string
  studentId: string | null
  department: string
  requestedStatus: RequestedStatus
  username: string
  phoneLast3: string
  confirmed: boolean
}
export type ApplicationStatusView = {
  status: ApplicationStatus
  submittedAt: string
  verifiedAt: string | null
  reviewedAt: string | null
  closedAt: string | null
  changeRequest: ChangeRequestView | null
  closure:
    | { kind: "rejected"; note: string | null }
    | { kind: "has_account" }
    | { kind: "withdrawn" }
    | null
  passwordMail: PasswordMailView | null
}
export type EditView = {
  profile: ProfileView
  requestedStatus: RequestedStatus
  changeRequest: ChangeRequestView
}
export type WithdrawResult = { ok: true; status: "withdrawn" }
export type MutationResult = { ok: true; version: number }
export type ReviewItem = {
  id: string
  status: ApplicationStatus
  version: number
  email: string | null
  requestedStatus: RequestedStatus
  profile: ProfileView | null
  submittedAt: string
  verifiedAt: string | null
  closedAt: string | null
  reviewNote: string | null
  defaults: { labStatus: LabStatus; cohort: number; mailGroups: string[] }
  assignableStatuses: LabStatus[]
  assignment: {
    status: LabStatus
    cohort: number
    username: string
    mailGroups: {
      groupId: string
      address: string | null
      addedAt: string | null
    }[]
  } | null
  usernameTaken: boolean | null
  changeRequest: ChangeRequestView | null
  provisioning: {
    attempts: number
    nextAt: string
    error: string | null
    blockedAt: string | null
    startedAt: string
    finishedAt: string | null
    releasedAt: string | null
    steps: { name: StepName; completedAt: string }[]
  } | null
  passwordMail: PasswordMailView | null
  history: {
    id: string
    status: ApplicationStatus
    createdAt: string
    closedAt: string | null
  }[]
  events: {
    id: number
    kind: EventKind
    actorKind: ActorKind
    actorId: string | null
    changes: Record<string, unknown> | null
    at: string
  }[]
}
export type SettingsView = {
  notifiees: { userId: string; name: string; email: string }[]
  mailGroups: { groupId: string; address: string | null }[]
  warnings: { noProcessors: boolean; noNotifiees: boolean }
}
