"use client"

import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"

import {
  addSourceAction,
  removeSourceAction,
  setSourceAction,
  unlinkAction,
} from "./actions"

type Google = {
  email: string
  canList: boolean
  syncError: string | null
} | null

type Source = {
  id: string
  kind: "google" | "ics" | "file"
  label: string
  primary: boolean
  busyOnly: boolean
  host: string | null
  enabled: boolean
  visibility: "private" | "public"
  syncError: string | null
}

const CONNECT = "/api/calendar/google/connect"
const KIND = { google: "Google", ics: "網址", file: "檔案" } as const

export function GoogleAccount({ google }: { google: Google }) {
  if (!google)
    return (
      <a href={CONNECT} className={buttonVariants({ className: "self-start" })}>
        連結 Google 行事曆
      </a>
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-14 items-center gap-4 border-b border-border py-2">
        <span className="shrink-0 text-muted-foreground">Google</span>
        <span className="min-w-0 flex-1 truncate">{google.email}</span>
        <ConfirmDialog
          trigger={<Button variant="outline">取消連結</Button>}
          title="取消連結 Google 行事曆？"
          confirmLabel="取消連結"
          variant="destructive"
          onConfirm={() => report(unlinkAction(), "已取消連結")}
        />
      </div>
      {google.syncError ? (
        <p className="text-destructive">
          {google.syncError}
          {"，"}
          <a href={CONNECT} className="underline">
            重新連結
          </a>
        </p>
      ) : (
        !google.canList && (
          <p className="text-muted-foreground">
            目前只讀主要日曆，
            <a href={CONNECT} className="underline">
              重新連結
            </a>
            後可以選其他日曆
          </p>
        )
      )}
    </div>
  )
}

function SourceRow({ source }: { source: Source }) {
  const set = (
    change: { enabled?: boolean; visibility?: "private" | "public" },
    done: string
  ) => report(setSourceAction(source.id, change), done).catch(() => {})
  const detail =
    source.kind === "ics" ? source.host : source.primary ? "主要日曆" : null
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3">
      <div className="flex min-h-10 flex-wrap items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:basis-full">
          <Badge>{KIND[source.kind]}</Badge>
          <span className="truncate font-medium">{source.label}</span>
          {detail && (
            <span className="truncate text-muted-foreground">{detail}</span>
          )}
          {source.busyOnly && <Badge>只看得到忙碌</Badge>}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">使用</span>
          <Switch
            checked={source.enabled}
            aria-label={`使用 ${source.label}`}
            onCheckedChange={(checked) =>
              set({ enabled: checked }, checked ? "已使用" : "已停用")
            }
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">公開標題</span>
          <Switch
            checked={source.visibility === "public"}
            disabled={source.busyOnly}
            aria-label={`公開 ${source.label} 的標題與地點`}
            onCheckedChange={(checked) =>
              set(
                { visibility: checked ? "public" : "private" },
                checked ? "已公開標題與地點" : "只顯示忙碌"
              )
            }
          />
        </label>
        {source.kind !== "google" && (
          <ConfirmDialog
            trigger={<Button variant="outline">移除</Button>}
            title={`移除「${source.label}」？`}
            confirmLabel="移除"
            variant="destructive"
            onConfirm={() => report(removeSourceAction(source.id), "已移除")}
          />
        )}
      </div>
      {source.enabled && source.syncError && (
        <p className="text-destructive">{source.syncError}</p>
      )}
    </div>
  )
}

export function CalendarSources({ sources }: { sources: Source[] }) {
  if (sources.length === 0)
    return <p className="text-muted-foreground">還沒有行事曆</p>
  return (
    <div className="flex flex-col">
      {sources.map((source) => (
        <SourceRow key={source.id} source={source} />
      ))}
    </div>
  )
}

const MAX_FILE = 2 * 1024 * 1024

export function AddSource() {
  const [label, setLabel] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const file = React.useRef<HTMLInputElement>(null)

  const add = async (
    input: { url?: string; content?: string },
    name: string
  ) => {
    setBusy(true)
    try {
      await report(addSourceAction({ label: name, ...input }), "已加入行事曆")
      setLabel("")
      setUrl("")
    } catch {
      // The toast says why.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-center gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void add({ url }, label.trim() || "行事曆")
        }}
      >
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="名稱"
          aria-label="名稱"
          maxLength={100}
          className="w-40"
        />
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https:// 或 webcal:// 的 ICS 網址"
          aria-label="ICS 網址"
          className="min-w-64 flex-1"
          required
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          加入
        </Button>
      </form>
      <div className="flex items-center gap-4">
        <input
          ref={file}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={async (event) => {
            const picked = event.target.files?.[0]
            event.target.value = ""
            if (!picked) return
            if (picked.size > MAX_FILE) {
              await report(
                Promise.resolve({ error: "檔案超過 2 MB" }),
                ""
              ).catch(() => {})
              return
            }
            await add(
              { content: await picked.text() },
              label.trim() || picked.name.replace(/\.ics$/i, "")
            )
          }}
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          匯入 .ics 檔
        </Button>
      </div>
    </div>
  )
}
