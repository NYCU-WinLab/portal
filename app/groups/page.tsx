import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { errorMessage, runAction } from "@/lib/actions/define"
import { listMailGroups } from "@/lib/actions/groups"
import { requireActor } from "@/lib/auth/session"

import { groupsPage } from "./nav"

export const dynamic = "force-dynamic"

export default async function GroupsPage() {
  const actor = await requireActor("/groups")
  const result = await runAction(listMailGroups, actor, {}).catch(
    (error: unknown) => ({
      status: "failed" as const,
      detail: errorMessage(error),
    })
  )

  return (
    <PortalShell page={groupsPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="群組信" />
        {result.status === "unconfigured" ? (
          <p className="text-muted-foreground">Google 群組整合尚未設定</p>
        ) : result.status === "failed" ? (
          <p className="text-destructive">{result.detail}</p>
        ) : result.data.length === 0 ? (
          <EmptyState noun="你管理的群組" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {result.data.map((group) => (
              <li key={group.id} className="border-b border-border">
                <Link
                  prefetch
                  href={`/groups/${group.id}`}
                  className="flex min-h-14 items-center gap-4 py-2 transition-colors duration-state hover:text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {group.email}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
