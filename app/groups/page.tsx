import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { errorMessage, runAction } from "@/lib/actions/define"
import { listMailGroups, listMyMailGroups } from "@/lib/actions/groups"
import { requireActor } from "@/lib/auth/session"

import { groupsPage } from "./nav"

export const dynamic = "force-dynamic"

const failed = (error: unknown) => ({
  status: "failed" as const,
  detail: errorMessage(error),
})

// The lists the member receives mail from, then the ones they manage.
export default async function GroupsPage() {
  const actor = await requireActor("/groups")
  const [mine, managed] = await Promise.all([
    runAction(listMyMailGroups, actor, {}).catch(failed),
    runAction(listMailGroups, actor, {}).catch(failed),
  ])

  return (
    <PortalShell page={groupsPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="群組信" />
        {mine.status === "unconfigured" ? (
          <p className="text-muted-foreground">Google 群組整合尚未設定</p>
        ) : (
          <section className="flex flex-col gap-2">
            <SectionHeader
              title={
                mine.status === "ok" ? `${mine.address} 在的群組` : "你在的群組"
              }
            />
            {mine.status === "failed" ? (
              <p className="text-destructive">{mine.detail}</p>
            ) : mine.data.length === 0 ? (
              <EmptyState noun="你在的群組" />
            ) : (
              <ul className="flex stagger-rise flex-col">
                {mine.data.map((group) => (
                  <li
                    key={group.email}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{group.name}</span>
                      {group.via && (
                        <span className="truncate text-muted-foreground">
                          經由 {group.via}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {group.email}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {managed.status === "failed" ? (
          <p className="text-destructive">{managed.detail}</p>
        ) : (
          managed.status === "ok" &&
          managed.data.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionHeader title="你管理的群組" />
              <ul className="flex stagger-rise flex-col">
                {managed.data.map((group) => (
                  <li key={group.id} className="border-b border-border">
                    <Link
                      prefetch
                      href={`/groups/${group.id}`}
                      className="flex min-h-14 items-center gap-4 py-2 transition-colors duration-state hover:text-muted-foreground"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {group.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {group.email}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}
      </div>
    </PortalShell>
  )
}
