import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { Button } from "@/components/ui/button"
import { authorizationDetails } from "@/lib/actions/developers"
import { requireActor } from "@/lib/auth/session"
import { SCOPES } from "@/lib/developers/policy"

import { decide } from "../actions"

export const dynamic = "force-dynamic"

// The consent page an application sends a member to. It never redirects to
// an address it has not verified.
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  await requireActor(
    `/developers/authorize?${new URLSearchParams(
      Object.entries(query).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v]] : []
      )
    )}`
  )
  const details = await authorizationDetails(query).catch(() => null)
  if (!details)
    return (
      <PortalShell layout="spotlight">
        <StatusPage title="無法授權這個應用程式" />
      </PortalShell>
    )
  const { app, input, scopes } = details
  return (
    <PortalShell layout="spotlight">
      <div className="flex w-full max-w-md flex-col gap-8">
        <h1 className="text-title font-medium">授權 {app.name}</h1>
        <p className="text-muted-foreground">{app.description}</p>
        <ul className="flex flex-col">
          {scopes.map((s) => (
            <li key={s} className="flex flex-col border-b border-border py-3">
              <span>{SCOPES[s].label}</span>
              <span className="text-muted-foreground">
                {SCOPES[s].description}
              </span>
            </li>
          ))}
        </ul>
        <p className="break-all text-muted-foreground">
          維護者 {app.contact_email}，授權後回到{" "}
          {new URL(input.redirect_uri).origin}，最長 30 天，可在 Developers
          頁撤銷。{" "}
          <a
            href={app.privacy_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            隱私政策
          </a>
        </p>
        <form action={decide.bind(null, input)} className="flex gap-2">
          <Button type="submit" name="decision" value="deny" variant="outline">
            拒絕
          </Button>
          <Button type="submit" name="decision" value="approve">
            同意並繼續
          </Button>
        </form>
      </div>
    </PortalShell>
  )
}
