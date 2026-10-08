"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth/client"

// Ends the portal session and then Keycloak's, so the next visit asks for
// the lab account again instead of signing straight back in.
export function SignOutButton() {
  const [pending, setPending] = React.useState(false)
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        // Better Auth sends the browser on to Keycloak's logout, which comes
        // back to "/" (registered as a post-logout redirect for portal-dev).
        await authClient.signOut({ callbackURL: "/" })
      }}
    >
      {pending ? "登出中…" : "登出"}
    </Button>
  )
}
