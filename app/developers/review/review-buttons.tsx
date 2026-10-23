"use client"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { report } from "@/lib/report"

import { review } from "../actions"

export function ReviewButtons({ id }: { id: string }) {
  const decide = (approve: boolean) => (data: FormData) =>
    report(
      review({ id, approve, note: String(data.get("note") ?? "") }),
      approve ? "已核准" : "已拒絕"
    )
  return (
    <div className="flex gap-2">
      {([true, false] as const).map((approve) => (
        <FormDialog
          key={String(approve)}
          trigger={
            <Button variant={approve ? "default" : "outline"}>
              {approve ? "核准" : "拒絕"}
            </Button>
          }
          title={approve ? "核准申請" : "拒絕申請"}
          submitLabel={approve ? "核准" : "拒絕"}
          onSubmit={decide(approve)}
        >
          <FormField label="說明（申請人看得到）" required>
            <Textarea name="note" rows={3} maxLength={2000} />
          </FormField>
        </FormDialog>
      ))}
    </div>
  )
}
