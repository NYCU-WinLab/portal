import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listIpUsers } from "@/lib/actions/ip-users"
import { requireActor } from "@/lib/auth/session"

import { adminsNav, adminsPage } from "../nav"
import { IpUserTable } from "./ip-user-table"

export const dynamic = "force-dynamic"

export default async function IpUsersPage() {
  const actor = await requireActor("/admins/ip-users")
  await requireAdminPage(actor, "portal")
  const { settings, entries } = await runAction(listIpUsers, actor, {})

  return (
    <PortalShell page={adminsPage} nav={adminsNav}>
      <div className="flex flex-col gap-8">
        <PageHeader title="IP 使用者" />
        {settings ? (
          <p className="text-muted-foreground">
            {settings.subnet}，閘道 {settings.gateway}，DNS{" "}
            {settings.dnsServers.join("、")}，資料更新於{" "}
            {settings.sourceUpdatedOn}
          </p>
        ) : (
          <p className="text-destructive">還沒有設定網段</p>
        )}
        <IpUserTable entries={entries} />
      </div>
    </PortalShell>
  )
}
