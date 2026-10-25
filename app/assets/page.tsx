import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listAssets } from "@/lib/actions/assets"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { AssetList } from "./asset-list"
import { assetsPage } from "./nav"

export const dynamic = "force-dynamic"

export default async function AssetsPage() {
  const actor = await requireActor("/assets")
  await requireAdminPage(actor, "assets")
  // The property system is NYCU's, not ours: when it is down, say so on
  // the page instead of failing it.
  const result = await runAction(listAssets, actor, {}).catch(
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  )

  return (
    <PortalShell page={assetsPage}>
      <div className="flex flex-col gap-8">
        <PageHeader title="財產" />
        {typeof result === "string" ? (
          <p className="py-12 text-center text-muted-foreground">{result}</p>
        ) : !result.configured ? (
          <p className="py-12 text-center text-muted-foreground">
            財產系統帳號沒有設定
          </p>
        ) : (
          <AssetList assets={result.assets} />
        )}
      </div>
    </PortalShell>
  )
}
