"use client"

import * as React from "react"

import { ExpandRow } from "@/components/expand-row"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { apiApps, type ApiApp } from "@/lib/api-apps"

/** What one action does, as the key form lists it under its app. */
export type AppAction = {
  name: string
  title: string
  kind: "query" | "mutation"
  admin: boolean
}

export type AppActions = Partial<Record<ApiApp, AppAction[]>>

// The apps a key may use, one row each: a switch to allow it, and the row
// opens to list the actions it reaches, so a member asks only for what
// they need. One button allows every app or none.
export function AppPicker<App extends ApiApp>({
  apps,
  actions,
  value,
  onChange,
}: {
  apps: readonly App[]
  actions: AppActions
  value: Set<App>
  onChange: (next: Set<App>) => void
}) {
  const all = apps.every((app) => value.has(app))

  function toggle(app: App, on: boolean) {
    const next = new Set(value)
    if (on) next.add(app)
    else next.delete(app)
    onChange(next)
  }

  return (
    <fieldset aria-label="可以用的 app" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span>可以用的 app</span>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange(new Set(all ? [] : apps))}
        >
          {all ? "取消全選" : "全選"}
        </Button>
      </div>
      <ul className="flex max-h-112 flex-col overflow-y-auto">
        {apps.map((app) => {
          const list = actions[app] ?? []
          return (
            <ExpandRow
              key={app}
              summary={
                <span className="flex items-baseline gap-2">
                  {apiApps[app]}
                  <span className="text-muted-foreground">
                    {list.length} 個
                  </span>
                </span>
              }
              actions={
                <Switch
                  aria-label={apiApps[app]}
                  checked={value.has(app)}
                  onCheckedChange={(on) => toggle(app, on)}
                />
              }
            >
              <ul className="flex flex-col gap-2">
                {list.map((action) => (
                  <li key={action.name} className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span>{action.title}</span>
                      <span className="truncate font-mono text-muted-foreground">
                        {action.name}
                      </span>
                    </span>
                    {action.admin && <Badge variant="warning">管理員</Badge>}
                    <Badge
                      variant={action.kind === "mutation" ? "default" : "muted"}
                    >
                      {action.kind === "mutation" ? "寫入" : "讀取"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </ExpandRow>
          )
        })}
      </ul>
    </fieldset>
  )
}
