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
      toast.error(error.message ?? "登入沒有成功，請再試一次")
    }
  }

  return (
    <Button onClick={signIn} disabled={pending}>
      {pending ? "前往登入中…" : "以實驗室帳號登入"}
    </Button>
  )
}
