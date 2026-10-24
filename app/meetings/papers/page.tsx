import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listPapers, listPaperTags } from "@/lib/actions/papers"
import { requireActor } from "@/lib/auth/session"

import { meetingsNav, meetingsPage } from "../nav"
import { PapersAdmin } from "./paper-actions"
import { PaperList } from "./paper-list"

export const dynamic = "force-dynamic"

export default async function PapersPage() {
  const actor = await requireActor("/meetings/papers")
  const [{ papers, showPresented }, { tags }, admin] = await Promise.all([
    // Every paper: the list hides presented ones on the page, so the
    // switch answers at once.
    runAction(listPapers, actor, { presented: true }),
    runAction(listPaperTags, actor, {}),
    isAdmin(actor, "meetings"),
  ])

  return (
    <PortalShell page={meetingsPage} nav={meetingsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="論文"
          actions={admin && <PapersAdmin tags={tags} />}
        />
        <PaperList
          papers={papers}
          tags={tags}
          admin={admin}
          showPresented={showPresented}
        />
      </div>
    </PortalShell>
  )
}
