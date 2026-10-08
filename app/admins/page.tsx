import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listAdmins, listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { adminAppKeys, adminApps } from "@/lib/apps"
import { requireActor } from "@/lib/auth/session"

import { GrantDialog } from "./grant-dialog"
import { RevokeButton } from "./revoke-button"

export const dynamic = "force-dynamic"

export default async function AdminsPage() {
  const actor = await requireActor("/admins")
  const [{ apps }, canEdit] = await Promise.all([
    runAction(listAdmins, actor, {}),
    isAdmin(actor, "portal"),
  ])
  const members = canEdit ? await runAction(listMembers, actor, {}) : []

  return (
    <PortalShell
      page={{ label: "管理員", href: "/admins", tip: "各 app 的管理員" }}
    >
      <div className="flex flex-col gap-12">
        <PageHeader
          title="管理員"
          actions={
            canEdit && (
              <GrantDialog
                members={members}
                apps={adminAppKeys.map((app) => ({
                  value: app,
                  label: adminApps[app],
                }))}
              />
            )
          }
        />
        {apps.map(({ app, label, admins }) => (
          <section key={app} className="flex flex-col gap-2">
            <SectionHeader title={label} />
            <ul className="flex flex-col">
              {admins.length === 0 && (
                <li className="flex min-h-14 items-center border-b border-border text-muted-foreground">
                  無
                </li>
              )}
              {admins.map((admin) => (
                <li
                  key={admin.userId}
                  className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                >
                  <span className="flex-1">{admin.name}</span>
                  {canEdit && (
                    <RevokeButton
                      userId={admin.userId}
                      app={app}
                      name={admin.name}
                      label={label}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PortalShell>
  )
}
