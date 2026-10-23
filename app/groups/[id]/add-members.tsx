"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import { addMembers, loadCohorts } from "../actions"

type Cohort = { name: string; members: { email: string | null }[] }

// Addresses one per line (or comma separated), outside ones too; a cohort
// button drops its members' addresses in.
export function AddMembers({ groupId }: { groupId: string }) {
  const router = useRouter()
  const [text, setText] = React.useState("")
  const [cohorts, setCohorts] = React.useState<Cohort[] | null>(null)

  async function open(next: boolean) {
    if (!next || cohorts) return
    const { result } = await loadCohorts()
    setCohorts(result?.cohorts ?? [])
  }

  async function submit() {
    const emails = [
      ...new Set(
        text
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      ),
    ]
    if (!emails.length) {
      toast.error("請填信箱")
      throw new Error("empty")
    }
    const { result, error } = await addMembers(groupId, emails)
    if (error || !result || result.status !== "ok") {
      const detail =
        error ?? (result && "detail" in result ? result.detail : "加入失敗")
      toast.error(detail)
      throw new Error(detail)
    }
    const failed = result.data.filter(
      (r) => r.outcome !== "ok" && r.outcome !== "already"
    )
    if (failed.length)
      toast.warning(
        `${failed.length} 個沒加成：${failed.map((r) => r.email).join("、")}`
      )
    else toast.success(`已加入 ${result.data.length} 個，Google 名單幾秒後更新`)
    setText("")
    setTimeout(() => router.refresh(), 4000)
  }

  return (
    <FormDialog
      trigger={<Button>加入成員</Button>}
      onOpenChange={(next) => void open(next)}
      title="加入成員"
      submitLabel="加入"
      onSubmit={submit}
    >
      {cohorts && cohorts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {cohorts.map((cohort) => (
            <Button
              key={cohort.name}
              type="button"
              variant="outline"
              onClick={() =>
                setText((current) =>
                  [
                    current.trim(),
                    ...cohort.members.flatMap((m) =>
                      m.email ? [m.email] : []
                    ),
                  ]
                    .filter(Boolean)
                    .join("\n")
                )
              }
            >
              {cohort.name} 級
            </Button>
          ))}
        </div>
      )}
      <FormField label="信箱，一行一個">
        <Textarea
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </FormField>
    </FormDialog>
  )
}
