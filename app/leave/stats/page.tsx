import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { listMeetingStats } from "@/lib/actions/stats"
import { requireActor } from "@/lib/auth/session"

import { leaveNav, leavePage } from "../nav"

export const dynamic = "force-dynamic"

// How often each member has been away: everyone for a meetings admin,
// yourself otherwise.
export default async function LeaveStatsPage() {
  const actor = await requireActor("/leave/stats")
  const { members } = await runAction(listMeetingStats, actor, {})
  const rows = members
    .filter((row) => row.leaves + row.leaveScheduled > 0)
    .sort((a, b) => b.leaves - a.leaves || a.name.localeCompare(b.name))

  return (
    <PortalShell page={leavePage} nav={leaveNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="統計" />
        {rows.length === 0 ? (
          <EmptyState noun="請假" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {rows.map((row) => (
              <li
                key={row.userId}
                className="flex min-h-14 items-center gap-4 border-b border-border py-2"
              >
                <span className="min-w-0 flex-1 font-medium">{row.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {row.leaves} 次
                  {row.leaveScheduled > 0 &&
                    `（之後 ${row.leaveScheduled} 次）`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
