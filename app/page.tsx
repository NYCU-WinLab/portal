import Link from "next/link"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { getNextMeeting } from "@/lib/actions/meetings"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { givenName } from "@/lib/names"

import { NextMeeting } from "./meetings/next-meeting"

export const dynamic = "force-dynamic"

// Apps as they move over from portal.winlab.tw.
const apps = [
  { label: "Meetings", href: "/meetings" },
  { label: "Leave", href: "/leave" },
  { label: "Bento", href: "/bento" },
  { label: "Profile", href: "/profile" },
  { label: "Admins", href: "/admins" },
]

export default async function Home() {
  const actor = await requireActor("/")
  const [member, { meeting }] = await Promise.all([
    runAction(whoami, actor, {}),
    runAction(getNextMeeting, actor, {}),
  ])

  return (
    <PortalShell>
      <div className="flex flex-col gap-12">
        <PageHeader title={`Hi, ${givenName(member.name)}`} />
        <NextMeeting meeting={meeting} />
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
