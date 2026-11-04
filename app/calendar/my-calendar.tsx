"use client"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"

import { setVisibilityAction, unlinkAction } from "./actions"

export function MyCalendar({
  link,
}: {
  link: {
    googleEmail: string
    visibility: "private" | "public"
    syncError: string | null
  } | null
}) {
  if (!link)
    return (
      <a
        href="/api/calendar/google/connect"
        className={buttonVariants({ className: "self-start" })}
      >
        連結 Google 行事曆
      </a>
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-14 items-center gap-4 border-b border-border py-2">
        <span className="shrink-0 text-muted-foreground">Google</span>
        <span className="min-w-0 flex-1 truncate">{link.googleEmail}</span>
        <ConfirmDialog
          trigger={<Button variant="outline">取消連結</Button>}
          title="取消連結 Google 行事曆？"
          confirmLabel="取消連結"
          variant="destructive"
          onConfirm={() => report(unlinkAction(), "已取消連結")}
        />
      </div>
      <label className="flex min-h-14 items-center gap-4 border-b border-border py-2">
        <span className="min-w-0 flex-1 font-medium">公開標題與地點</span>
        <Switch
          checked={link.visibility === "public"}
          aria-label="公開標題與地點"
          onCheckedChange={(checked) =>
            report(
              setVisibilityAction(checked ? "public" : "private"),
              checked ? "已公開標題與地點" : "只顯示忙碌"
            ).catch(() => {})
          }
        />
      </label>
      {link.syncError && (
        <p className="text-destructive">
          {link.syncError}
          {"，"}
          <a href="/api/calendar/google/connect" className="underline">
            重新連結
          </a>
        </p>
      )}
    </div>
  )
}
