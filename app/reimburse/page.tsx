import { Focus, FocusLabel, FocusTitle } from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import {
  getReimburseBalance,
  listReimburseEntries,
} from "@/lib/actions/reimburse"
import { requireActor } from "@/lib/auth/session"
import { taipeiToday } from "@/lib/leave-dates"
import { ntd } from "@/lib/money"
import { cn } from "@/lib/utils"

import { AddEntries } from "./entry-forms"
import { Ledger } from "./ledger"
import { reimburseNav, reimbursePage } from "./nav"

export const dynamic = "force-dynamic"

export default async function ReimbursePage() {
  const actor = await requireActor("/reimburse")
  await requireAdminPage(actor, "reimburse")
  const [{ entries }, balance, members] = await Promise.all([
    runAction(listReimburseEntries, actor, {}),
    runAction(getReimburseBalance, actor, {}),
    runAction(listMembers, actor, {}),
  ])
  const today = taipeiToday()

  return (
    <PortalShell page={reimbursePage} nav={reimburseNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="帳本"
          actions={<AddEntries members={members} today={today} />}
        />
        <Focus>
          <FocusLabel>餘額</FocusLabel>
          <FocusTitle
            className={cn(
              "tabular-nums",
              balance.balance < 0 ? "text-destructive" : "text-primary"
            )}
          >
            {balance.balance < 0 && "−"}
            {ntd(Math.abs(balance.balance))}
          </FocusTitle>
        </Focus>
        <Ledger entries={entries} members={members} today={today} />
      </div>
    </PortalShell>
  )
}
