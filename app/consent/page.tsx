import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { getConsentRequest } from "@/lib/auth/consent"
import { requireActor } from "@/lib/auth/session"

import { ConsentActions } from "./consent-actions"

export const dynamic = "force-dynamic"

export default async function Consent({ searchParams }: PageProps<"/consent">) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat()) if (item) params.append(key, item)
  }
  const query = params.toString()
  await requireActor(`/consent?${query}`)
  const request = await getConsentRequest(query)

  if (!request) {
    return (
      <PortalShell layout="spotlight">
        <StatusPage
          title="這個授權連結已經失效"
          description="回到要連線的程式重新連線一次。"
        />
      </PortalShell>
    )
  }

  return (
    <PortalShell layout="spotlight">
      <StatusPage
        title={`允許 ${request.name} 使用 WinLab Portal？`}
        description="它會以你的身分操作，網頁上你能做的事它都能做，包括你的管理權限。"
        action={<ConsentActions />}
      />
    </PortalShell>
  )
}
