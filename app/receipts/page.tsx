import { Suspense } from "react"

import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { NumberTicker } from "@/components/ui/number-ticker"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listReceipts } from "@/lib/actions/receipts"
import { requireActor } from "@/lib/auth/session"

import { receiptsPage } from "./nav"
import { UploadReceipt } from "./receipt-forms"
import { ReceiptList } from "./receipt-list"

export const dynamic = "force-dynamic"

export default async function ReceiptsPage() {
  const actor = await requireActor("/receipts")
  if (!(await isAdmin(actor, "receipts")))
    return (
      <PortalShell page={receiptsPage} layout="spotlight">
        <StatusPage title="收據只有收據管理員能看" />
      </PortalShell>
    )
  const { receipts, projects } = await runAction(listReceipts, actor, {})
  const pending = receipts.filter((receipt) => receipt.status === "pending")

  return (
    <PortalShell page={receiptsPage}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="收據"
          actions={<UploadReceipt projects={projects} />}
        />
        <Focus>
          <FocusLabel>待審核</FocusLabel>
          <FocusTitle>
            {pending.length === 0 ? (
              "都審完了"
            ) : (
              <>
                <FocusHighlight>
                  <NumberTicker value={pending.length} />
                </FocusHighlight>{" "}
                張審核中
              </>
            )}
          </FocusTitle>
        </Focus>
        <Suspense>
          <ReceiptList receipts={receipts} projects={projects} />
        </Suspense>
      </div>
    </PortalShell>
  )
}
