import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { listLabMembers } from "@/lib/actions/members"
import { requireActor } from "@/lib/auth/session"

import { MemberList } from "./member-list"
import { membersPage } from "./nav"

export const dynamic = "force-dynamic"

export default async function MembersPage() {
  const actor = await requireActor("/members")
  const members = await runAction(listLabMembers, actor, {})

  return (
    <PortalShell page={membersPage}>
      <div className="flex flex-col gap-8">
        <PageHeader title="成員" />
        <Focus>
          <FocusLabel>實驗室</FocusLabel>
          <FocusTitle>
            <FocusHighlight>{members.length}</FocusHighlight> 位成員
          </FocusTitle>
        </Focus>
        <MemberList members={members} />
      </div>
    </PortalShell>
  )
}
