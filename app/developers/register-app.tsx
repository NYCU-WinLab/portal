"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { registerApp } from "./actions"
import { AppFormFields, readDraft } from "./app-form-fields"
import { SecretDialog } from "./secret-dialog"

const types = [
  { value: "confidential", label: "伺服器（confidential，有 secret）" },
  { value: "public", label: "瀏覽器或 App（public，只用 PKCE）" },
]

export function RegisterApp() {
  const router = useRouter()
  const [secret, setSecret] = React.useState<string | null>(null)
  const [created, setCreated] = React.useState<string | null>(null)

  async function submit(data: FormData) {
    const { result, error } = await registerApp({
      ...readDraft(data),
      client_type: String(data.get("client_type") ?? "confidential"),
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已註冊")
    setCreated(result!.id)
    if (result!.secret) setSecret(result!.secret)
    else router.push(`/developers/${result!.id}`)
  }

  return (
    <>
      <FormDialog
        trigger={<Button>註冊應用程式</Button>}
        title="註冊應用程式"
        size="wide"
        submitLabel="註冊"
        onSubmit={submit}
      >
        <AppFormFields />
        <FormField label="類型" required>
          <Select name="client_type" defaultValue="confidential" items={types}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </FormDialog>
      <SecretDialog
        secret={secret}
        onClose={() => {
          setSecret(null)
          if (created) router.push(`/developers/${created}`)
        }}
      />
    </>
  )
}
