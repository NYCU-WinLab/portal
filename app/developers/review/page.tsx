import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listDeveloperScopeRequests } from "@/lib/actions/developers"
import { requireActor } from "@/lib/auth/session"
import { SCOPES, type Scope } from "@/lib/developers/policy"

import { developersNav, developersPage } from "../nav"
import { ReviewButtons } from "./review-buttons"

export const dynamic = "force-dynamic"

export default async function ReviewPage() {
  const actor = await requireActor("/developers/review")
  const admin = await isAdmin(actor, "portal")
  const requests = admin
    ? (await runAction(listDeveloperScopeRequests, actor, {})).requests
    : []

  return (
    <PortalShell page={developersPage} nav={developersNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="審核資料權限" />
        {!admin ? (
          <p className="text-muted-foreground">只有全站管理員可以審核</p>
        ) : requests.length === 0 ? (
          <EmptyState noun="待審申請" />
        ) : (
          <ul className="flex flex-col">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 border-b border-border py-4"
              >
                <span className="font-medium">
                  {r.app}（{r.owner}）申請
                  {r.scopes
                    .map((s) => SCOPES[s as Scope]?.label ?? s)
                    .join("、")}
                </span>
                <span className="text-muted-foreground">{r.purpose}</span>
                <ReviewButtons id={r.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
