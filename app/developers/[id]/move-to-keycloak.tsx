"use client"

import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"

import { moveToKeycloak } from "../actions"
import { SecretDialog } from "../secret-dialog"

/** For an application still on portal's own OAuth service. */
export function MoveToKeycloak({
  id,
  name,
  confidential,
}: {
  id: string
  name: string
  confidential: boolean
}) {
  const [secret, setSecret] = React.useState<string | null>(null)
  return (
    <section className="flex flex-col items-start gap-3">
      {confidential && (
        <p className="text-muted-foreground">
          改用後會拿到新的 secret，舊的 secret 在舊網址可用到停用日。
        </p>
      )}
      <ConfirmDialog
        trigger={<Button variant="outline">改用 Keycloak</Button>}
        title={`「${name}」改由 Keycloak 登入？`}
        confirmLabel="改用 Keycloak"
        onConfirm={async () => {
          const { result, error } = await moveToKeycloak(id)
          if (error) {
            toast.error(error)
            throw new Error(error)
          }
          if (result!.secret) setSecret(result!.secret)
          else toast.success("已改用 Keycloak")
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </section>
  )
}
