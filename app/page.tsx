import Link from "next/link"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { adminAppsOf, visibleTo } from "@/lib/actions/authz"
import { listAnnouncements } from "@/lib/actions/bulletin"
import { runAction } from "@/lib/actions/define"
import { listHomePins } from "@/lib/actions/home"
import { getNextLabMeeting } from "@/lib/actions/meetings"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { givenName } from "@/lib/names"
import { serviceGroups, services } from "@/lib/services"

import { NextMeeting } from "./meetings/next-meeting"
import { PinButton } from "./pin-button"

export const dynamic = "force-dynamic"

// A post shows on the home page for a week, then lives on /bulletin.
const isFresh = (date: Date) =>
  Date.now() - date.getTime() < 7 * 24 * 3600 * 1000

export default async function Home() {
  const actor = await requireActor("/")
  const [member, { meeting }, { announcements }, pins, adminOf] =
    await Promise.all([
      runAction(whoami, actor, {}),
      runAction(getNextLabMeeting, actor, {}),
      runAction(listAnnouncements, actor, { limit: 1 }),
      runAction(listHomePins, actor, {}),
      adminAppsOf(actor),
    ])
  // Starred services move out of their group into 置頂 at the top.
  const pinned = new Set<string>(pins.services)
  const groups = [
    {
      title: "置頂",
      apps: visibleTo(adminOf, services).filter((app) => pinned.has(app.key)),
    },
    ...serviceGroups.map((group) => ({
      title: group.title,
      apps: visibleTo(adminOf, group.apps).filter(
        (app) => !pinned.has(app.key)
      ),
    })),
  ].filter((group) => group.apps.length > 0)
  const fresh = announcements.find((post) => isFresh(post.createdAt))

  return (
    <PortalShell>
      <div className="flex flex-col gap-12">
        <PageHeader title={`Hi, ${givenName(member.name)}`} />
        <NextMeeting meeting={meeting} />
        {fresh && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="公告" />
            <Link
              prefetch
              href="/bulletin"
              className="flex min-h-14 items-center border-b border-border transition-colors duration-state hover:text-muted-foreground"
            >
              {fresh.title}
            </Link>
          </section>
        )}
        {groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <SectionHeader title={group.title} />
            <ul className="flex stagger-rise flex-col">
              {group.apps.map((app) => (
                <li
                  key={app.key}
                  className="flex items-center gap-2 border-b border-border"
                >
                  <Link
                    href={app.href}
                    {...(app.href.startsWith("https") && {
                      target: "_blank",
                      rel: "noopener noreferrer",
                    })}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 transition-colors duration-state hover:text-muted-foreground"
                  >
                    <span aria-hidden className="w-6 text-center">
                      {app.emoji}
                    </span>
                    {app.label}
                    <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                      {app.name}
                      {app.href.startsWith("https") && (
                        <span aria-label="外部網站">↗</span>
                      )}
                    </span>
                  </Link>
                  <PinButton
                    service={app.key}
                    label={app.label}
                    pinned={pinned.has(app.key)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PortalShell>
  )
}
