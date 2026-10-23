"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** A client secret, shown once. */
export function SecretDialog({
  secret,
  onClose,
}: {
  secret: string | null
  onClose: () => void
}) {
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Client secret 只顯示這一次</DialogTitle>
        </DialogHeader>
        <p className="font-mono break-all select-all">{secret}</p>
        <p className="text-muted-foreground">
          存到伺服器的密鑰管理，不要放進前端或 git。
        </p>
      </DialogContent>
    </Dialog>
  )
}
