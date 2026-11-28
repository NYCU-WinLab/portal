import { describe, expect, test } from "bun:test"

import {
  applicationActions,
  applicationReviewActions,
  applicationSettingsActions,
  type ApplicantActions,
} from "@/lib/actions/applications"
import {
  build,
  type Applications,
  type Deps,
} from "@/lib/actions/applications/container"
import type { Actor } from "@/lib/actions/define"
import { actions, appOfAction } from "@/lib/actions/registry"
import {
  MailRatePolicy,
  RetentionPolicy,
} from "@/lib/applications/domain/policies"
import { ApplicationRefusal } from "@/lib/applications/domain/refusal"
import { MailComposer } from "@/lib/applications/services/mail-composer"
import { FixedClock } from "@/lib/applications/testing/clock"
import { FakeKeycloak } from "@/lib/applications/testing/fake-keycloak"
import {
  FakeAuthority,
  FakeMailGroups,
  FixedReservedNames,
} from "@/lib/applications/testing/fakes"
import { profileInput } from "@/lib/applications/testing/fixtures"
import {
  InMemoryApplicationStore,
  InMemorySettingsStore,
} from "@/lib/applications/testing/memory-store"
import { SequentialTokens } from "@/lib/applications/testing/tokens"
import { Refusal } from "@/lib/refusal"

process.env.BETTER_AUTH_URL = "https://portal.example.test"

const apply: Actor = { userId: "key-1", via: "api", service: "apply" }
const member: Actor = { userId: "member-1", via: "web" }
const otherService: Actor = { userId: "key-2", via: "api", service: "avatars" }

async function setup() {
  const store = await InMemoryApplicationStore.create()
  let ids = 0
  const settings = new InMemorySettingsStore({
    [member.userId]: { name: "王小明", email: "xmwang@winlab.tw" },
  })
  await settings.setApplySite(
    "https://apply.example.test",
    member.userId,
    new Date()
  )
  const deps: Deps = {
    store,
    directory: new FakeKeycloak(),
    provisioner: () => new FakeKeycloak(),
    authority: new FakeAuthority({ processorEmails: [] }),
    settings,
    mailGroups: new FakeMailGroups({}),
    reserved: new FixedReservedNames([]),
    mail: new MailComposer({
      siteUrl: "https://portal.example.test",
      resetPasswordUrl: "https://id.example.test/reset",
    }),
    tokens: new SequentialTokens(),
    retention: new RetentionPolicy(),
    rate: new MailRatePolicy(),
    clock: new FixedClock(),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  }
  return applicationActions(() => build(deps))
}

const processor: Actor = { userId: "processor-1", via: "mcp" }

async function setupSettings() {
  const store = await InMemoryApplicationStore.create()
  const settings = new InMemorySettingsStore({
    [processor.userId]: { name: "王小明", email: "xmwang@winlab.tw" },
  })
  const deps: Deps = {
    store,
    directory: new FakeKeycloak(),
    provisioner: () => new FakeKeycloak(),
    authority: new FakeAuthority({ accountsAdminIds: [processor.userId] }),
    settings,
    mailGroups: new FakeMailGroups({}),
    reserved: new FixedReservedNames([]),
    mail: new MailComposer({
      siteUrl: "https://portal.example.test",
      resetPasswordUrl: "https://id.example.test/reset",
    }),
    tokens: new SequentialTokens(),
    retention: new RetentionPolicy(),
    rate: new MailRatePolicy(),
    clock: new FixedClock(),
    newId: () => crypto.randomUUID(),
  }
  return applicationSettingsActions(() => build(deps))
}

const token = "t".repeat(43)
const form = { ...profileInput() }
// One valid input per action, so a refusal can only come from the actor.
const inputs = (a: ApplicantActions) =>
  [
    [
      a.submit,
      { email: "a@example.com", requestedStatus: "master", profile: form },
    ],
    [a.getForConfirm, { token }],
    [a.confirm, { token }],
    [a.getStatus, { token }],
    [a.sendLink, { email: "a@example.com" }],
    [a.withdraw, { token }],
    [a.getForEdit, { token }],
    [a.resubmit, { token, requestedStatus: "master", profile: form }],
  ] as const

describe("applicant actions", () => {
  test("define the eight actions for the apply site", async () => {
    const a = await setup()
    expect(Object.values(a).map((x) => x.name)).toEqual([
      "submit_lab_application",
      "get_lab_application_for_confirm",
      "confirm_lab_application",
      "get_lab_application_status",
      "send_lab_application_link",
      "withdraw_lab_application",
      "get_lab_application_for_edit",
      "resubmit_lab_application",
    ])
    for (const x of Object.values(a)) {
      expect(x.description.startsWith("Apply site only: ")).toBe(true)
      expect(x.additive).toBeUndefined()
    }
  })

  test("refuse a member and another service before anything runs", async () => {
    const a = await setup()
    for (const [action, input] of inputs(a)) {
      for (const actor of [member, otherService]) {
        const error = await (
          action.run as (a: Actor, i: unknown) => Promise<unknown>
        )(actor, input).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Refusal)
        expect(error).not.toBeInstanceOf(ApplicationRefusal)
      }
    }
  })

  test("the apply service reaches the service", async () => {
    const a = await setup()
    expect(await a.submit.run(apply, inputs(a)[0][1])).toEqual({ ok: true })
    expect(await a.sendLink.run(apply, { email: "a@example.com" })).toEqual({
      ok: true,
    })
  })

  test("an applicant's refusal is a code and counts as refused", async () => {
    const a = await setup()
    const error = await a.getStatus.run(apply, { token }).catch((e) => e)
    expect(error).toBeInstanceOf(ApplicationRefusal)
    expect(error.message).toBe("link_invalid")
  })

  test("tokens must look like tokens", () => {
    // Too short to be ours: refused by the input schema, never looked up.
    return setup().then((a) => {
      expect(a.confirm.input.safeParse({ token: "short" }).success).toBe(false)
      expect(
        a.confirm.input.safeParse({ token: "x".repeat(129) }).success
      ).toBe(false)
    })
  })

  test("only the mail and state-changing mutations announce themselves", async () => {
    const a = await setup()
    expect(a.submit.quiet).toBe(true)
    expect(a.sendLink.quiet).toBe(true)
    expect(a.confirm.idempotent).toBe(true)
    expect(a.withdraw.idempotent).toBe(true)
  })
})

describe("settings actions", () => {
  test("are a query and an idempotent, non-additive mutation", async () => {
    const a = await setupSettings()
    expect(a.get.name).toBe("get_application_settings")
    expect(a.get.kind).toBe("query")
    expect(a.setApplySiteUrl.name).toBe("set_apply_site_url")
    expect(a.setApplySiteUrl.kind).toBe("mutation")
    expect(a.setApplySiteUrl.idempotent).toBe(true)
    expect(a.setApplySiteUrl.additive).toBeUndefined()
    expect(
      a.setApplySiteUrl.input.safeParse({ url: "x".repeat(2049) }).success
    ).toBe(false)
  })

  test("a processor sets the address and reads it back", async () => {
    const a = await setupSettings()
    expect(await a.get.run(processor, {})).toEqual({
      applySiteUrl: null,
      updatedAt: null,
      updatedBy: null,
    })
    expect(
      await a.setApplySiteUrl.run(processor, {
        url: "https://apply.winlab.tw/",
      })
    ).toBe("https://apply.winlab.tw")
    expect(await a.get.run(processor, {})).toMatchObject({
      applySiteUrl: "https://apply.winlab.tw",
      updatedBy: processor.userId,
    })
  })

  test("a member and the apply service key are refused", async () => {
    const a = await setupSettings()
    for (const actor of [member, apply]) {
      for (const call of [
        () => a.get.run(actor, {}),
        () => a.setApplySiteUrl.run(actor, { url: "https://apply.winlab.tw" }),
      ]) {
        expect(await call().catch((e: unknown) => e)).toBeInstanceOf(Refusal)
      }
    }
  })
})

// The review actions: each hands the signed-in member's id and its input to
// one service method. The service's own tests cover what the methods do.
describe("review actions", () => {
  const ID = "00000000-0000-4000-8000-000000000001"
  const calls: unknown[][] = []
  const spy =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
      return { ok: true }
    }
  const stub = {
    review: {
      list: spy("list"),
      update: spy("update"),
      requestChanges: spy("requestChanges"),
      accept: spy("accept"),
      retryProvisioning: spy("retryProvisioning"),
      reject: spy("reject"),
    },
    settings: {
      list: spy("settingsList"),
      setNotifiee: spy("setNotifiee"),
      setMailGroup: spy("setMailGroup"),
    },
  } as unknown as Applications
  const r = applicationReviewActions(() => stub)
  const accept = {
    status: "master",
    cohort: 116,
    username: "alice",
    mailGroups: ["g1"],
  }
  const cases = [
    [r.list, { closed: true }, ["list", processor.userId, { closed: true }]],
    [
      r.update,
      { id: ID, version: 2, patch: { profile: { phone: "0912" } } },
      ["update", processor.userId, ID, 2, { profile: { phone: "0912" } }],
    ],
    [
      r.requestChanges,
      { id: ID, version: 2, note: "請補學號" },
      ["requestChanges", processor.userId, ID, 2, "請補學號"],
    ],
    [
      r.accept,
      { id: ID, version: 3, ...accept },
      ["accept", processor.userId, ID, 3, accept],
    ],
    [
      r.retryProvisioning,
      { id: ID, username: "bob" },
      ["retryProvisioning", processor.userId, ID, { username: "bob" }],
    ],
    [r.reject, { id: ID }, ["reject", processor.userId, ID, undefined]],
    [r.listSettings, {}, ["settingsList", processor.userId]],
    [
      r.setNotifiee,
      { userId: ID, notify: true },
      ["setNotifiee", processor.userId, ID, true],
    ],
    [
      r.setMailGroup,
      { groupId: "g1", enabled: false },
      ["setMailGroup", processor.userId, "g1", false],
    ],
  ] as const

  test("nine actions, accounts admins only, in no API app", () => {
    expect(cases.map(([a]) => a.name)).toEqual([
      "list_lab_applications",
      "update_lab_application",
      "request_lab_application_changes",
      "accept_lab_application",
      "retry_lab_application_provisioning",
      "reject_lab_application",
      "list_application_settings",
      "set_application_notifiee",
      "set_application_mail_group",
    ])
    for (const [a] of cases) {
      expect(a.admin).toBe("accounts")
      expect(a.mcpExcludedBecause).toBeUndefined()
      expect(a.additive).toBeUndefined()
      expect(/[一-鿿]/.test(a.title)).toBe(true)
      expect(actions.some((x) => x.name === a.name)).toBe(true)
      expect(appOfAction.get(a.name)).toBeNull()
    }
  })

  test("kind and idempotent flags", () => {
    expect(
      Object.fromEntries(
        cases.map(([a]) => [a.name, [a.kind, a.idempotent === true]])
      )
    ).toEqual({
      list_lab_applications: ["query", false],
      update_lab_application: ["mutation", true],
      request_lab_application_changes: ["mutation", false],
      accept_lab_application: ["mutation", true],
      retry_lab_application_provisioning: ["mutation", true],
      reject_lab_application: ["mutation", true],
      list_application_settings: ["query", false],
      set_application_notifiee: ["mutation", true],
      set_application_mail_group: ["mutation", true],
    })
  })

  test("each calls its service method with the member's id", async () => {
    for (const [action, input, expected] of cases) {
      calls.length = 0
      await (action.run as (a: Actor, i: unknown) => Promise<unknown>)(
        processor,
        action.input.parse(input)
      )
      expect(calls).toEqual([expected as unknown as unknown[]])
    }
  })

  test("a service key is refused before the service is called", async () => {
    for (const [action, input] of cases) {
      calls.length = 0
      const error = await (
        action.run as (a: Actor, i: unknown) => Promise<unknown>
      )(apply, input).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Refusal)
      expect(calls).toEqual([])
    }
  })

  test("inputs are bounded", () => {
    const ok = (
      a: { input: { safeParse(v: unknown): { success: boolean } } },
      v: unknown
    ) => a.input.safeParse(v).success
    expect(ok(r.requestChanges, { id: "x", version: 1, note: "n" })).toBe(false)
    expect(
      ok(r.requestChanges, { id: ID, version: 1, note: "n".repeat(2001) })
    ).toBe(false)
    expect(ok(r.reject, { id: ID, note: "n".repeat(2001) })).toBe(false)
    expect(ok(r.accept, { id: ID, version: 1, ...accept, cohort: 1.5 })).toBe(
      false
    )
    expect(ok(r.update, { id: ID, version: 0, patch: {} })).toBe(false)
  })
})
