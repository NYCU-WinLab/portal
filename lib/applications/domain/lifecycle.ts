import type { ApplicationStatus } from "./constants"

export const COMMANDS = [
  "confirm",
  "edit",
  "request_changes",
  "resubmit",
  "withdraw",
  "accept",
  "reassign",
  "finish",
  "reject",
  "close_has_account",
  "purge",
] as const
export type Command = (typeof COMMANDS)[number]

/** `"already"`: the command has already happened; `Application` decides
 * whether that is `unchanged` or a refusal. */
export type LifecycleOutcome =
  { to: ApplicationStatus } | "already" | "wrong_state"

const W = "wrong_state" as const
const A = "already" as const
const to = (status: ApplicationStatus) => Object.freeze({ to: status })

const table: Readonly<
  Record<ApplicationStatus, Readonly<Record<Command, LifecycleOutcome>>>
> = Object.freeze({
  unverified: Object.freeze({
    confirm: to("pending"),
    edit: W,
    request_changes: W,
    resubmit: W,
    withdraw: W,
    accept: W,
    reassign: W,
    finish: W,
    reject: W,
    close_has_account: W,
    purge: W,
  }),
  pending: Object.freeze({
    confirm: A,
    edit: to("pending"),
    request_changes: to("changes_requested"),
    resubmit: W,
    withdraw: to("withdrawn"),
    accept: to("provisioning"),
    reassign: W,
    finish: W,
    reject: to("rejected"),
    close_has_account: W,
    purge: W,
  }),
  changes_requested: Object.freeze({
    confirm: A,
    edit: W,
    request_changes: to("changes_requested"),
    resubmit: to("pending"),
    withdraw: to("withdrawn"),
    accept: W,
    reassign: W,
    finish: W,
    reject: to("rejected"),
    close_has_account: W,
    purge: W,
  }),
  provisioning: Object.freeze({
    confirm: A,
    edit: W,
    request_changes: W,
    resubmit: W,
    withdraw: W,
    accept: A,
    reassign: to("provisioning"),
    finish: to("accepted"),
    reject: W,
    close_has_account: to("rejected"),
    purge: W,
  }),
  accepted: Object.freeze({
    confirm: A,
    edit: W,
    request_changes: W,
    resubmit: W,
    withdraw: W,
    accept: A,
    reassign: W,
    finish: W,
    reject: W,
    close_has_account: W,
    purge: to("accepted"),
  }),
  rejected: Object.freeze({
    confirm: A,
    edit: W,
    request_changes: W,
    resubmit: W,
    withdraw: W,
    accept: W,
    reassign: W,
    finish: W,
    reject: A,
    close_has_account: W,
    purge: to("rejected"),
  }),
  withdrawn: Object.freeze({
    confirm: A,
    edit: W,
    request_changes: W,
    resubmit: W,
    withdraw: A,
    accept: W,
    reassign: W,
    finish: W,
    reject: W,
    close_has_account: W,
    purge: to("withdrawn"),
  }),
})

export const ApplicationLifecycle = Object.freeze({
  table,
  outcome(from: ApplicationStatus, command: Command): LifecycleOutcome {
    return table[from][command]
  },
})
