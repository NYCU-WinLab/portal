"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { LedgerEntry } from "@/lib/actions/reimburse"
import { report } from "@/lib/report"

import {
  addEgress,
  addIngress,
  deleteEgress,
  deleteIngress,
  updateEgress,
  updateIngress,
} from "./actions"

type Egress = Extract<LedgerEntry, { kind: "egress" }>
type Ingress = Extract<LedgerEntry, { kind: "ingress" }>

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim()
const whole = (data: FormData, key: string) => Number(text(data, key) || 0)

// 新增支出 / 修改支出: who was paid back, for what, and when the money went.
function EgressForm({
  entry,
  members,
  today,
  trigger,
}: {
  entry?: Egress
  members: Member[]
  today: string
  trigger: React.ReactElement
}) {
  const [applicant, setApplicant] = React.useState<string | null>(
    entry?.applicantId ?? null
  )
  async function submit(data: FormData) {
    // An old entry naming someone without an account keeps that name until
    // a member is picked.
    if (!applicant && !entry) {
      toast.error("請選申請人")
      throw new Error("no applicant")
    }
    const fields = {
      item: text(data, "item"),
      amount: whole(data, "amount"),
      invoiceDate: text(data, "invoiceDate"),
      transferDate: text(data, "transferDate") || null,
      transferFee: whole(data, "transferFee"),
      ...(applicant && applicant !== entry?.applicantId
        ? { applicantId: applicant }
        : {}),
    }
    await report(
      entry
        ? updateEgress({ entryId: entry.id, ...fields })
        : addEgress({ applicantId: applicant, ...fields }),
      entry ? "已儲存" : "已新增"
    )
  }

  return (
    <FormDialog
      trigger={trigger}
      onOpenChange={(open) => open && setApplicant(entry?.applicantId ?? null)}
      title={entry ? "修改支出" : "新增支出"}
      submitLabel={entry ? "儲存" : "新增"}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="egress-applicant" className="gap-1">
          申請人
          <span aria-hidden className="text-destructive">
            *
          </span>
        </Label>
        <MemberCombobox
          id="egress-applicant"
          className="w-full"
          members={members}
          value={applicant}
          onValueChange={setApplicant}
          placeholder={
            entry && !entry.applicantId ? entry.applicant : undefined
          }
        />
      </div>
      <FormField label="品項" required>
        <Input name="item" maxLength={200} defaultValue={entry?.item} />
      </FormField>
      <FormField label="金額" required>
        <Input name="amount" inputMode="numeric" defaultValue={entry?.amount} />
      </FormField>
      <FormField label="發票日期" required>
        <Input
          name="invoiceDate"
          type="date"
          defaultValue={entry?.invoiceDate ?? today}
        />
      </FormField>
      <FormField label="轉帳日期">
        <Input
          name="transferDate"
          type="date"
          defaultValue={entry?.transferDate ?? ""}
        />
      </FormField>
      <FormField label="手續費">
        <Input
          name="transferFee"
          inputMode="numeric"
          defaultValue={entry?.transferFee || ""}
        />
      </FormField>
    </FormDialog>
  )
}

function IngressForm({
  entry,
  today,
  trigger,
}: {
  entry?: Ingress
  today: string
  trigger: React.ReactElement
}) {
  async function submit(data: FormData) {
    const fields = {
      date: text(data, "date"),
      amount: whole(data, "amount"),
      note: text(data, "note"),
    }
    await report(
      entry
        ? updateIngress({ entryId: entry.id, ...fields })
        : addIngress(fields),
      entry ? "已儲存" : "已新增"
    )
  }

  return (
    <FormDialog
      trigger={trigger}
      title={entry ? "修改收入" : "新增收入"}
      submitLabel={entry ? "儲存" : "新增"}
      onSubmit={submit}
    >
      <FormField label="日期" required>
        <Input name="date" type="date" defaultValue={entry?.date ?? today} />
      </FormField>
      <FormField label="金額" required>
        <Input name="amount" inputMode="numeric" defaultValue={entry?.amount} />
      </FormField>
      <FormField label="備註">
        <Input name="note" maxLength={200} defaultValue={entry?.note ?? ""} />
      </FormField>
    </FormDialog>
  )
}

export function AddEntries({
  members,
  today,
}: {
  members: Member[]
  today: string
}) {
  return (
    <>
      <IngressForm
        today={today}
        trigger={<Button variant="outline">新增收入</Button>}
      />
      <EgressForm
        members={members}
        today={today}
        trigger={<Button>新增支出</Button>}
      />
    </>
  )
}

export function EntryActions({
  entry,
  members,
  today,
}: {
  entry: LedgerEntry
  members: Member[]
  today: string
}) {
  const edit = (
    <Button variant="ghost" size="icon" aria-label="修改">
      <PencilIcon />
    </Button>
  )
  const label = entry.kind === "egress" ? "支出" : "收入"
  return (
    <div className="flex shrink-0 gap-1">
      {entry.kind === "egress" ? (
        <EgressForm
          entry={entry}
          members={members}
          today={today}
          trigger={edit}
        />
      ) : (
        <IngressForm entry={entry} today={today} trigger={edit} />
      )}
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon" aria-label="刪除">
            <Trash2Icon />
          </Button>
        }
        title={`刪除這筆${label}？`}
        confirmLabel="刪除"
        onConfirm={() =>
          report(
            entry.kind === "egress"
              ? deleteEgress(entry.id)
              : deleteIngress(entry.id),
            "已刪除"
          )
        }
      />
    </div>
  )
}
