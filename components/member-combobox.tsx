"use client"

import * as React from "react"

import { ComboboxContent, ComboboxTrigger } from "@/components/ui/combobox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover } from "@/components/ui/popover"

type Member = {
  id: string
  name: string
  email: string
}

type MemberComboboxProps = {
  members: Member[]
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
} & (
  | {
      multiple?: false
      value: string | null
      onValueChange: (id: string | null) => void
    }
  | {
      multiple: true
      value: string[]
      onValueChange: (ids: string[]) => void
    }
)

// Pick lab members by name or email. One member closes the menu on choice;
// with multiple, the menu stays open and choices toggle.
function MemberCombobox({
  members,
  placeholder = "選擇成員",
  disabled,
  className,
  id,
  ...choice
}: MemberComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const chosen = choice.multiple
    ? choice.value
    : choice.value
      ? [choice.value]
      : []

  function pick(memberId: string) {
    if (choice.multiple) {
      choice.onValueChange(
        chosen.includes(memberId)
          ? chosen.filter((value) => value !== memberId)
          : [...chosen, memberId]
      )
    } else {
      choice.onValueChange(memberId === choice.value ? null : memberId)
      setOpen(false)
    }
  }

  const names = members
    .filter((member) => chosen.includes(member.id))
    .map((member) => member.name)
    .join("、")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ComboboxTrigger
        id={id}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
      >
        {names}
      </ComboboxTrigger>
      <ComboboxContent>
        <Command>
          <CommandInput placeholder="搜尋姓名或信箱" />
          <CommandList>
            <CommandEmpty>找不到成員</CommandEmpty>
            <CommandGroup>
              {members.map((member) => (
                <CommandItem
                  key={member.id}
                  value={member.id}
                  keywords={[member.name, member.email]}
                  data-checked={chosen.includes(member.id)}
                  onSelect={() => pick(member.id)}
                >
                  <span className="truncate">{member.name}</span>
                  <span className="truncate text-muted-foreground">
                    {member.email}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </ComboboxContent>
    </Popover>
  )
}

export { MemberCombobox, type Member }
