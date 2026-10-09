import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { getBentoStats } from "@/lib/actions/bento"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"
import { ntd } from "@/lib/bento"

import { bentoNav, bentoPage } from "../nav"

export const dynamic = "force-dynamic"

// How much each member has eaten: everyone for a bento admin, yourself
// otherwise.
export default async function BentoStatsPage() {
  const actor = await requireActor("/bento/stats")
  const { members } = await runAction(getBentoStats, actor, {})

  return (
    <PortalShell page={bentoPage} nav={bentoNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="統計" />
        {members.length === 0 ? (
          <EmptyState noun="點餐" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex min-h-14 flex-col gap-1 border-b border-border py-2 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="w-24 shrink-0 font-medium">{member.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {member.favorite &&
                    `${member.favorite.name} × ${member.favorite.count}`}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {member.dishes} 份，{member.kinds} 種，{ntd(member.spent)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
