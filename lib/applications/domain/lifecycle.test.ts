import { expect, test } from "bun:test"
import { APPLICATION_STATUSES, type ApplicationStatus } from "./constants"
import {
  ApplicationLifecycle,
  COMMANDS,
  type Command,
  type LifecycleOutcome,
} from "./lifecycle"

const W = "wrong_state",
  A = "already"
const to = (s: ApplicationStatus) => ({ to: s })

// Columns follow COMMANDS: confirm, edit, request_changes, resubmit, withdraw,
// accept, reassign, finish, reject, close_has_account, purge.
const EXPECTED: Record<ApplicationStatus, LifecycleOutcome[]> = {
  unverified: [to("pending"), W, W, W, W, W, W, W, W, W, W],
  pending: [
    A,
    to("pending"),
    to("changes_requested"),
    W,
    to("withdrawn"),
    to("provisioning"),
    W,
    W,
    to("rejected"),
    W,
    W,
  ],
  changes_requested: [
    A,
    W,
    to("changes_requested"),
    to("pending"),
    to("withdrawn"),
    W,
    W,
    W,
    to("rejected"),
    W,
    W,
  ],
  provisioning: [
    A,
    W,
    W,
    W,
    W,
    A,
    to("provisioning"),
    to("accepted"),
    W,
    to("rejected"),
    W,
  ],
  accepted: [A, W, W, W, W, A, W, W, W, W, to("accepted")],
  rejected: [A, W, W, W, W, W, W, W, A, W, to("rejected")],
  withdrawn: [A, W, W, W, A, W, W, W, W, W, to("withdrawn")],
}

const cells = APPLICATION_STATUSES.flatMap((from) =>
  COMMANDS.map(
    (command, i) =>
      [from, command, EXPECTED[from][i]] as [
        ApplicationStatus,
        Command,
        LifecycleOutcome,
      ]
  )
)

test.each(cells)("%p %p → %p", (from, command, expected) =>
  expect(ApplicationLifecycle.outcome(from, command)).toEqual(expected)
)

test("the table has exactly the statuses as rows and the commands as columns", () => {
  expect(Object.keys(ApplicationLifecycle.table).sort()).toEqual(
    [...APPLICATION_STATUSES].sort()
  )
  for (const row of Object.values(ApplicationLifecycle.table)) {
    expect(Object.keys(row).sort()).toEqual([...COMMANDS].sort())
  }
})
