import { FormField } from "@/components/form-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export type AppDraft = {
  name: string
  description: string
  contact_email: string
  privacy_url: string
  redirect_uris: string[]
}

/** The fields an application is described by, for register and edit. */
export function AppFormFields({ app }: { app?: AppDraft }) {
  return (
    <>
      <FormField label="名稱" required>
        <Input name="name" maxLength={100} defaultValue={app?.name} />
      </FormField>
      <FormField label="用途說明（授權頁會顯示）" required>
        <Textarea
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={app?.description}
        />
      </FormField>
      <FormField label="聯絡信箱" required>
        <Input
          name="contact_email"
          type="email"
          defaultValue={app?.contact_email}
        />
      </FormField>
      <FormField label="隱私政策網址（https）" required>
        <Input name="privacy_url" type="url" defaultValue={app?.privacy_url} />
      </FormField>
      <FormField label="回呼網址，一行一個" required>
        <Textarea
          name="redirect_uris"
          rows={3}
          defaultValue={app?.redirect_uris.join("\n")}
        />
      </FormField>
    </>
  )
}

export const readDraft = (data: FormData): AppDraft => ({
  name: String(data.get("name") ?? ""),
  description: String(data.get("description") ?? ""),
  contact_email: String(data.get("contact_email") ?? ""),
  privacy_url: String(data.get("privacy_url") ?? ""),
  redirect_uris: String(data.get("redirect_uris") ?? "")
    .split(/\r?\n/)
    .map((uri) => uri.trim())
    .filter(Boolean),
})
