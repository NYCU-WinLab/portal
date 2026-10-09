import { Focus, FocusLabel, FocusTitle } from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
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
  const [{ entries }, balance, admin] = await Promise.all([
    runAction(listReimburseEntries, actor, {}),
    runAction(getReimburseBalance, actor, {}),
    isAdmin(actor, "reimburse"),
  ])
  const members = admin ? await runAction(listMembers, actor, {}) : []
  const today = taipeiToday()

  return (
    <PortalShell page={reimbursePage} nav={reimburseNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="帳本"
          actions={admin && <AddEntries members={members} today={today} />}
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
        <Ledger
          entries={entries}
          admin={admin}
          members={members}
          today={today}
        />
      </div>
    </PortalShell>
  )
}
