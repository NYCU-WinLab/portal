import { Refusal } from "@/lib/refusal"

import { ApplicationRefusal } from "../domain/refusal"
import { ApplySiteUrl } from "../domain/values"
import type {
  Clock,
  MailGroups,
  ProcessorAuthority,
  SettingsStore,
} from "../ports"
import type { SettingsView } from "../views"

type Deps = {
  settings: SettingsStore
  authority: ProcessorAuthority
  mailGroups: MailGroups
  clock: Clock
}

export type ApplySiteSetting = {
  url: string | null
  updatedAt: Date | null
  updatedBy: string | null
}

/**
 * The account-application settings. The apply site's address may be read and
 * changed by portal admins and accounts admins; the notifiees and default
 * mail groups only by accounts admins, who are the processors.
 */
export class SettingsService {
  constructor(private readonly d: Deps) {}

  async applySite(actorUserId: string): Promise<ApplySiteSetting> {
    await this.requireAdmin(actorUserId)
    return this.d.settings.applySite()
  }

  /** Returns the stored origin. */
  async setApplySite(actorUserId: string, raw: string): Promise<string> {
    await this.requireAdmin(actorUserId)
    const url = ApplySiteUrl.parse(raw)
    await this.d.settings.setApplySite(url, actorUserId, this.d.clock.now())
    return url
  }

  async list(actorUserId: string): Promise<SettingsView> {
    await this.requireAccountsAdmin(actorUserId)
    const notifiees = await this.d.settings.notifiees()
    const groupIds = await this.d.settings.defaultMailGroups()
    const addresses = groupIds.length
      ? await this.d.mailGroups.addresses(groupIds)
      : new Map<string, string>()
    const on = new Set(groupIds)
    const managed = (await this.d.authority.managedGroups(actorUserId)).filter(
      (id) => !on.has(id)
    )
    const managedAddresses = managed.length
      ? await this.d.mailGroups.addresses(managed)
      : new Map<string, string>()
    const offerableGroups: SettingsView["offerableGroups"] = []
    for (const groupId of managed) {
      const address = managedAddresses.get(groupId)
      // A group Google does not give, or the portal may not touch, is not offered.
      if (address && (await this.d.mailGroups.isManageable(groupId)))
        offerableGroups.push({ groupId, address })
    }
    const processors = await this.d.authority.processorEmails()
    return {
      notifiees,
      mailGroups: groupIds.map((groupId) => ({
        groupId,
        address: addresses.get(groupId) ?? null,
      })),
      offerableGroups,
      warnings: {
        noProcessors: processors.length === 0,
        noNotifiees: notifiees.length === 0,
      },
    }
  }

  /** Repeating it leaves the same state. */
  async setNotifiee(
    actorUserId: string,
    userId: string,
    notify: boolean
  ): Promise<void> {
    await this.requireAccountsAdmin(actorUserId)
    await this.d.settings.setNotifiee(
      userId,
      notify,
      actorUserId,
      this.d.clock.now()
    )
  }

  /** Enabling needs a group the portal may touch and the actor manages; disabling never checks. */
  async setMailGroup(
    actorUserId: string,
    groupId: string,
    enabled: boolean
  ): Promise<void> {
    await this.requireAccountsAdmin(actorUserId)
    if (
      enabled &&
      !(
        (await this.d.mailGroups.isManageable(groupId)) &&
        (await this.d.authority.managesGroup(actorUserId, groupId))
      )
    )
      throw new ApplicationRefusal("mail_group_not_allowed")
    await this.d.settings.setMailGroup(
      groupId,
      enabled,
      actorUserId,
      this.d.clock.now()
    )
  }

  private async requireAccountsAdmin(userId: string): Promise<void> {
    if (!(await this.d.authority.isAccountsAdmin(userId)))
      throw new Refusal("只有審核帳號申請的人可以看或改這個設定")
  }

  private async requireAdmin(userId: string): Promise<void> {
    const allowed =
      (await this.d.authority.isPortalAdmin(userId)) ||
      (await this.d.authority.isAccountsAdmin(userId))
    if (!allowed) throw new Refusal("只有審核帳號申請的人可以看或改這個設定")
  }
}
