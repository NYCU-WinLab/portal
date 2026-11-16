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
import { listMembers } from "@/lib/actions/admins"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listSshServices } from "@/lib/actions/keys"
import { requireActor } from "@/lib/auth/session"

import { day, keysNav, keysPage, serviceLine } from "../nav"
import {
  CreateService,
  DeleteService,
  GrantMember,
  RevokeGrant,
  RotateServiceKey,
} from "./service-forms"

export const dynamic = "force-dynamic"

export default async function KeyServicesPage() {
  const actor = await requireActor("/keys/services")
  await requireAdminPage(actor, "portal")
  const [{ services }, members] = await Promise.all([
    runAction(listSshServices, actor, {}),
    runAction(listMembers, actor, {}),
  ])

  return (
    <PortalShell page={keysPage} nav={keysNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="服務" actions={<CreateService />} />
        <Focus>
          <FocusLabel>讀金鑰的服務</FocusLabel>
          <FocusTitle>
            <FocusHighlight>{services.length}</FocusHighlight> 個
          </FocusTitle>
        </Focus>
        {services.length === 0 ? (
          <EmptyState noun="服務" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {services.map((service) => (
              <ExpandRow
                key={service.id}
                summary={
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{service.name}</span>
                    <span className="truncate text-muted-foreground">
                      {[
                        service.open
                          ? "所有成員"
                          : `指定 ${service.grants.length} 人`,
                        service.lastReadAt
                          ? `上次讀取 ${day(service.lastReadAt)}`
                          : "還沒讀過",
                      ].join("，")}
                    </span>
                  </span>
                }
                actions={
                  <>
                    <RotateServiceKey id={service.id} name={service.name} />
                    <DeleteService id={service.id} name={service.name} />
                  </>
                }
              >
                <div className="flex flex-col gap-4">
                  <p className="font-mono break-all text-muted-foreground select-all">
                    {serviceLine(`${service.prefix}…`, service.slug)}
                  </p>
                  {!service.open && (
                    <>
                      <ul className="flex flex-col">
                        {service.grants.map((grant) => (
                          <li
                            key={grant.userId}
                            className="flex min-h-14 items-center gap-4 border-b border-border"
                          >
                            <span className="flex-1">{grant.name}</span>
                            <RevokeGrant
                              id={service.id}
                              userId={grant.userId}
                              name={grant.name}
                            />
                          </li>
                        ))}
                      </ul>
                      <GrantMember
                        id={service.id}
                        members={members.filter(
                          (member) =>
                            !service.grants.some(
                              (grant) => grant.userId === member.id
                            )
                        )}
                      />
                    </>
                  )}
                </div>
              </ExpandRow>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
