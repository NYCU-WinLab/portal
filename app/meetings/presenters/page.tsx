import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listPresenters } from "@/lib/actions/presenters"
import { type MemberStats, listMeetingStats } from "@/lib/actions/stats"
import { requireActor } from "@/lib/auth/session"

import { meetingsNav, meetingsPage } from "../nav"
import { AddPresenter, PresenterRowActions } from "./presenter-actions"

export const dynamic = "force-dynamic"

const statusLabel: Record<string, string> = {
  doctoral: "博士",
  master: "碩士",
  undergrad: "大學部",
  alumni: "已畢業",
  teacher: "老師",
  assistant: "助理",
}

// 報告 2 次（排 1）: what happened, then what is scheduled, if anything.
function count(verb: string, done: number, next: number) {
  return `${verb} ${done} 次${next ? `（排 ${next}）` : ""}`
}

export default async function PresentersPage() {
  const actor = await requireActor("/meetings/presenters")
  const [{ presenters }, admin] = await Promise.all([
    runAction(listPresenters, actor, {}),
    isAdmin(actor, "meetings"),
  ])
  const [members, stats] = admin
    ? await Promise.all([
        runAction(listMembers, actor, {}),
        runAction(listMeetingStats, actor, {}),
      ])
    : [[], { members: [] as MemberStats[] }]
  const listed = new Set(presenters.map((row) => row.userId))
  const statsOf = new Map(stats.members.map((row) => [row.userId, row]))
  // Grouped by year in the programme (博三, 碩二), in turn order.
  const groups: { title: string; rows: typeof presenters }[] = []
  for (const row of presenters) {
    const title =
      row.grade ??
      (row.status ? statusLabel[row.status] : "不在實驗室") +
        (row.inRotation ? "" : "（不排）")
    const last = groups.at(-1)
    if (last?.title === title) last.rows.push(row)
    else groups.push({ title, rows: [row] })
  }

  return (
    <PortalShell page={meetingsPage} nav={meetingsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="報告順序"
          actions={
            admin && (
              <AddPresenter
                members={members.filter((member) => !listed.has(member.id))}
              />
            )
          }
        />
        {presenters.length === 0 ? (
          <EmptyState noun="報告人" />
        ) : (
          groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-2">
              <SectionHeader title={group.title} />
              <ol className="flex stagger-rise flex-col">
                {group.rows.map((row, index) => {
                  const stat = statsOf.get(row.userId)
                  return (
                    <li
                      key={row.userId}
                      className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                    >
                      <span className="w-8 shrink-0 text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 font-medium">
                        {row.name}
                      </span>
                      {stat && (
                        <span className="hidden shrink-0 gap-4 text-muted-foreground tabular-nums sm:flex">
                          <span>
                            {count(
                              "報告",
                              stat.presented,
                              stat.presentScheduled
                            )}
                          </span>
                          <span>
                            {count("提問", stat.asked, stat.askScheduled)}
                          </span>
                        </span>
                      )}
                      {admin && (
                        <PresenterRowActions
                          userId={row.userId}
                          name={row.name}
                        />
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>
          ))
        )}
      </div>
    </PortalShell>
  )
}
