import { notFound } from "next/navigation"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import {
  getMailGroup,
  listMailGroupChanges,
  listMailGroupManagers,
} from "@/lib/actions/groups"
import { requireActor } from "@/lib/auth/session"

import { groupsPage } from "../nav"
import { AddMembers } from "./add-members"
import { Managers } from "./managers"
import { RemoveMember } from "./remove-member"

export const dynamic = "force-dynamic"

const outcomeLabel: Record<string, string> = {
  ok: "成功",
  already: "已在名單",
  not_found: "不在名單",
  protected: "不能動",
  denied: "被拒",
  error: "失敗",
}

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor(`/groups/${id}`)
  const result = await runAction(getMailGroup, actor, { groupId: id })
  if (result.status === "unconfigured") notFound()
  if (result.status !== "ok")
    return (
      <PortalShell page={groupsPage}>
        <p className="text-destructive">{result.detail}</p>
      </PortalShell>
    )
  const { group, members } = result.data
  const [{ changes }, { managers }, admin] = await Promise.all([
    runAction(listMailGroupChanges, actor, { groupId: group.id }),
    runAction(listMailGroupManagers, actor, { groupId: group.id }),
    isAdmin(actor, "portal"),
  ])
  const everyone = admin ? await runAction(listMembers, actor, {}) : []
  const sorted = [...members].sort((a, b) =>
    (a.email ?? "").localeCompare(b.email ?? "")
  )

  return (
    <PortalShell page={groupsPage}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={group.name}
          actions={<AddMembers groupId={group.id} />}
        />
        <p className="text-muted-foreground">
          {group.email}，{members.length} 人
        </p>
        <section className="flex flex-col gap-2">
          <SectionHeader title="成員" />
          <ul className="flex stagger-rise flex-col">
            {sorted.map((member) => (
              <li
                key={member.id ?? member.email}
                className="flex min-h-14 items-center gap-4 border-b border-border py-2"
              >
                <span className="min-w-0 flex-1 truncate">
                  {member.email ?? "（沒有信箱）"}
                </span>
                {member.role !== "MEMBER" && (
                  <span className="shrink-0 text-muted-foreground">
                    {member.role}
                  </span>
                )}
                {member.role === "MEMBER" && member.email && (
                  <RemoveMember groupId={group.id} email={member.email} />
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-2">
          <SectionHeader title="管理者" />
          <Managers
            groupId={group.id}
            managers={managers}
            members={everyone}
            canEdit={admin}
          />
        </section>
        {changes.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="最近變更" />
            <ul className="flex flex-col">
              {changes.map((change, i) => (
                <li
                  key={i}
                  className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                >
                  <span className="w-20 shrink-0 text-muted-foreground">
                    {change.action === "add" ? "加入" : "移出"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {change.email}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {change.actor ?? ""}，
                    {outcomeLabel[change.outcome] ?? change.outcome}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PortalShell>
  )
}
