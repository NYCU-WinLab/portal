import { FieldList, FieldRow } from "@/components/field-list"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export default async function Home() {
  const actor = await requireActor("/")
  const member = await runAction(whoami, actor, {})

  return (
    <PortalShell>
      <div className="flex flex-col gap-12">
        <PageHeader title={member.name} />
        <FieldList>
          <FieldRow label="姓名">{member.name}</FieldRow>
          <FieldRow label="實驗室帳號">{member.username ?? "未提供"}</FieldRow>
          <FieldRow label="信箱">{member.email}</FieldRow>
        </FieldList>
      </div>
    </PortalShell>
  )
}
