import { EmptyState } from "@/components/empty-state"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listDoorTokens } from "@/lib/actions/door-tokens"
import { requireActor } from "@/lib/auth/session"
import { curlLine } from "@/lib/door-token"

import { doorNav, doorPage } from "../nav"
import { CreateToken, RevokeToken } from "./token-forms"

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

type Token = Awaited<ReturnType<typeof listDoorTokens.run>>["tokens"][number]

function TokenList({ tokens, owner }: { tokens: Token[]; owner: boolean }) {
  if (tokens.length === 0) return <EmptyState noun="金鑰" />
  return (
    <ul className="flex stagger-rise flex-col">
      {tokens.map((token) => (
        <li
          key={token.id}
          className="flex min-h-14 items-center gap-4 border-b border-border py-3"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{token.name}</span>
            <span className="truncate text-muted-foreground">
              {[
                owner && token.owner,
                `${token.prefix}…`,
                `建立 ${day(token.createdAt)}`,
                token.lastUsedAt
                  ? `上次 ${day(token.lastUsedAt)}`
                  : day(token.lastUsedAt),
              ]
                .filter(Boolean)
                .join("，")}
            </span>
          </span>
          <RevokeToken id={token.id} name={token.name} />
        </li>
      ))}
    </ul>
  )
}

export default async function DoorTokensPage() {
  const actor = await requireActor("/door/tokens")
  const admin = await isAdmin(actor, "door")
  const [{ tokens: mine }, everyone] = await Promise.all([
    runAction(listDoorTokens, actor, {}),
    admin ? runAction(listDoorTokens, actor, { all: true }) : null,
  ])

  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="開門金鑰" actions={<CreateToken />} />
        <section className="flex flex-col gap-2">
          <SectionHeader title="用法" />
          <p className="font-mono break-all text-muted-foreground select-all">
            {curlLine("wdt_…")}
          </p>
        </section>
        <section className="flex flex-col gap-2">
          <SectionHeader title="我的金鑰" />
          <TokenList tokens={mine} owner={false} />
        </section>
        {everyone && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="所有人" />
            <TokenList tokens={everyone.tokens} owner />
          </section>
        )}
      </div>
    </PortalShell>
  )
}
