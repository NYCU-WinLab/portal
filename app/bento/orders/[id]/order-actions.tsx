"use client"

import { useRouter } from "next/navigation"
import { XIcon } from "lucide-react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { PROFESSOR_ID } from "@/lib/bento"
import { report } from "@/lib/report"

import {
  closeOrder,
  copyOrder,
  deleteOrder,
  removeLine,
  reopenOrder,
} from "../../actions"

// 偷學: order exactly what someone else ordered, replacing your own lines.
// Copying from 曾建超老師 asks a different question first.
export function CopyButton({
  orderId,
  from,
  replacing,
}: {
  orderId: string
  from: { userId: string; name: string }
  /** How many lines of the member's own it would replace. */
  replacing: number
}) {
  const professor = from.userId === PROFESSOR_ID
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">偷學</Button>}
      title={
        professor
          ? "你不想畢業了嗎？"
          : replacing > 0
            ? `照 ${from.name} 的點，取代你點的 ${replacing} 份？`
            : `照 ${from.name} 的點？`
      }
      confirmLabel={professor ? "我不怕" : "偷學"}
      variant={professor || replacing > 0 ? "destructive" : "default"}
      onConfirm={() =>
        report(copyOrder(orderId, from.userId), `已偷學 ${from.name}`)
      }
    />
  )
}

export function RemoveLineButton({
  lineId,
  name,
}: {
  lineId: string
  name: string
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label={`刪除 ${name}`}>
          <XIcon />
        </Button>
      }
      title={`刪除 ${name}？`}
      confirmLabel="刪除"
      onConfirm={() => report(removeLine(lineId), "已刪除")}
    />
  )
}

export function OrderAdmin({
  orderId,
  status,
}: {
  orderId: string
  status: string
}) {
  const router = useRouter()
  return (
    <>
      {status === "open" ? (
        <ConfirmDialog
          trigger={<Button variant="outline">關單</Button>}
          title="關單？之後不能再點或刪"
          confirmLabel="關單"
          variant="default"
          onConfirm={() => report(closeOrder(orderId), "已關單")}
        />
      ) : (
        <ConfirmDialog
          trigger={<Button variant="outline">重開</Button>}
          title="重開這張訂單？"
          confirmLabel="重開"
          variant="default"
          onConfirm={() => report(reopenOrder(orderId), "已重開")}
        />
      )}
      <ConfirmDialog
        trigger={<Button variant="destructive">刪除</Button>}
        title="刪除這張訂單和所有人點的餐？"
        confirmLabel="刪除"
        onConfirm={async () => {
          await report(deleteOrder(orderId), "已刪除")
          router.push("/bento")
        }}
      />
    </>
  )
}
