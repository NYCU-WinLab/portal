import { describe, expect, test } from "bun:test"

import { Refusal } from "@/lib/refusal"
import { ApplicationRefusal } from "../domain/refusal"
import { FixedClock } from "../testing/clock"
import { FakeAuthority, FakeMailGroups } from "../testing/fakes"
import { NOW } from "../testing/fixtures"
import { InMemorySettingsStore } from "../testing/memory-store"
import { SettingsService } from "./settings-service"

const PORTAL_ADMIN = "00000000-0000-4000-8000-000000000021"
const ACCOUNTS_ADMIN = "00000000-0000-4000-8000-000000000022"
const MEMBER = "00000000-0000-4000-8000-000000000023"

function setup() {
  const settings = new InMemorySettingsStore({
    [PORTAL_ADMIN]: { name: "王小明", email: "a@winlab.tw" },
    [ACCOUNTS_ADMIN]: { name: "陳大文", email: "b@winlab.tw" },
    [MEMBER]: { name: "林小美", email: "c@winlab.tw" },
  })
  const clock = new FixedClock(NOW)
  const authority = new FakeAuthority({
    portalAdmins: [PORTAL_ADMIN],
    accountsAdminIds: [ACCOUNTS_ADMIN],
  })
  const mailGroups = new FakeMailGroups({
    g1: { address: "lab@winlab.tw", manageable: true },
    g2: { address: "other@winlab.tw", manageable: true },
    gp: { address: "gcp-x@winlab.tw", manageable: false },
  })
  const service = new SettingsService({
    settings,
    authority,
    mailGroups,
    clock,
  })
  return { settings, clock, service, authority }
}

describe("SettingsService", () => {
  test("an unset address reads as nulls", async () => {
    const { service } = setup()
    expect(await service.applySite(PORTAL_ADMIN)).toEqual({
      url: null,
      updatedAt: null,
      updatedBy: null,
    })
  })

  test.each([PORTAL_ADMIN, ACCOUNTS_ADMIN])(
    "admin %s sets and reads it",
    async (who) => {
      const { service } = setup()
      expect(await service.setApplySite(who, "https://apply.winlab.tw")).toBe(
        "https://apply.winlab.tw"
      )
      expect(await service.applySite(who)).toEqual({
        url: "https://apply.winlab.tw",
        updatedAt: NOW,
        updatedBy: who,
      })
    }
  )

  test("the address is stored as an origin", async () => {
    const { service, settings } = setup()
    await service.setApplySite(PORTAL_ADMIN, "  https://Apply.WinLab.tw/ ")
    expect((await settings.applySite()).url).toBe("https://apply.winlab.tw")
  })

  test("a member who is no admin is refused, read or write", async () => {
    const { service, settings } = setup()
    for (const call of [
      () => service.applySite(MEMBER),
      () => service.setApplySite(MEMBER, "https://apply.winlab.tw"),
    ]) {
      const error = await call().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Refusal)
    }
    expect((await settings.applySite()).url).toBeNull()
  })

  test.each([
    "http://apply.winlab.tw",
    "https://evilwinlab.tw",
    "https://winlab.tw.evil.com",
    "https://apply.winlab.tw/path",
    "https://apply.winlab.tw/?q=1",
    "https://apply.winlab.tw:8443",
    "not a url",
    "",
  ])("refuses %p and keeps the old address", async (raw) => {
    const { service, settings } = setup()
    await service.setApplySite(PORTAL_ADMIN, "https://apply.winlab.tw")
    const error = await service
      .setApplySite(PORTAL_ADMIN, raw)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApplicationRefusal)
    expect((error as ApplicationRefusal).code).toBe("invalid_input")
    expect((await settings.applySite()).url).toBe("https://apply.winlab.tw")
  })

  test("a non-processor is refused before the address is judged", async () => {
    const { service } = setup()
    const error = await service
      .setApplySite(MEMBER, "http://nope")
      .catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(ApplicationRefusal)
    expect(error).toBeInstanceOf(Refusal)
  })
})

describe("SettingsService notifiees and mail groups", () => {
  test("list shows notifiees, default groups with addresses and warnings", async () => {
    const { service, settings, authority } = setup()
    authority.managers = { g1: [ACCOUNTS_ADMIN] }
    expect(await service.list(ACCOUNTS_ADMIN)).toEqual({
      notifiees: [],
      mailGroups: [],
      warnings: { noProcessors: true, noNotifiees: true },
    })
    await service.setNotifiee(ACCOUNTS_ADMIN, MEMBER, true)
    await service.setMailGroup(ACCOUNTS_ADMIN, "g1", true)
    await settings.setMailGroup("gone", true, MEMBER, NOW)
    const view = await service.list(ACCOUNTS_ADMIN)
    expect(view.notifiees).toEqual([
      { userId: MEMBER, name: "林小美", email: "c@winlab.tw" },
    ])
    expect(view.mailGroups).toEqual([
      { groupId: "g1", address: "lab@winlab.tw" },
      { groupId: "gone", address: null },
    ])
    expect(view.warnings.noNotifiees).toBe(false)
  })

  test("noProcessors follows the processors' addresses", async () => {
    const { service, authority } = setup()
    authority.processors = ["b@winlab.tw"]
    expect((await service.list(ACCOUNTS_ADMIN)).warnings.noProcessors).toBe(
      false
    )
  })

  test("setNotifiee adds and removes, repeating changes nothing", async () => {
    const { service, settings } = setup()
    for (let i = 0; i < 2; i++)
      await service.setNotifiee(ACCOUNTS_ADMIN, MEMBER, true)
    expect(await settings.notifiees()).toHaveLength(1)
    for (let i = 0; i < 2; i++)
      await service.setNotifiee(ACCOUNTS_ADMIN, MEMBER, false)
    expect(await settings.notifiees()).toHaveLength(0)
  })

  test("enabling a group needs a manageable group the actor manages", async () => {
    const { service, settings, authority } = setup()
    authority.managers = { g1: [ACCOUNTS_ADMIN], gp: [ACCOUNTS_ADMIN] }
    await service.setMailGroup(ACCOUNTS_ADMIN, "g1", true)
    await service.setMailGroup(ACCOUNTS_ADMIN, "g1", true)
    expect(await settings.defaultMailGroups()).toEqual(["g1"])
    for (const group of ["g2", "gp"]) {
      const error = await service
        .setMailGroup(ACCOUNTS_ADMIN, group, true)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ApplicationRefusal)
      expect((error as ApplicationRefusal).code).toBe("mail_group_not_allowed")
    }
    expect(await settings.defaultMailGroups()).toEqual(["g1"])
  })

  test("disabling never checks the group or the manager", async () => {
    const { service, settings } = setup()
    await settings.setMailGroup("g2", true, MEMBER, NOW)
    await service.setMailGroup(ACCOUNTS_ADMIN, "g2", false)
    await service.setMailGroup(ACCOUNTS_ADMIN, "g2", false)
    expect(await settings.defaultMailGroups()).toEqual([])
  })

  test("only accounts admins reach the three; a portal admin does not", async () => {
    const { service, settings } = setup()
    for (const who of [PORTAL_ADMIN, MEMBER]) {
      for (const call of [
        () => service.list(who),
        () => service.setNotifiee(who, MEMBER, true),
        () => service.setMailGroup(who, "g1", false),
      ]) {
        const error = await call().catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Refusal)
      }
    }
    expect(await settings.notifiees()).toHaveLength(0)
  })
})
