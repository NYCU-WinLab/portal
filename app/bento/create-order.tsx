"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { openOrder } from "./actions"

// 開單: one restaurant, one day (today unless changed). Goes to the new order.
export function CreateOrder({
  restaurants,
  today,
}: {
  restaurants: { value: string; label: string }[]
  today: string
}) {
  const router = useRouter()

  async function submit(data: FormData) {
    const { error, result } = await openOrder({
      restaurantId: String(data.get("restaurantId") ?? ""),
      date: String(data.get("date") ?? ""),
    })
    if (error || !result) {
      toast.error(error ?? "開單失敗")
      throw new Error(error)
    }
    toast.success("已開單")
    router.push(`/bento/orders/${result.id}`)
  }

  return (
    <FormDialog
      trigger={<Button>開單</Button>}
      title="開單"
      submitLabel="開單"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="bento-restaurant">餐廳</Label>
        <Select name="restaurantId" required items={restaurants}>
          <SelectTrigger id="bento-restaurant" className="w-full">
            <SelectValue placeholder="選擇餐廳" />
          </SelectTrigger>
          <SelectContent>
            {restaurants.map((restaurant) => (
              <SelectItem key={restaurant.value} value={restaurant.value}>
                {restaurant.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <FormField label="日期" required>
        <Input name="date" type="date" defaultValue={today} />
      </FormField>
    </FormDialog>
  )
}
