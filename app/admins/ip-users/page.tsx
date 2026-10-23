import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listIpUsers } from "@/lib/actions/ip-users"
import { requireActor } from "@/lib/auth/session"

import { IpUserTable } from "./ip-user-table"

export const dynamic = "force-dynamic"

const page = { label: "Admins", href: "/admins", tip: "各 app 的管理員" }
const nav = [
  { label: "管理員", href: "/admins", tip: "各 app 的管理員" },
  { label: "IP 使用者", href: "/admins/ip-users", tip: "網段位址登記" },
]

export default async function IpUsersPage() {
  const actor = await requireActor("/admins/ip-users")
  if (!(await isAdmin(actor, "portal"))) redirect("/")
  const { settings, entries } = await runAction(listIpUsers, actor, {})

  return (
    <PortalShell page={page} nav={nav}>
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
