import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { listSshKeyMembers } from "@/lib/actions/keys"
import { requireActor } from "@/lib/auth/session"

import { CopyKey } from "../key-forms"
import { keysNav, keysPage } from "../nav"

export const dynamic = "force-dynamic"

// Every member's public keys, to put on a machine you open for them. A row
// copies all of a member's keys; opened, it copies one.
export default async function KeyMembersPage() {
  const actor = await requireActor("/keys/members")
  const { members } = await runAction(listSshKeyMembers, actor, {})

  return (
    <PortalShell page={keysPage} nav={keysNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="成員" />
        <Focus>
          <FocusLabel>有金鑰的成員</FocusLabel>
          <FocusTitle>
            <FocusHighlight>{members.length}</FocusHighlight> 位
          </FocusTitle>
        </Focus>
        {members.length === 0 ? (
          <EmptyState noun="金鑰" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {members.map((member) => (
              <ExpandRow
                key={member.username}
                summary={
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{member.name}</span>
                    <span className="truncate text-muted-foreground">
                      {member.username}，{member.keys.length} 把
                    </span>
                  </span>
                }
                actions={
                  <CopyKey
                    label={member.name}
                    line={member.keys.map((key) => key.line).join("\n")}
                  />
                }
              >
                <ul className="flex flex-col">
                  {member.keys.map((key) => (
                    <li
                      key={key.fingerprint}
                      className="flex min-h-14 items-center gap-4 border-b border-border py-3 last:border-b-0"
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">
                          {key.machine ?? key.label}
                        </span>
                        {key.description && (
                          <span className="truncate text-muted-foreground">
                            {key.description}
                          </span>
                        )}
                        <span className="truncate font-mono text-muted-foreground">
                          {key.type} {key.fingerprint}
                        </span>
                      </div>
                      <CopyKey
                        label={`${member.name} 的 ${key.machine ?? key.label}`}
                        line={key.line}
                      />
                    </li>
                  ))}
                </ul>
              </ExpandRow>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
