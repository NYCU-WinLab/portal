"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { report } from "@/lib/report"

import { addTrip, editTrip, removeTrip } from "./actions"

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim()

type Trip = {
  id: string
  name: string
  description: string | null
  status: string
}

function TripFields({ trip }: { trip?: Trip }) {
  return (
    <>
      <FormField label="名稱" required>
        <Input
          name="name"
          maxLength={100}
          defaultValue={trip?.name}
          placeholder="2026 ICRA 橫濱"
        />
      </FormField>
      <FormField label="說明">
        <Input
          name="description"
          maxLength={500}
          defaultValue={trip?.description ?? ""}
          placeholder="日期、補助上限"
        />
      </FormField>
    </>
  )
}

export function CreateTrip() {
  const router = useRouter()
  return (
    <FormDialog
      trigger={<Button>新增出差</Button>}
      title="新增出差"
      submitLabel="新增"
      onSubmit={async (data) => {
        const { error, result } = await addTrip({
          name: text(data, "name"),
          description: text(data, "description"),
        })
        if (error || !result) {
          toast.error(error ?? "新增失敗")
          throw new Error(error)
        }
        toast.success("已新增")
        router.push(`/trip/${result.id}`)
      }}
    >
      <TripFields />
    </FormDialog>
  )
}

// What a trip admin can do to one trip, in its page header.
export function TripAdmin({ trip, files }: { trip: Trip; files: number }) {
  const router = useRouter()
  const open = trip.status === "open"
  return (
    <>
      {files > 0 && (
        <a
          href={`/trip/${trip.id}/download`}
          className={buttonVariants({ variant: "outline" })}
        >
          下載全部
        </a>
      )}
      <FormDialog
        trigger={<Button variant="outline">修改</Button>}
        title="修改出差"
        submitLabel="儲存"
        onSubmit={(data) =>
          report(
            editTrip({
              tripId: trip.id,
              name: text(data, "name"),
              description: text(data, "description"),
            }),
            "已儲存"
          )
        }
      >
        <TripFields trip={trip} />
      </FormDialog>
      <ConfirmDialog
        trigger={<Button variant="outline">{open ? "關閉" : "重開"}</Button>}
        title={
          open
            ? "關閉後成員不能再上傳、修改或刪除，要關閉嗎？"
            : "重開這趟出差？"
        }
        confirmLabel={open ? "關閉" : "重開"}
        variant="default"
        onConfirm={() =>
          report(
            editTrip({ tripId: trip.id, status: open ? "closed" : "open" }),
            open ? "已關閉" : "已重開"
          )
        }
      />
      <ConfirmDialog
        trigger={<Button variant="destructive">刪除</Button>}
        title={`刪除 ${trip.name} 和所有檔案？`}
        confirmLabel="刪除"
        onConfirm={async () => {
          await report(removeTrip(trip.id), "已刪除")
          router.push("/trip")
        }}
      />
    </>
  )
}
