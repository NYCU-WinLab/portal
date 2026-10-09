import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listPresenters } from "@/lib/actions/presenters"
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

export default async function PresentersPage() {
  const actor = await requireActor("/meetings/presenters")
  const [{ presenters }, admin] = await Promise.all([
    runAction(listPresenters, actor, {}),
    isAdmin(actor, "meetings"),
  ])
  const members = admin ? await runAction(listMembers, actor, {}) : []
  const listed = new Set(presenters.map((row) => row.userId))

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
          <ol className="flex flex-col">
            {presenters.map((row, index) => (
              <li
                key={row.userId}
                className="flex min-h-14 items-center gap-4 border-b border-border py-2"
              >
                <span className="w-8 shrink-0 text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 font-medium">{row.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {[
                    row.status ? statusLabel[row.status] : "不在實驗室",
                    row.cohort && `${row.cohort} 級`,
                    !row.inRotation && "不排",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {admin && (
                  <PresenterRowActions userId={row.userId} name={row.name} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </PortalShell>
  )
}
