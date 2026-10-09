import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listPapers, listPaperTags } from "@/lib/actions/papers"
import { requireActor } from "@/lib/auth/session"

import { meetingsNav, meetingsPage } from "../nav"
import { PaperDialog, TagsDialog } from "./paper-actions"
import { PaperList } from "./paper-list"

export const dynamic = "force-dynamic"

export default async function PapersPage() {
  const actor = await requireActor("/meetings/papers")
  const [{ papers }, { tags }, admin] = await Promise.all([
    runAction(listPapers, actor, {}),
    runAction(listPaperTags, actor, {}),
    isAdmin(actor, "meetings"),
  ])

  return (
    <PortalShell page={meetingsPage} nav={meetingsNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="論文"
          actions={
            admin && (
              <>
                <TagsDialog tags={tags} />
                <PaperDialog tags={tags} />
              </>
            )
          }
        />
        <PaperList papers={papers} tags={tags} admin={admin} />
      </div>
    </PortalShell>
  )
}
