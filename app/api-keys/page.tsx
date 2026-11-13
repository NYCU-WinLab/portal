import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { ExpandRow } from "@/components/expand-row"
import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listApiKeys } from "@/lib/actions/api-keys"
import { listServiceKeys } from "@/lib/actions/service-keys"
import { isAdmin } from "@/lib/actions/authz"
import { actionGroups } from "@/lib/actions/registry"
import { runAction } from "@/lib/actions/define"
import { apiApps, type ApiApp, curlLine, listLine } from "@/lib/api-apps"
import { requireActor } from "@/lib/auth/session"

import type { AppActions } from "./app-picker"
import { CreateKey, RevokeKey } from "./key-forms"
import { CreateServiceKey, RevokeServiceKey } from "./service-key-forms"
import { apiKeysPage } from "./nav"

export const dynamic = "force-dynamic"

const day = (date: Date | null) =>
  date
    ? date.toLocaleDateString("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      })
    : "還沒用過"

type ServiceKey = Awaited<
  ReturnType<typeof listServiceKeys.run>
>["keys"][number]

function ServiceKeyList({ keys }: { keys: ServiceKey[] }) {
  if (keys.length === 0) return <EmptyState noun="服務金鑰" />
  return (
    <ul className="flex stagger-rise flex-col">
      {keys.map((key) => (
        <li
          key={key.id}
          className="flex min-h-14 items-center gap-4 border-b border-border py-3"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{key.service}</span>
            <span className="text-muted-foreground">{appNames(key.apps)}</span>
            <span className="truncate text-muted-foreground">
              {[
                `${key.prefix}…`,
                key.createdBy && `${key.createdBy} 建立 ${day(key.createdAt)}`,
                key.lastUsedAt
                  ? `上次 ${day(key.lastUsedAt)}`
                  : day(key.lastUsedAt),
              ]
                .filter(Boolean)
                .join("，")}
            </span>
          </span>
          <RevokeServiceKey id={key.id} service={key.service} />
        </li>
      ))}
    </ul>
  )
}

type Key = Awaited<ReturnType<typeof listApiKeys.run>>["keys"][number]

// What each app reaches, listed in the key forms so a member asks only for
// the apps they need.
const appActions: AppActions = Object.fromEntries(
  actionGroups.flatMap(({ app, actions }) =>
    app
      ? [
          [
            app,
            // An action off MCP is off API keys too (lib/api-key-http.ts).
            actions
              .filter((action) => !action.mcpExcludedBecause)
              .map((action) => ({
                name: action.name,
                title: action.title,
                kind: action.kind,
                admin: !!action.admin,
              })),
          ],
        ]
      : []
  )
)

const appNames = (apps: string[]) =>
  apps.map((app) => apiApps[app as ApiApp] ?? app).join("、")

function KeyList({ keys, owner }: { keys: Key[]; owner: boolean }) {
  if (keys.length === 0) return <EmptyState noun="金鑰" />
  return (
    <ul className="flex stagger-rise flex-col">
      {keys.map((key) => (
        <li
          key={key.id}
          className="flex min-h-14 items-center gap-4 border-b border-border py-3"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{key.name}</span>
            <span className="text-muted-foreground">{appNames(key.apps)}</span>
            <span className="truncate text-muted-foreground">
              {[
                owner && key.owner,
                `${key.prefix}…`,
                `建立 ${day(key.createdAt)}`,
                key.lastUsedAt
                  ? `上次 ${day(key.lastUsedAt)}`
                  : day(key.lastUsedAt),
              ]
                .filter(Boolean)
                .join("，")}
            </span>
          </span>
          <RevokeKey id={key.id} name={key.name} />
        </li>
      ))}
    </ul>
  )
}

export default async function ApiKeysPage() {
  const actor = await requireActor("/api-keys")
  const portalAdmin = await isAdmin(actor, "portal")
  const admin = portalAdmin || (await isAdmin(actor, "door"))
  const [{ keys: mine }, everyone, services] = await Promise.all([
    runAction(listApiKeys, actor, {}),
    admin ? runAction(listApiKeys, actor, { all: true }) : null,
    portalAdmin ? runAction(listServiceKeys, actor, {}) : null,
  ])

  return (
    <PortalShell page={apiKeysPage}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="API 金鑰"
          actions={<CreateKey actions={appActions} />}
        />
        <Focus>
          <FocusLabel>我的金鑰</FocusLabel>
          <FocusTitle>
            <FocusHighlight>{mine.length}</FocusHighlight> 把
          </FocusTitle>
        </Focus>
        <ul className="flex flex-col">
          <ExpandRow summary="用法">
            <div className="flex flex-col gap-2">
              <p className="font-mono break-all text-muted-foreground select-all">
                {curlLine("wak_…", "now_playing")}
              </p>
              <p className="font-mono break-all text-muted-foreground select-all">
                {listLine("wak_…")}
              </p>
            </div>
          </ExpandRow>
        </ul>
        <section className="flex flex-col gap-2">
          <SectionHeader title="我的金鑰" />
          <KeyList keys={mine} owner={false} />
        </section>
        {services && (
          <section className="flex flex-col gap-2">
            <SectionHeader
              title="服務金鑰"
              actions={<CreateServiceKey actions={appActions} />}
            />
            <ServiceKeyList keys={services.keys} />
          </section>
        )}
        {everyone && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="所有人" />
            <KeyList keys={everyone.keys} owner />
          </section>
        )}
      </div>
    </PortalShell>
  )
}
