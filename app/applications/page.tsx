import Link from "next/link"

import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import {
  listApplicationSettings,
  listLabApplications,
} from "@/lib/actions/applications"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { ApplicationList } from "./application-list"
import { applicationsNav, applicationsPage } from "./nav"

export const dynamic = "force-dynamic"

export default async function ApplicationsPage() {
  const actor = await requireActor("/applications")
  await requireAdminPage(actor, "accounts")
  const [open, closed, settings, members] = await Promise.all([
    runAction(listLabApplications, actor, { closed: false }),
    runAction(listLabApplications, actor, { closed: true }),
    runAction(listApplicationSettings, actor, {}),
    runAction(listMembers, actor, {}),
  ])
  const waiting = open.filter((item) => item.status === "pending").length

  return (
    <PortalShell page={applicationsPage} nav={applicationsNav}>
      <div className="flex flex-col gap-8">
        <PageHeader title="帳號申請" />
        {settings.warnings.noProcessors && (
          <p className="text-destructive">
            沒有 Accounts 管理員，新申請沒有人處理
          </p>
        )}
        {settings.warnings.noNotifiees && (
          <p className="text-destructive">
            沒有通知對象，新申請不會寄信通知任何人；到
            <Link
              href="/applications/settings"
              prefetch
              className="underline underline-offset-4"
            >
              設定
            </Link>
            加人
          </p>
        )}
        <Focus>
          <FocusLabel>待審核</FocusLabel>
          <FocusTitle>
            <FocusHighlight>{waiting}</FocusHighlight> 筆申請
          </FocusTitle>
        </Focus>
        <ApplicationList
          open={open}
          closed={closed}
          names={Object.fromEntries(members.map((m) => [m.id, m.name]))}
          groups={settings.mailGroups}
        />
      </div>
    </PortalShell>
  )
}
