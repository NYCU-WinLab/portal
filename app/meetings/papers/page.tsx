import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listPapers } from "@/lib/actions/papers"
import { requireActor } from "@/lib/auth/session"
import { dateLabel } from "@/lib/leave-dates"

import { meetingsNav, meetingsPage } from "../nav"
import { PaperDialog, PaperRowActions } from "./paper-actions"

export const dynamic = "force-dynamic"

export default async function PapersPage() {
  const actor = await requireActor("/meetings/papers")
  const [{ papers }, admin] = await Promise.all([
    runAction(listPapers, actor, {}),
    isAdmin(actor, "meetings"),
  ])

  return (
    <PortalShell page={meetingsPage} nav={meetingsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="論文" actions={admin && <PaperDialog />} />
        {papers.length === 0 ? (
          <EmptyState noun="論文" />
        ) : (
          <ul className="flex flex-col">
            {papers.map((paper) => (
              <li
                key={paper.id}
                className="flex min-h-14 flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  {paper.url ? (
                    <a
                      href={paper.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {paper.title}
                    </a>
                  ) : (
                    <span>{paper.title}</span>
                  )}
                  <span className="text-muted-foreground">
                    {[
                      paper.venue,
                      paper.lastPresented &&
                        `${paper.lastPresented.slice(0, 4)} 年 ${dateLabel(paper.lastPresented)}報告過`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {admin && <PaperRowActions paper={paper} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
