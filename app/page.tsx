import Link from "next/link"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listAnnouncements } from "@/lib/actions/bulletin"
import { runAction } from "@/lib/actions/define"
import { getNextMeeting } from "@/lib/actions/meetings"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { givenName } from "@/lib/names"

import { NextMeeting } from "./meetings/next-meeting"

export const dynamic = "force-dynamic"

// Apps in alphabetical order.
const apps = [
  { label: "Admins", href: "/admins" },
  { label: "Approve", href: "/approve" },
  { label: "Bento", href: "/bento" },
  { label: "Bulletin", href: "/bulletin" },
  { label: "Carrel", href: "https://carrel.winlab.tw" },
  { label: "Developers", href: "/developers" },
  { label: "Door", href: "/door" },
  { label: "Gallery", href: "https://gallery.winlab.tw" },
  { label: "Games", href: "/games" },
  { label: "GitHub", href: "https://github.com/NYCU-WinLab" },
  { label: "GitLab", href: "https://gitlab.winlab.tw" },
  { label: "Groups", href: "/groups" },
  { label: "Leave", href: "/leave" },
  { label: "LLM", href: "https://llm.winlab.tw" },
  { label: "Meetings", href: "/meetings" },
  { label: "Nextcloud", href: "https://nextcloud.winlab.tw" },
  { label: "Profile", href: "/profile" },
  { label: "Receipts", href: "/receipts" },
  { label: "Reimburse", href: "/reimburse" },
  { label: "Rooms", href: "/rooms" },
  { label: "Transcribe", href: "https://transcribe.winlab.tw" },
  { label: "Trip", href: "/trip" },
  { label: "Video", href: "https://video.winlab.tw" },
  { label: "Wiki", href: "https://wiki.winlab.tw" },
]

// A post shows on the home page for a week, then lives on /bulletin.
const isFresh = (date: Date) =>
  Date.now() - date.getTime() < 7 * 24 * 3600 * 1000

export default async function Home() {
  const actor = await requireActor("/")
  const [member, { meeting }, { announcements }] = await Promise.all([
    runAction(whoami, actor, {}),
    runAction(getNextMeeting, actor, {}),
    runAction(listAnnouncements, actor, { limit: 1 }),
  ])
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
        <section className="flex flex-col gap-2">
          <SectionHeader title="服務" />
          <ul className="flex stagger-rise flex-col">
            {apps.map((app) => (
              <li key={app.href} className="border-b border-border">
                <Link
                  href={app.href}
                  className="flex min-h-14 items-center transition-colors duration-state hover:text-muted-foreground"
                >
                  {app.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PortalShell>
  )
}
