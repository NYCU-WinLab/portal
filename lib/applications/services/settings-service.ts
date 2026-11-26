import { Refusal } from "@/lib/refusal"

import { ApplySiteUrl } from "../domain/values"
import type { Clock, ProcessorAuthority, SettingsStore } from "../ports"

type Deps = {
  settings: SettingsStore
  authority: ProcessorAuthority
  clock: Clock
}

export type ApplySiteSetting = {
  url: string | null
  updatedAt: Date | null
  updatedBy: string | null
}

/** The account-application settings; only portal admins and accounts admins may read or change them. */
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

  private async requireAdmin(userId: string): Promise<void> {
    const allowed =
      (await this.d.authority.isPortalAdmin(userId)) ||
      (await this.d.authority.isAccountsAdmin(userId))
    if (!allowed) throw new Refusal("只有審核帳號申請的人可以看或改這個設定")
  }
}
