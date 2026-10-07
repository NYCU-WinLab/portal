"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth/client"

export function SignInButton({ next }: { next: string }) {
  const [pending, setPending] = React.useState(false)

  async function signIn() {
    setPending(true)
    const { error } = await authClient.signIn.social({
      provider: "keycloak",
      callbackURL: next,
      errorCallbackURL: "/sign-in",
    })
    if (error) {
      setPending(false)
      toast.error(error.message ?? "登入失敗")
    }
  }

  return (
    <Button onClick={signIn} disabled={pending}>
      {pending ? "登入中…" : "登入"}
    </Button>
  )
}
