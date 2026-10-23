"use client"

import { PencilIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { Button } from "@/components/ui/button"
import { ComboboxContent, ComboboxTrigger } from "@/components/ui/combobox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ScheduledMeeting } from "@/lib/actions/meetings-shared"
import { dateLabel } from "@/lib/leave-dates"

import { questioners, remove, update, updateMine } from "./actions"
import { report } from "@/lib/report"

type Option = { value: string; label: string }

// A row action: a ghost icon button named by its tooltip (DESIGN.md Lists).
function IconAction({
  label,
  children,
  ...props
}: React.ComponentProps<"button"> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={label} {...props} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const kinds: Option[] = [
  { value: "regular", label: "一般報告" },
  { value: "thesis", label: "碩論" },
  { value: "speaker", label: "演講" },
  { value: "holiday", label: "放假" },
]

const text = (data: FormData, key: string) =>
  data.has(key) ? String(data.get(key) ?? "").trim() : undefined

// Every typed word must appear in the paper's label: "ebpf nsdi" finds
// Electrode, where the default fuzzy match would list half the papers.
function matchesWords(_value: string, search: string, keywords?: string[]) {
  const text = (keywords ?? []).join(" ").toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word))
    ? 1
    : 0
}

// The paper list runs long, so it is searched, not scrolled. A hidden
// input carries the choice into the form.
function PaperSelect({
  papers,
  defaultValue,
}: {
  papers: Option[]
  defaultValue?: string | null
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState(defaultValue ?? "")
  const chosen = papers.find((paper) => paper.value === value)
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="meeting-paper">論文</Label>
      <input type="hidden" name="paperId" value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <ComboboxTrigger
          id="meeting-paper"
          placeholder="從論文清單選"
          className="w-full"
        >
          {chosen?.label}
        </ComboboxTrigger>
        <ComboboxContent>
          <Command filter={matchesWords}>
            <CommandInput placeholder="搜尋論文" />
            <CommandList>
              <CommandEmpty>找不到論文</CommandEmpty>
              <CommandGroup>
                {papers.map((paper) => (
                  <CommandItem
                    key={paper.value}
                    value={paper.value}
                    keywords={[paper.label]}
                    data-checked={paper.value === value}
                    onSelect={() => {
                      setValue(paper.value)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{paper.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </ComboboxContent>
      </Popover>
    </div>
  )
}

export function MeetingActions({
  meeting,
  mine,
  admin,
  upcoming,
  papers,
  members,
}: {
  meeting: ScheduledMeeting
  mine: boolean
  admin: boolean
  upcoming: boolean
  papers: Option[]
  members: Member[]
}) {
  const [kind, setKind] = React.useState<string>(meeting.kind)
  const [presenterId, setPresenterId] = React.useState(
    meeting.presenter?.id ?? null
  )
  // Shows this week's questioners; saving a changed list pins it.
  const seated = meeting.questioners.map((seat) => seat.id)
  const [askers, setAskers] = React.useState(seated)
  const date = meeting.date
  if (!admin && !mine) return null

  async function submitEdit(data: FormData) {
    const links = {
      slidesUrl: text(data, "slidesUrl"),
      recordingUrl: text(data, "recordingUrl"),
      notes: text(data, "notes"),
    }
    const paperId = kind === "regular" ? text(data, "paperId") : undefined
    const title =
      kind === "thesis" || kind === "speaker" ? text(data, "title") : undefined
    if (!admin) {
      await report(
        updateMine({ date, paperId: paperId || undefined, title, ...links }),
        "已儲存"
      )
      return
    }
    const newDate = text(data, "date")
    await report(
      update({
        date,
        newDate: newDate !== date ? newDate : undefined,
        kind,
        holiday: kind === "holiday" ? text(data, "holiday") : undefined,
        presenterId:
          kind === "regular" || kind === "thesis" ? presenterId : null,
        paperId: paperId || null,
        title,
        location: text(data, "location"),
        startsAt: text(data, "startsAt"),
        ...links,
      }),
      "已儲存"
    )
    const changed =
      askers.length !== seated.length ||
      askers.some((id) => !seated.includes(id))
    if (
      changed &&
      upcoming &&
      (kind === "regular" || kind === "thesis") &&
      presenterId
    )
      await report(
        questioners({ date: newDate ?? date, userIds: askers }),
        "已儲存提問人"
      )
  }

  return (
    <div className="flex shrink-0 gap-1">
      <FormDialog
        trigger={
          <IconAction label="編輯">
            <PencilIcon />
          </IconAction>
        }
        title={`編輯 ${dateLabel(date)}`}
        size="wide"
        submitLabel="儲存"
        onSubmit={submitEdit}
      >
        {admin && (
          <>
            <FormField label="日期" required>
              <Input name="date" type="date" defaultValue={date} />
            </FormField>
            <div className="flex flex-col gap-2">
              <Label htmlFor="meeting-kind">類型</Label>
              <Select
                items={kinds}
                value={kind}
                onValueChange={(value) => setKind(String(value))}
              >
                <SelectTrigger id="meeting-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {kind === "holiday" && (
              <FormField label="放假原因" required>
                <Input
                  name="holiday"
                  defaultValue={meeting.holiday ?? ""}
                  maxLength={50}
                />
              </FormField>
            )}
            {(kind === "regular" || kind === "thesis") && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="meeting-presenter">報告人</Label>
                <MemberCombobox
                  id="meeting-presenter"
                  members={members}
                  value={presenterId}
                  onValueChange={setPresenterId}
                  placeholder="未排"
                  className="w-full"
                />
              </div>
            )}
          </>
        )}
        {kind === "regular" && (
          <PaperSelect papers={papers} defaultValue={meeting.paper?.id} />
        )}
        {(kind === "thesis" || kind === "speaker") && (
          <FormField label="題目">
            <Input
              name="title"
              defaultValue={meeting.title ?? ""}
              maxLength={300}
            />
          </FormField>
        )}
        {kind !== "holiday" && (
          <>
            <FormField label="投影片連結">
              <Input
                name="slidesUrl"
                type="url"
                defaultValue={meeting.slidesUrl ?? ""}
              />
            </FormField>
            <FormField label="錄影連結">
              <Input
                name="recordingUrl"
                type="url"
                defaultValue={meeting.recordingUrl ?? ""}
              />
            </FormField>
          </>
        )}
        <FormField label="備註">
          <Input
            name="notes"
            defaultValue={meeting.notes ?? ""}
            maxLength={1000}
          />
        </FormField>
        {admin && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="地點" required>
                <Input
                  name="location"
                  defaultValue={meeting.location}
                  maxLength={100}
                />
              </FormField>
              <FormField label="時間" required>
                <Input
                  name="startsAt"
                  type="time"
                  defaultValue={meeting.startsAt}
                />
              </FormField>
            </div>
            {upcoming && (kind === "regular" || kind === "thesis") && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="meeting-askers">指定提問人</Label>
                <MemberCombobox
                  id="meeting-askers"
                  members={members}
                  multiple
                  value={askers}
                  onValueChange={(ids) => setAskers(ids.slice(0, 3))}
                  placeholder="自動排"
                  className="w-full"
                />
              </div>
            )}
          </>
        )}
      </FormDialog>
      {admin && (
        <ConfirmDialog
          trigger={
            <IconAction label="刪除">
              <Trash2Icon />
            </IconAction>
          }
          title={`刪除 ${dateLabel(date)}？`}
          confirmLabel="刪除"
          onConfirm={() => report(remove({ date }), "已刪除")}
        />
      )}
    </div>
  )
}
