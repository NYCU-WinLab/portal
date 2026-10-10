import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { getTripStats } from "@/lib/actions/trip"
import { requireActor } from "@/lib/auth/session"

import { tripNav, tripPage } from "../nav"

export const dynamic = "force-dynamic"

const megabytes = (bytes: number) =>
  `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`

// Who uploaded what: everyone for a trip admin, yourself otherwise.
export default async function TripStatsPage() {
  const actor = await requireActor("/trip/stats")
  const { members } = await runAction(getTripStats, actor, {})

  return (
    <PortalShell page={tripPage} nav={tripNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="統計" />
        {members.length === 0 ? (
          <EmptyState noun="上傳" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {members.map((row) => (
              <li
                key={row.userId}
                className="flex min-h-14 items-center gap-4 border-b border-border py-2"
              >
                <span className="min-w-0 flex-1 font-medium">{row.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {row.trips} 趟，{row.files} 份，{megabytes(row.bytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
