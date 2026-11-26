import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import {
  getApplicationSettings,
  listApplicationSettings,
} from "@/lib/actions/applications"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { taipeiTime } from "@/lib/applications/review-display"
import { requireActor } from "@/lib/auth/session"

import { applicationsNav, applicationsPage } from "../nav"
import { ApplySiteSection, MailGroupSection, NotifieeSection } from "./forms"

export const dynamic = "force-dynamic"

export default async function ApplicationSettingsPage() {
  const actor = await requireActor("/applications/settings")
  await requireAdminPage(actor, "accounts")
  const [settings, site, members] = await Promise.all([
    runAction(listApplicationSettings, actor, {}),
    runAction(getApplicationSettings, actor, {}),
    runAction(listMembers, actor, {}),
  ])

  // Every group already on, then the ones this member manages and may turn on.
  const groups = [
    ...settings.mailGroups.map((g) => ({
      groupId: g.groupId,
      address: g.address ?? g.groupId,
      enabled: true,
    })),
    ...settings.offerableGroups.map((g) => ({ ...g, enabled: false })),
  ]
  const editor = site.updatedBy
    ? (members.find((m) => m.id === site.updatedBy)?.name ?? "已刪除的成員")
    : null

  return (
    <PortalShell page={applicationsPage} nav={applicationsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="申請設定" />
        <NotifieeSection
          notifiees={settings.notifiees}
          members={members.map(({ id, name, email }) => ({ id, name, email }))}
        />
        <MailGroupSection groups={groups} />
        <ApplySiteSection
          url={site.applySiteUrl}
          changed={
            site.updatedAt && editor
              ? `${editor}，${taipeiTime(site.updatedAt)}`
              : null
          }
        />
      </div>
    </PortalShell>
  )
}
