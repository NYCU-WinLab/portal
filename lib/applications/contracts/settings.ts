import { describe, expect, test } from "bun:test"
import type { SettingsStore } from "../ports"
import { NOW } from "../testing/fixtures"

export type SettingsSubject = {
  store: SettingsStore
  userId: string
  otherUserId: string
}

/** Behaviour every SettingsStore (in memory or Postgres) must share. */
export function settingsStoreContract(make: () => Promise<SettingsSubject>) {
  describe("settings store contract", () => {
    test("setNotifiee is idempotent both ways", async () => {
      const s = await make()
      await s.store.setNotifiee(s.userId, true, s.otherUserId, NOW)
      await s.store.setNotifiee(s.userId, true, s.otherUserId, NOW)
      const notifiees = await s.store.notifiees()
      expect(notifiees).toHaveLength(1)
      expect(notifiees[0].userId).toBe(s.userId)
      expect(notifiees[0].name).toEqual(expect.any(String))
      expect(notifiees[0].name.length).toBeGreaterThan(0)
      expect(notifiees[0].email).toContain("@")

      await s.store.setNotifiee(s.userId, false, s.otherUserId, NOW)
      await s.store.setNotifiee(s.userId, false, s.otherUserId, NOW)
      expect(await s.store.notifiees()).toEqual([])
    })

    test("setMailGroup is idempotent both ways", async () => {
      const s = await make()
      await s.store.setMailGroup("lab-all", true, s.userId, NOW)
      await s.store.setMailGroup("lab-all", true, s.userId, NOW)
      expect(await s.store.defaultMailGroups()).toEqual(["lab-all"])

      await s.store.setMailGroup("lab-all", false, s.userId, NOW)
      await s.store.setMailGroup("lab-all", false, s.userId, NOW)
      expect(await s.store.defaultMailGroups()).toEqual([])
    })

    test("the apply site is unset until a processor sets it", async () => {
      const s = await make()
      expect(await s.store.applySite()).toEqual({
        url: null,
        updatedAt: null,
        updatedBy: null,
      })
    })

    test("setApplySite is read back with who and when", async () => {
      const s = await make()
      await s.store.setApplySite("https://apply.winlab.tw", s.userId, NOW)
      expect(await s.store.applySite()).toEqual({
        url: "https://apply.winlab.tw",
        updatedAt: NOW,
        updatedBy: s.userId,
      })
    })

    test("setApplySite twice keeps the latest", async () => {
      const s = await make()
      const later = new Date(NOW.getTime() + 60_000)
      await s.store.setApplySite("https://apply.winlab.tw", s.userId, NOW)
      await s.store.setApplySite(
        "https://apply2.winlab.tw",
        s.otherUserId,
        later
      )
      expect(await s.store.applySite()).toEqual({
        url: "https://apply2.winlab.tw",
        updatedAt: later,
        updatedBy: s.otherUserId,
      })
    })
  })
}
