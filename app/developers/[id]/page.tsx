import { notFound } from "next/navigation"

import { FieldList, FieldRow } from "@/components/field-list"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import {
  getDeveloperApp,
  getDeveloperIntegration,
} from "@/lib/actions/developers"
import { requireActor } from "@/lib/auth/session"
import { SCOPES, type Scope } from "@/lib/developers/policy"

import { developersNav, developersPage } from "../nav"
import { AppActions } from "./app-actions"

export const dynamic = "force-dynamic"

const status: Record<string, string> = {
  pending: "審核中",
  approved: "已核准",
  rejected: "已拒絕",
}

export default async function DeveloperAppPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor(`/developers/${id}`)
  const found = await runAction(getDeveloperApp, actor, { id }).catch(
    () => null
  )
  if (!found) notFound()
  const { app, requests, activeGrants } = found
  const [integration, admin] = await Promise.all([
    runAction(getDeveloperIntegration, actor, {}),
    isAdmin(actor, "portal"),
  ])
  const pending = requests.some((r) => r.status === "pending")

  return (
    <PortalShell page={developersPage} nav={developersNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={app.name}
          actions={
            <AppActions
              app={{
                id: app.id,
                name: app.name,
                description: app.description,
                contact_email: app.contactEmail,
                privacy_url: app.privacyUrl,
                redirect_uris: app.redirectUris,
              }}
              confidential={app.clientType === "confidential"}
              enabled={app.enabled}
              mine={app.ownerId === actor.userId}
              admin={admin}
              canRequest={
                !pending &&
                !["name", "groups"].every((s) => app.approvedScopes.includes(s))
              }
            />
          }
        />
        <FieldList>
          <FieldRow label="Client ID">
            <span className="font-mono break-all select-all">{app.id}</span>
          </FieldRow>
          <FieldRow label="類型">
            {app.clientType === "confidential" ? "confidential" : "public"}
          </FieldRow>
          <FieldRow label="狀態">{app.enabled ? "啟用" : "已停用"}</FieldRow>
          <FieldRow label="資料權限">
            {app.approvedScopes
              .map((s) => SCOPES[s as Scope]?.label ?? s)
              .join("、")}
          </FieldRow>
          <FieldRow label="目前授權">{activeGrants} 人</FieldRow>
          <FieldRow label="回呼網址">
            <span className="break-all">{app.redirectUris.join("、")}</span>
          </FieldRow>
        </FieldList>
        {requests.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="權限申請" />
            <ul className="flex flex-col">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                >
                  <span className="shrink-0">
                    {r.scopes
                      .map((s) => SCOPES[s as Scope]?.label ?? s)
                      .join("、")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {r.reviewNote ?? r.purpose}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {status[r.status] ?? r.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <SectionHeader title="串接方式" />
          <ul className="flex flex-col gap-2 font-mono break-all text-muted-foreground">
            <li>{integration.authorize}</li>
            <li>{integration.token}</li>
            <li>{integration.revoke}</li>
            {Object.values(integration.resources).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {integration.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>
      </div>
    </PortalShell>
  )
}
