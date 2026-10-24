import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listApiKeys } from "@/lib/actions/api-keys"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { apiApps, type ApiApp, curlLine, listLine } from "@/lib/api-apps"
import { requireActor } from "@/lib/auth/session"

import { CreateKey, RevokeKey } from "./key-forms"
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

type Key = Awaited<ReturnType<typeof listApiKeys.run>>["keys"][number]

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
  const admin =
    (await isAdmin(actor, "portal")) || (await isAdmin(actor, "door"))
  const [{ keys: mine }, everyone] = await Promise.all([
    runAction(listApiKeys, actor, {}),
    admin ? runAction(listApiKeys, actor, { all: true }) : null,
  ])

  return (
    <PortalShell page={apiKeysPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="API 金鑰" actions={<CreateKey />} />
        <section className="flex flex-col gap-2">
          <SectionHeader title="用法" />
          <p className="font-mono break-all text-muted-foreground select-all">
            {curlLine("wak_…", "now_playing")}
          </p>
          <p className="font-mono break-all text-muted-foreground select-all">
            {listLine("wak_…")}
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <SectionHeader title="我的金鑰" />
          <KeyList keys={mine} owner={false} />
        </section>
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
