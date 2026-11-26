import { describe, expect, test } from "bun:test"

import {
  applicationActions,
  type ApplicantActions,
} from "@/lib/actions/applications"
import { build, type Deps } from "@/lib/actions/applications/container"
import type { Actor } from "@/lib/actions/define"
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
    authority: new FakeAuthority({ processorEmails: [] }),
    settings,
    reserved: new FixedReservedNames([]),
    mail: new MailComposer({ siteUrl: "https://portal.example.test" }),
    tokens: new SequentialTokens(),
    retention: new RetentionPolicy(),
    rate: new MailRatePolicy(),
    clock: new FixedClock(),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  }
  return applicationActions(() => build(deps))
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
    [a.requestPasswordMail, { token }],
  ] as const

describe("applicant actions", () => {
  test("define the nine actions for the apply site", async () => {
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
      "send_lab_application_password_mail",
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
