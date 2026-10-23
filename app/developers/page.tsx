import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import {
  listDeveloperApps,
  listMyAuthorizations,
} from "@/lib/actions/developers"
import { requireActor } from "@/lib/auth/session"
import { SCOPES, type Scope } from "@/lib/developers/policy"

import { developersNav, developersPage } from "./nav"
import { RegisterApp } from "./register-app"
import { RevokeGrant } from "./revoke-grant"

export const dynamic = "force-dynamic"

const scopeNames = (scopes: string[]) =>
  scopes.map((s) => SCOPES[s as Scope]?.label ?? s).join("、")

export default async function DevelopersPage() {
  const actor = await requireActor("/developers")
  const [{ apps }, { grants }] = await Promise.all([
    runAction(listDeveloperApps, actor, {}),
    runAction(listMyAuthorizations, actor, {}),
  ])

  return (
    <PortalShell page={developersPage} nav={developersNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="應用程式" actions={<RegisterApp />} />
        <section className="flex flex-col gap-2">
          <SectionHeader title="你註冊的" />
          {apps.length === 0 ? (
            <EmptyState noun="應用程式" />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {apps.map((app) => (
                <li key={app.id} className="border-b border-border">
                  <Link
                    prefetch
                    href={`/developers/${app.id}`}
                    className="flex min-h-14 items-center gap-4 py-2 transition-colors duration-state hover:text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate">{app.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {app.enabled ? scopeNames(app.approvedScopes) : "已停用"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <SectionHeader title="你授權的" />
          {grants.length === 0 ? (
            <EmptyState noun="授權" />
          ) : (
            <ul className="flex flex-col">
              {grants.map((grant) => (
                <li
                  key={grant.id}
                  className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                >
                  <span className="min-w-0 flex-1 truncate">{grant.app}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {scopeNames(grant.scopes)}，到{" "}
                    {grant.expiresAt.toLocaleDateString("zh-TW", {
                      timeZone: "Asia/Taipei",
                    })}
                  </span>
                  <RevokeGrant id={grant.id} app={grant.app} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PortalShell>
  )
}
