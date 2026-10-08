import Link from "next/link"

import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

// Apps as they move over from portal.winlab.tw.
const apps = [
  { label: "請假", href: "/leave" },
  { label: "我的資料", href: "/profile" },
]

export default async function Home() {
  const actor = await requireActor("/")
  const member = await runAction(whoami, actor, {})

  return (
    <PortalShell>
      <div className="flex flex-col gap-12">
        <PageHeader title={member.name} />
        <section className="flex flex-col gap-2">
          <SectionHeader title="服務" />
          <ul className="flex flex-col">
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
