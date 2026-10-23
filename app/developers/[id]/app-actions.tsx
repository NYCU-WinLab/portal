"use client"

import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { report } from "@/lib/report"

import { requestScopes, rotateSecret, setEnabled, updateApp } from "../actions"
import { AppFormFields, readDraft, type AppDraft } from "../app-form-fields"
import { SecretDialog } from "../secret-dialog"

export function AppActions({
  app,
  confidential,
  enabled,
  mine,
  admin,
  canRequest,
}: {
  app: AppDraft & { id: string }
  confidential: boolean
  enabled: boolean
  mine: boolean
  admin: boolean
  canRequest: boolean
}) {
  const [secret, setSecret] = React.useState<string | null>(null)
  const [wantName, setWantName] = React.useState(false)
  const [wantGroups, setWantGroups] = React.useState(false)

  return (
    <div className="flex flex-wrap gap-2">
      <FormDialog
        trigger={<Button variant="outline">修改</Button>}
        title="修改應用程式"
        size="wide"
        submitLabel="儲存"
        onSubmit={(data) =>
          report(updateApp({ id: app.id, ...readDraft(data) }), "已儲存")
        }
      >
        <AppFormFields app={app} />
      </FormDialog>
      {mine && canRequest && (
        <FormDialog
          trigger={<Button variant="outline">申請權限</Button>}
          title="申請姓名或群組權限"
          submitLabel="送出"
          onSubmit={(data) =>
            report(
              requestScopes({
                app_id: app.id,
                scopes: [
                  ...(wantName ? ["name"] : []),
                  ...(wantGroups ? ["groups"] : []),
                ],
                purpose: String(data.get("purpose") ?? ""),
              }),
              "已送出，等全站管理員審核"
            )
          }
        >
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="want-name">姓名</Label>
            <Switch
              id="want-name"
              checked={wantName}
              onCheckedChange={setWantName}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="want-groups">實驗室群組</Label>
            <Switch
              id="want-groups"
              checked={wantGroups}
              onCheckedChange={setWantGroups}
            />
          </div>
          <FormField label="用途（至少 10 字）" required>
            <Textarea name="purpose" rows={3} minLength={10} maxLength={2000} />
          </FormField>
        </FormDialog>
      )}
      {confidential && (
        <ConfirmDialog
          trigger={<Button variant="outline">換 secret</Button>}
          title="換 secret 會讓所有人的授權失效"
          confirmLabel="換 secret"
          onConfirm={async () => {
            const { result, error } = await rotateSecret(app.id)
            if (error) {
              toast.error(error)
              throw new Error(error)
            }
            setSecret(result!.secret)
          }}
        />
      )}
      {enabled ? (
        <ConfirmDialog
          trigger={<Button variant="outline">停用</Button>}
          title={`停用「${app.name}」？所有授權會失效${admin ? "" : "，只有全站管理員能再啟用"}`}
          confirmLabel="停用"
          onConfirm={() => report(setEnabled(app.id, false), "已停用")}
        />
      ) : (
        admin && (
          <Button
            variant="outline"
            onClick={() =>
              report(setEnabled(app.id, true), "已啟用").catch(() => {})
            }
          >
            啟用
          </Button>
        )
      )}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  )
}
