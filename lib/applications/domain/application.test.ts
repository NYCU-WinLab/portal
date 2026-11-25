import { expect, test } from "bun:test"
import {
  ADMIN,
  assignment,
  NOW,
  pending,
  profile,
  submitInput,
} from "../testing/fixtures"
import { Application, APPLICANT, SYSTEM, type Transition } from "./application"
import { ApplicationRefusal, type RefusalCode } from "./refusal"
import { Cohort, Username } from "./values"

const at = (ms: number) => new Date(NOW.getTime() + ms)
const SEC = 1000,
  MIN = 60 * SEC,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR
const refusal = (code: RefusalCode, field?: string) =>
  new ApplicationRefusal(code, field)

function next(t: Transition): Application {
  expect(t.kind).toBe("changed")
  if (t.kind !== "changed") throw new Error("unreachable")
  return t.next
}

async function provisioning(): Promise<Application> {
  const app = await pending()
  return next(app.accept(assignment(), app.version, ADMIN, NOW))
}

const withKeycloakId = (app: Application) =>
  Application.restore({ ...app.snapshot, keycloakId: "kc-1" })

test("submit starts unverified at version 1 with a submitted event", async () => {
  const t = Application.submit(await submitInput(), NOW)
  expect([
    t.next.status,
    t.next.version,
    t.previous,
    t.events.map((e) => e.kind),
  ]).toEqual(["unverified", 1, null, ["submitted"]])
  expect(t.next.createdAt).toEqual(NOW)
  expect(t.events[0]).toEqual({
    kind: "submitted",
    actor: { kind: "applicant" },
    changes: null,
    at: NOW,
  })
})

test("confirm writes verifiedAt with a verified event", async () => {
  const submitted = Application.submit(await submitInput(), NOW).next
  const t = submitted.confirm(at(MIN))
  expect(t.kind).toBe("changed")
  if (t.kind !== "changed") return
  expect([t.next.status, t.next.version, t.next.verifiedAt]).toEqual([
    "pending",
    2,
    at(MIN),
  ])
  expect(t.previous).toBe(submitted)
  expect(t.at).toEqual(at(MIN))
  expect(t.events.map((e) => [e.kind, e.actor, e.changes])).toEqual([
    ["verified", { kind: "applicant" }, null],
  ])
})

test("confirm twice is unchanged the second time", async () =>
  expect((await pending()).confirm(NOW).kind).toBe("unchanged"))

test("edit with identical values is unchanged", async () => {
  const app = await pending()
  const t = app.edit(
    { profile: app.profile!, requestedStatus: app.requestedStatus },
    app.version,
    ADMIN,
    NOW
  )
  expect(t.kind).toBe("unchanged")
  expect(t.kind === "unchanged" && t.current.version).toBe(app.version)
})

test("edit records from and to for each changed field", async () => {
  const app = await pending()
  const t = app.edit(
    {
      profile: await profile({ phone: "0987654321" }),
      requestedStatus: "doctoral",
    },
    app.version,
    ADMIN,
    NOW
  )
  expect(t.kind === "changed" && t.events[0].changes).toEqual({
    phone: { from: "0912345678", to: "0987654321" },
    requested_status: { from: "master", to: "doctoral" },
  })
  const edited = next(t)
  expect([edited.status, edited.version, edited.requestedStatus]).toEqual([
    "pending",
    app.version + 1,
    "doctoral",
  ])
  expect(edited.profile?.fields.phone).toBe("0987654321")
  expect(t.kind === "changed" && t.events[0].actor).toEqual(ADMIN)
})

test("a stale version is version_conflict", async () => {
  const app = await pending()
  expect(() => app.accept(assignment(), app.version - 1, ADMIN, NOW)).toThrow(
    refusal("version_conflict")
  )
  expect(() =>
    app.edit(
      { profile: app.profile!, requestedStatus: "doctoral" },
      app.version + 1,
      ADMIN,
      NOW
    )
  ).toThrow(refusal("version_conflict"))
})

test("requestChanges needs a note", async () => {
  const app = await pending()
  expect(() =>
    app.requestChanges({ note: "  ", dueAt: at(DAY) }, app.version, ADMIN, NOW)
  ).toThrow(refusal("invalid_input", "note"))
})

test("requestChanges opens a change request with a changes_requested event", async () => {
  const app = await pending()
  const t = app.requestChanges(
    { note: "補學號", dueAt: at(7 * DAY) },
    app.version,
    ADMIN,
    NOW
  )
  const asked = next(t)
  expect(asked.status).toBe("changes_requested")
  expect(asked.changeRequest).toEqual({
    note: "補學號",
    requestedBy: ADMIN.id,
    requestedAt: NOW,
    dueAt: at(7 * DAY),
  })
  expect(t.kind === "changed" && t.events).toEqual([
    {
      kind: "changes_requested",
      actor: ADMIN,
      changes: { due_at: at(7 * DAY).toISOString() },
      at: NOW,
    },
  ])
})

test("requestChanges on an open request is wrong_state until it expires", async () => {
  const app = await pending()
  const asked = next(
    app.requestChanges(
      { note: "補學號", dueAt: at(7 * DAY) },
      app.version,
      ADMIN,
      NOW
    )
  )
  expect(() =>
    asked.requestChanges(
      { note: "再補", dueAt: at(8 * DAY) },
      asked.version,
      ADMIN,
      at(DAY)
    )
  ).toThrow(refusal("wrong_state"))
  expect(
    next(
      asked.requestChanges(
        { note: "再補", dueAt: at(14 * DAY) },
        asked.version,
        ADMIN,
        at(7 * DAY)
      )
    ).changeRequest?.dueAt
  ).toEqual(at(14 * DAY))
})

test("resubmit after the due time is edit_window_closed", async () => {
  const app = await pending()
  const asked = next(
    app.requestChanges(
      { note: "補學號", dueAt: at(7 * DAY) },
      app.version,
      ADMIN,
      NOW
    )
  )
  const change = {
    profile: await profile({ studentId: "312551999" }),
    requestedStatus: asked.requestedStatus,
  }
  expect(() => asked.resubmit(change, at(7 * DAY))).toThrow(
    refusal("edit_window_closed")
  )
  const t = asked.resubmit(change, at(7 * DAY - 1))
  const back = next(t)
  expect([back.status, back.changeRequest, back.version]).toEqual([
    "pending",
    null,
    asked.version + 1,
  ])
  expect(
    t.kind === "changed" && t.events.map((e) => [e.kind, e.actor, e.changes])
  ).toEqual([
    [
      "resubmitted",
      { kind: "applicant" },
      { student_id: { from: "312551000", to: "312551999" } },
    ],
  ])
})

test("resubmit without changes records an empty diff", async () => {
  const app = await pending()
  const asked = next(
    app.requestChanges(
      { note: "確認一下", dueAt: at(DAY) },
      app.version,
      ADMIN,
      NOW
    )
  )
  const t = asked.resubmit(
    { profile: asked.profile!, requestedStatus: asked.requestedStatus },
    at(HOUR)
  )
  expect(t.kind === "changed" && t.events[0].changes).toEqual({})
})

test("withdraw twice is unchanged the second time", async () => {
  const app = await pending()
  const t = app.withdraw(at(HOUR))
  const withdrawn = next(t)
  expect([withdrawn.status, withdrawn.closedAt]).toEqual([
    "withdrawn",
    at(HOUR),
  ])
  expect(
    t.kind === "changed" && t.events.map((e) => [e.kind, e.actor, e.changes])
  ).toEqual([["withdrawn", { kind: "applicant" }, null]])
  expect(withdrawn.withdraw(at(2 * HOUR)).kind).toBe("unchanged")
})

test("withdraw clears an open change request", async () => {
  const app = await pending()
  const asked = next(
    app.requestChanges({ note: "補", dueAt: at(DAY) }, app.version, ADMIN, NOW)
  )
  expect(next(asked.withdraw(at(HOUR))).changeRequest).toBeNull()
})

test("accept records the assignment, reviewer and an accepted event", async () => {
  const app = await pending()
  const t = app.accept(
    assignment({ mailGroups: ["lab-all", "lab-master"] }),
    app.version,
    ADMIN,
    at(HOUR)
  )
  const accepted = next(t)
  expect(accepted.status).toBe("provisioning")
  expect(accepted.reviewedBy).toBe(ADMIN.id)
  expect(accepted.reviewedAt).toEqual(at(HOUR))
  expect(accepted.assignment?.status).toBe("master")
  expect(accepted.assignment?.cohort.value).toBe(116)
  expect(accepted.assignment?.username.value).toBe("xmwang")
  expect(accepted.assignment?.mailGroups).toEqual([
    { groupId: "lab-all", addedAt: null },
    { groupId: "lab-master", addedAt: null },
  ])
  expect(t.kind === "changed" && t.events).toEqual([
    {
      kind: "accepted",
      actor: ADMIN,
      changes: {
        status: "master",
        cohort: 116,
        username: "xmwang",
        mail_groups: ["lab-all", "lab-master"],
      },
      at: at(HOUR),
    },
  ])
})

test("accept again with the same assignment and the old version is unchanged", async () => {
  const app = await pending()
  const accepted = next(app.accept(assignment(), app.version, ADMIN, NOW))
  expect(accepted.accept(assignment(), app.version, ADMIN, at(1)).kind).toBe(
    "unchanged"
  )
})

test("accept again with the mail groups in another order is unchanged", async () => {
  const app = await pending()
  const accepted = next(
    app.accept(assignment({ mailGroups: ["a", "b"] }), app.version, ADMIN, NOW)
  )
  expect(
    accepted.accept(
      assignment({ mailGroups: ["b", "a"] }),
      app.version,
      ADMIN,
      at(1)
    ).kind
  ).toBe("unchanged")
})

test("accept again with a different assignment is already_decided", async () => {
  const app = await pending()
  const accepted = next(app.accept(assignment(), app.version, ADMIN, NOW))
  expect(() =>
    accepted.accept(
      assignment({ cohort: Cohort.parse(117) }),
      app.version,
      ADMIN,
      at(1)
    )
  ).toThrow(refusal("already_decided"))
  expect(() =>
    accepted.accept(
      assignment({ mailGroups: ["lab-all"] }),
      accepted.version,
      ADMIN,
      at(1)
    )
  ).toThrow(refusal("already_decided"))
  const finished = next(withKeycloakId(accepted).finish(at(2)))
  expect(() =>
    finished.accept(
      assignment({ status: "doctoral" }),
      app.version,
      ADMIN,
      at(3)
    )
  ).toThrow(refusal("already_decided"))
})

test("reject after accept is wrong_state", async () => {
  const prov = await provisioning()
  expect(() => prov.reject(null, ADMIN, at(1))).toThrow(refusal("wrong_state"))
  const accepted = next(withKeycloakId(prov).finish(at(1)))
  expect(accepted.status).toBe("accepted")
  expect(() => accepted.reject(null, ADMIN, at(2))).toThrow(
    refusal("wrong_state")
  )
})

test("reject by an admin records the reviewer and note", async () => {
  const app = await pending()
  const asked = next(
    app.requestChanges({ note: "補", dueAt: at(DAY) }, app.version, ADMIN, NOW)
  )
  const t = asked.reject("不符資格", ADMIN, at(HOUR))
  const rejected = next(t)
  expect([
    rejected.status,
    rejected.closedAt,
    rejected.reviewNote,
    rejected.reviewedAt,
    rejected.reviewedBy,
    rejected.changeRequest,
  ]).toEqual(["rejected", at(HOUR), "不符資格", at(HOUR), ADMIN.id, null])
  expect(
    t.kind === "changed" && t.events.map((e) => [e.kind, e.actor, e.changes])
  ).toEqual([["rejected", ADMIN, null]])
})

test("reject twice is unchanged and system rejection has no reviewer", async () => {
  const app = await pending()
  const t = app.reject(null, SYSTEM, at(HOUR))
  const rejected = next(t)
  expect([rejected.status, rejected.reviewedBy, rejected.reviewNote]).toEqual([
    "rejected",
    null,
    null,
  ])
  expect(t.kind === "changed" && t.events[0].actor).toEqual({ kind: "system" })
  expect(rejected.reject("再拒一次", ADMIN, at(2 * HOUR)).kind).toBe(
    "unchanged"
  )
})

test("closeHasAccount only without a keycloak id", async () => {
  const prov = await provisioning()
  expect(() => withKeycloakId(prov).closeHasAccount(at(1))).toThrow(
    refusal("wrong_state")
  )
  const t = prov.closeHasAccount(at(HOUR))
  const closed = next(t)
  expect([closed.status, closed.closedAt, closed.reviewedBy]).toEqual([
    "rejected",
    at(HOUR),
    ADMIN.id,
  ])
  expect(closed.assignment).toEqual(prov.assignment)
  expect(
    t.kind === "changed" && t.events.map((e) => [e.kind, e.actor, e.changes])
  ).toEqual([["rejected", { kind: "system" }, { reason: "has_account" }]])
  const open = await pending()
  expect(() => open.closeHasAccount(NOW)).toThrow(refusal("wrong_state"))
})

test("reassign changes username or cohort only while provisioning", async () => {
  const prov = await provisioning()
  expect(prov.reassign({}, at(1)).kind).toBe("unchanged")
  expect(
    prov.reassign(
      { username: Username.restore("xmwang"), cohort: Cohort.parse(116) },
      at(1)
    ).kind
  ).toBe("unchanged")
  const t = prov.reassign({ username: Username.restore("xmwang2") }, at(1))
  const moved = next(t)
  expect([
    moved.version,
    moved.assignment?.username.value,
    moved.assignment?.cohort.value,
  ]).toEqual([prov.version + 1, "xmwang2", 116])
  expect(t.kind === "changed" && t.events).toEqual([])
  const recohort = next(prov.reassign({ cohort: Cohort.parse(117) }, at(1)))
  expect([
    recohort.assignment?.username.value,
    recohort.assignment?.cohort.value,
  ]).toEqual(["xmwang", 117])
  const open = await pending()
  expect(() => open.reassign({ cohort: Cohort.parse(117) }, NOW)).toThrow(
    refusal("wrong_state")
  )
})

test("finish needs a keycloak id", async () => {
  const prov = await provisioning()
  expect(() => prov.finish(at(1))).toThrow(refusal("wrong_state"))
  const t = withKeycloakId(prov).finish(at(HOUR))
  const done = next(t)
  expect([done.status, done.closedAt, done.keycloakId]).toEqual([
    "accepted",
    at(HOUR),
    "kc-1",
  ])
  expect(
    t.kind === "changed" && t.events.map((e) => [e.kind, e.actor, e.changes])
  ).toEqual([["provisioned", { kind: "system" }, null]])
  expect(() => done.finish(at(2 * HOUR))).toThrow(refusal("wrong_state"))
})

test("purge clears personal data and keeps the assignment", async () => {
  const prov = await provisioning()
  const done = next(withKeycloakId(prov).finish(at(HOUR)))
  const t = done.purge(at(DAY))
  const purged = next(t)
  expect([
    purged.status,
    purged.email,
    purged.profile,
    purged.reviewNote,
    purged.changeRequest,
    purged.purgedAt,
    purged.requestedStatus,
  ]).toEqual(["accepted", null, null, null, null, at(DAY), "master"])
  expect(purged.assignment).toEqual(done.assignment)
  expect(
    t.kind === "changed" && t.events.map((e) => [e.kind, e.actor, e.changes])
  ).toEqual([["purged", { kind: "system" }, null]])
  expect(purged.purge(at(2 * DAY)).kind).toBe("unchanged")

  const rejected = next((await pending()).reject("不符", ADMIN, NOW)).purge(
    at(DAY)
  )
  expect(next(rejected).reviewNote).toBeNull()

  expect(() => prov.purge(at(DAY))).toThrow(refusal("wrong_state"))
  const open = await pending()
  expect(() => open.purge(at(DAY))).toThrow(refusal("wrong_state"))
})

test("restore round-trips the snapshot", async () => {
  const app = await pending()
  expect(Application.restore(app.snapshot).snapshot).toEqual(app.snapshot)
})

test("returned dates and arrays are copies", async () => {
  const app = await pending()
  app.createdAt.setTime(0)
  app.snapshot.createdAt.setTime(0)
  expect(app.createdAt).toEqual(NOW)

  const prov = next(
    app.accept(assignment({ mailGroups: ["lab-all"] }), app.version, ADMIN, NOW)
  )
  ;(prov.assignment!.mailGroups as unknown[]).push({
    groupId: "x",
  })
  prov.assignment!.mailGroups[0].groupId = "y"
  ;(prov.snapshot.assignment!.mailGroups as unknown[]).length = 0
  prov.reviewedAt!.setTime(0)
  expect(prov.assignment?.mailGroups).toEqual([
    { groupId: "lab-all", addedAt: null },
  ])
  expect(prov.reviewedAt).toEqual(NOW)

  const asked = next(
    app.requestChanges({ note: "補", dueAt: at(DAY) }, app.version, ADMIN, NOW)
  )
  asked.changeRequest!.dueAt.setTime(0)
  expect(asked.changeRequest?.dueAt).toEqual(at(DAY))

  const groups = ["lab-all"]
  const input = assignment({ mailGroups: groups })
  const accepted = next(app.accept(input, app.version, ADMIN, NOW))
  groups.push("late")
  expect(accepted.assignment?.mailGroups.map((g) => g.groupId)).toEqual([
    "lab-all",
  ])
})

test("the source snapshot is copied on restore", async () => {
  const snapshot = (await pending()).snapshot
  const app = Application.restore(snapshot)
  snapshot.createdAt.setTime(0)
  expect(app.createdAt).toEqual(NOW)
  expect(Object.isFrozen(app)).toBe(true)
})

test("accept keeps one copy of a duplicated mail group", async () => {
  const app = await pending()
  const accepted = next(
    app.accept(
      assignment({ mailGroups: ["b", "a", "b"] }),
      app.version,
      ADMIN,
      NOW
    )
  )
  expect(accepted.assignment?.mailGroups.map((g) => g.groupId)).toEqual([
    "b",
    "a",
  ])
})

test.each([-1, 0])(
  "requestChanges refuses a dueAt at or before now (%p)",
  async (offset) => {
    const app = await pending()
    expect(() =>
      app.requestChanges(
        { note: "補學號", dueAt: at(offset) },
        app.version,
        ADMIN,
        NOW
      )
    ).toThrow(refusal("invalid_input", "dueAt"))
  }
)

test("reject does not take the applicant as the actor", async () => {
  const app = await pending()
  // @ts-expect-error the applicant cannot reject an application
  expect(() => app.reject(null, APPLICANT, NOW)).not.toThrow()
})
