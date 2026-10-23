"use client"

import * as React from "react"

import { FormField } from "@/components/form-dialog"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { deliverableLabel, type Epic } from "@/lib/rooms/meeting"

import { loadDeliverables, loadEpics } from "./actions"

export type RoomGroup = {
  name: string
  label: string
  gitlabLinked: boolean
  members: { name: string; email: string; username: string }[]
  unmailable: string[]
}

export type MeetingValue = {
  title: string
  group: string | null
  inviteGroup: boolean
  attendees: string[]
  includeAdvisor: boolean
  epic: string | null
  agenda: string
}

export const emptyMeeting: MeetingValue = {
  title: "meeting",
  group: null,
  inviteGroup: true,
  attendees: [],
  includeAdvisor: true,
  epic: null,
  agenda: "",
}

/** The value as book_room and create_room_series take it. */
export const meetingInput = (value: MeetingValue) => ({
  title: value.title,
  group: value.group,
  invite_group_members: value.inviteGroup,
  attendees: value.attendees,
  include_advisor: value.includeAdvisor,
  epic: value.epic,
  agenda: value.agenda || null,
})

const NO_GROUP = "none"

// What a meeting is and who comes: shared by a one-off booking and a
// standing meeting. The project group names the recording's folder and
// unlocks its GitLab epics.
export function MeetingFields({
  value,
  onChange,
  groups,
  members,
  syncOnly,
}: {
  value: MeetingValue
  onChange: (value: MeetingValue) => void
  groups: RoomGroup[]
  members: (Member & { username: string | null })[]
  /** A standing meeting may only belong to a sync epic. */
  syncOnly?: boolean
}) {
  const set = (patch: Partial<MeetingValue>) => onChange({ ...value, ...patch })
  const group = groups.find((g) => g.name === value.group) ?? null
  // Each answer is kept with what it answers, so a stale one never shows.
  const [loadedEpics, setLoadedEpics] = React.useState<{
    group: string
    epics: Epic[] | string
  } | null>(null)
  const [loadedOwes, setLoadedOwes] = React.useState<{
    key: string
    text: string
  } | null>(null)
  const linked = group?.gitlabLinked ? group.name : null
  const owesKey = group && value.epic ? `${group.name}&${value.epic}` : null

  React.useEffect(() => {
    if (!linked) return
    let live = true
    void loadEpics(linked).then(({ result, error }) => {
      if (live) setLoadedEpics({ group: linked, epics: error ?? result!.epics })
    })
    return () => {
      live = false
    }
  }, [linked])

  React.useEffect(() => {
    if (!owesKey) return
    const [name, epic] = owesKey.split("&")
    let live = true
    void loadDeliverables(name, epic).then(({ result, error }) => {
      if (!live) return
      setLoadedOwes({
        key: owesKey,
        text:
          error ??
          (result!.deliverables.length
            ? `要交：${result!.deliverables.map(deliverableLabel).join("、")}`
            : "這個 Epic 沒有要交的東西"),
      })
    })
    return () => {
      live = false
    }
  }, [owesKey])

  const epics = loadedEpics?.group === linked ? loadedEpics.epics : null
  const owes = loadedOwes?.key === owesKey ? loadedOwes.text : null

  const prefix =
    value.group ??
    members.find((m) => value.attendees.includes(m.id))?.username ??
    null
  const epicItems =
    Array.isArray(epics) &&
    epics.filter((epic) => !syncOnly || epic.kind === "sync")

  return (
    <>
      <FormField
        label={prefix ? `會議名稱（前面會加 [${prefix}]-）` : "會議名稱"}
      >
        <Input
          value={value.title}
          maxLength={80}
          onChange={(event) => set({ title: event.target.value })}
        />
      </FormField>
      <div className="flex flex-col gap-2">
        <Label htmlFor="meeting-group">專案群組</Label>
        <Select
          value={value.group ?? NO_GROUP}
          onValueChange={(next) =>
            set({ group: next === NO_GROUP ? null : String(next), epic: null })
          }
          items={[
            { value: NO_GROUP, label: "不選" },
            ...groups.map((g) => ({ value: g.name, label: g.label })),
          ]}
        >
          <SelectTrigger id="meeting-group" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GROUP}>不選</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.name} value={g.name}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {group && (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="meeting-invite-group">
            邀請群組的 {group.members.length} 人
            {group.unmailable.length
              ? `（${group.unmailable.join("、")} 沒有信箱）`
              : ""}
          </Label>
          <Switch
            id="meeting-invite-group"
            checked={value.inviteGroup}
            onCheckedChange={(checked) => set({ inviteGroup: checked })}
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="meeting-attendees">
          {group ? "其他與會成員" : "與會成員"}
        </Label>
        <MemberCombobox
          id="meeting-attendees"
          className="w-full"
          multiple
          members={members}
          value={value.attendees}
          onValueChange={(attendees) => set({ attendees })}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="meeting-advisor">邀請老師</Label>
        <Switch
          id="meeting-advisor"
          checked={value.includeAdvisor}
          onCheckedChange={(checked) => set({ includeAdvisor: checked })}
        />
      </div>
      {group?.gitlabLinked && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="meeting-epic">
            {syncOnly ? "GitLab Epic（只能選 Sync）" : "GitLab Epic"}
          </Label>
          {typeof epics === "string" ? (
            <p className="text-destructive">{epics}</p>
          ) : (
            <Select
              value={value.epic ?? NO_GROUP}
              onValueChange={(next) =>
                set({ epic: next === NO_GROUP ? null : String(next) })
              }
              items={[
                { value: NO_GROUP, label: epics ? "不選" : "讀取中…" },
                ...(epicItems || []).map((epic) => ({
                  value: String(epic.iid),
                  label: epic.title,
                })),
              ]}
            >
              <SelectTrigger id="meeting-epic" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>不選</SelectItem>
                {(epicItems || []).map((epic) => (
                  <SelectItem key={epic.iid} value={String(epic.iid)}>
                    {epic.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {owes && <p className="text-muted-foreground">{owes}</p>}
        </div>
      )}
      <FormField label="討論事項">
        <Textarea
          value={value.agenda}
          maxLength={2000}
          rows={3}
          onChange={(event) => set({ agenda: event.target.value })}
        />
      </FormField>
    </>
  )
}
