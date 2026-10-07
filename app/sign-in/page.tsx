import { redirect } from "next/navigation"

import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { getSession } from "@/lib/auth/session"
import { safeNext } from "@/lib/safe-next"

import { SignInButton } from "./sign-in-button"

export const dynamic = "force-dynamic"

export default async function SignIn({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams
  const next = safeNext(typeof params.next === "string" ? params.next : null)
  // An MCP authorization lands here with its signed query; a member who is
  // already signed in is sent on by the provider, not by this page.
  const authorizing = typeof params.client_id === "string"
  if (!authorizing && (await getSession())) redirect(next)

  return (
    <PortalShell layout="spotlight">
      <StatusPage title="登入" action={<SignInButton next={next} />} />
    </PortalShell>
  )
}
