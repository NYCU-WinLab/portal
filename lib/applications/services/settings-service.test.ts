import { describe, expect, test } from "bun:test"

import { Refusal } from "@/lib/refusal"
import { ApplicationRefusal } from "../domain/refusal"
import { FixedClock } from "../testing/clock"
import { FakeAuthority } from "../testing/fakes"
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
  const service = new SettingsService({
    settings,
    authority: new FakeAuthority({
      portalAdmins: [PORTAL_ADMIN],
      accountsAdminIds: [ACCOUNTS_ADMIN],
    }),
    clock,
  })
  return { settings, clock, service }
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
