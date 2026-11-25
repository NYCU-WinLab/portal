import { PencilIcon } from "lucide-react"
import Link from "next/link"

import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { buttonVariants } from "@/components/ui/button"
import { errorMessage, runAction } from "@/lib/actions/define"
import { listMailGroups, listMyMailGroups } from "@/lib/actions/groups"
import { requireActor } from "@/lib/auth/session"

import { groupsPage } from "./nav"

export const dynamic = "force-dynamic"

const failed = (error: unknown) => ({
  status: "failed" as const,
  detail: errorMessage(error),
})

// The lists the member receives mail from, in one list with the ones they
// manage: a managed list carries a pencil to its page, and one they manage
// but do not receive mail from follows the others. A managed list's name
// links there too.
export default async function GroupsPage() {
  const actor = await requireActor("/groups")
  const [mine, managed] = await Promise.all([
    runAction(listMyMailGroups, actor, {}).catch(failed),
    runAction(listMailGroups, actor, {}).catch(failed),
  ])

  const manageIds = new Map(
    managed.status === "ok"
      ? managed.data.map((group) => [group.email.toLowerCase(), group.id])
      : []
  )
  const memberOf = mine.status === "ok" ? mine.data : []
  const inMine = new Set(memberOf.map((group) => group.email.toLowerCase()))
  const rows = [
    ...memberOf.map((group) => ({
      email: group.email,
      name: group.name,
      note: group.via ? `經由 ${group.via}` : null,
      manageId: manageIds.get(group.email.toLowerCase()),
    })),
    ...(managed.status === "ok" ? managed.data : [])
      .filter((group) => !inMine.has(group.email.toLowerCase()))
      .map((group) => ({
        email: group.email,
        name: group.name,
        note: "你可管理",
        manageId: group.id,
      })),
  ]

  return (
    <PortalShell page={groupsPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="群組信" />
        {mine.status === "ok" && (
          <Focus>
            <FocusLabel>{mine.address}</FocusLabel>
            <FocusTitle>
              在 <FocusHighlight>{mine.data.length}</FocusHighlight> 個群組
            </FocusTitle>
          </Focus>
        )}
        {mine.status === "unconfigured" ? (
          <p className="text-muted-foreground">Google 群組整合尚未設定</p>
        ) : (
          <section className="flex flex-col gap-2">
            <SectionHeader
              title={
                rows.length > memberOf.length
                  ? "你在與可管理的群組"
                  : mine.status === "ok"
                    ? `${mine.address} 在的群組`
                    : "你在的群組"
              }
            />
            {mine.status === "failed" && (
              <p className="text-destructive">{mine.detail}</p>
            )}
            {managed.status === "failed" && (
              <p className="text-destructive">{managed.detail}</p>
            )}
            {rows.length === 0 ? (
              mine.status === "ok" &&
              managed.status !== "failed" && <EmptyState noun="你在的群組" />
            ) : (
              <ul className="flex stagger-rise flex-col">
                {rows.map((group) => (
                  <li
                    key={group.email}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      {group.manageId ? (
                        <Link
                          prefetch
                          href={`/groups/${group.manageId}`}
                          className="truncate transition-colors duration-state hover:text-muted-foreground"
                        >
                          {group.name}
                        </Link>
                      ) : (
                        <span className="truncate">{group.name}</span>
                      )}
                      {group.note && (
                        <span className="truncate text-muted-foreground">
                          {group.note}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {group.email}
                    </span>
                    {group.manageId && (
                      <Link
                        prefetch
                        href={`/groups/${group.manageId}`}
                        aria-label={`編輯 ${group.name} 的成員`}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon",
                        })}
                      >
                        <PencilIcon />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </PortalShell>
  )
}
