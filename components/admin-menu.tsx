"use client"

import * as React from "react"
import { ShieldUserIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** Opens a FormDialog or ConfirmDialog from a menu item. */
type DialogControl = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AdminItem = {
  label: string
  destructive?: boolean
} & (
  { href: string } | { dialog: (control: DialogControl) => React.ReactElement }
)

// What only admins can do on a page, behind one shield button at the end of
// the page header: members see their own buttons, admins see the shield too.
// Each dialog remounts when it opens, so it starts from fresh input.
function AdminMenu({ items }: { items: (AdminItem | false | null)[] }) {
  const shown = items.filter((item): item is AdminItem => Boolean(item))
  const [opened, setOpened] = React.useState<{ index: number; key: number }>()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="icon" aria-label="管理" />}
        >
          <ShieldUserIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {shown.map((item, index) => (
            <DropdownMenuItem
              key={item.label}
              className={item.destructive ? "text-destructive" : undefined}
              {...("href" in item
                ? { render: <a href={item.href} /> }
                : {
                    onClick: () =>
                      setOpened((last) => ({
                        index,
                        key: (last?.key ?? 0) + 1,
                      })),
                  })}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {shown.map((item, index) =>
        "dialog" in item ? (
          <React.Fragment
            key={`${item.label}-${opened?.index === index ? opened.key : 0}`}
          >
            {item.dialog({
              open: opened?.index === index,
              onOpenChange: (open) => {
                if (!open) setOpened(undefined)
              },
            })}
          </React.Fragment>
        ) : null
      )}
    </>
  )
}

export { AdminMenu, type AdminItem, type DialogControl }
