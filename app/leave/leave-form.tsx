"use client"

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

import { createLeaveAction } from "./actions"

export function LeaveForm({
  mondays,
}: {
  mondays: { value: string; label: string }[]
}) {
  async function submit(data: FormData) {
    const { error } = await createLeaveAction({
      date: String(data.get("date") ?? ""),
      reason: String(data.get("reason") ?? ""),
    })
    if (error) {
      toast.error(error)
      throw new Error(error)
    }
    toast.success("已請假")
  }

  return (
    <FormDialog
      trigger={<Button>請假</Button>}
      title="請假"
      submitLabel="請假"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="leave-date">日期</Label>
        <Select name="date" required items={mondays}>
          <SelectTrigger id="leave-date" className="w-full">
            <SelectValue placeholder="選擇週一" />
          </SelectTrigger>
          <SelectContent>
            {mondays.map((monday) => (
              <SelectItem key={monday.value} value={monday.value}>
                {monday.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <FormField label="原因" required>
        <Input name="reason" maxLength={200} />
      </FormField>
    </FormDialog>
  )
}
