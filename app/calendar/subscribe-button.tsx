"use client"

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Subscribes a calendar app to a member's feed: webcal:// opens the app's
// own subscribe sheet (Apple Calendar, Outlook); Google Calendar on the web
// takes the copied link instead.
export function SubscribeButton({ url }: { url: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("已複製訂閱連結")
    } catch {
      toast.error("複製失敗")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        訂閱
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={<a href={url.replace(/^https?:\/\//, "webcal://")} />}
        >
          用行事曆 app 開啟
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copy}>複製連結</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
