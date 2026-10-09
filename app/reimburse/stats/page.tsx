import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { getReimburseStats } from "@/lib/actions/reimburse"
import { requireActor } from "@/lib/auth/session"
import { ntd } from "@/lib/money"

import { reimburseNav, reimbursePage } from "../nav"
import { MonthlyChart } from "./month-bars"

export const dynamic = "force-dynamic"

export default async function ReimburseStatsPage() {
  const actor = await requireActor("/reimburse/stats")
  const { months, applicants } = await runAction(getReimburseStats, actor, {})

  return (
    <PortalShell page={reimbursePage} nav={reimburseNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="統計" />
        {months.length === 0 ? (
          <EmptyState noun="紀錄" />
        ) : (
          <>
            <section className="flex flex-col gap-4">
              <SectionHeader title="每月" />
              <MonthlyChart months={months} />
            </section>
            <section className="flex flex-col gap-2">
              <SectionHeader title="每位申請人" />
              <ul className="flex stagger-rise flex-col">
                {applicants.map((row) => (
                  <li
                    key={row.applicantId ?? row.name}
                    className="flex min-h-14 flex-col gap-1 border-b border-border py-2 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <span className="w-24 shrink-0 font-medium">
                      {row.name}
                    </span>
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      {row.owed > 0 && `未轉帳 ${ntd(row.owed)}`}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {row.entries} 筆，{ntd(row.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </PortalShell>
  )
}
