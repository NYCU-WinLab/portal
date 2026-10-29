"use client"

import { PlusIcon } from "lucide-react"
import * as React from "react"

import { ComboboxContent, ComboboxTrigger } from "@/components/ui/combobox"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover } from "@/components/ui/popover"

// Pick a funding project from the ones used, or type a new one and add it.
// Picking the chosen project again clears it.
export function ProjectCombobox({
  projects,
  value,
  onValueChange,
  placeholder = "選擇計畫",
  disabled,
  className,
  id,
  "aria-label": label,
}: {
  projects: string[]
  value: string | null
  onValueChange: (project: string | null) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
  "aria-label"?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const typed = search.trim().slice(0, 50)
  const options =
    value && !projects.includes(value) ? [...projects, value] : projects

  function pick(project: string | null) {
    onValueChange(project === value ? null : project)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSearch("")
      }}
    >
      <ComboboxTrigger
        id={id}
        aria-label={label}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
      >
        {value}
      </ComboboxTrigger>
      <ComboboxContent>
        <Command>
          <CommandInput
            placeholder="搜尋或新增計畫"
            value={search}
            onValueChange={setSearch}
            maxLength={50}
          />
          <CommandList>
            <CommandGroup>
              {options.map((project) => (
                <CommandItem
                  key={project}
                  value={project}
                  data-checked={project === value}
                  onSelect={() => pick(project)}
                >
                  {project}
                </CommandItem>
              ))}
              {typed && !options.includes(typed) && (
                <CommandItem
                  value={`__new__${typed}`}
                  keywords={[typed]}
                  onSelect={() => pick(typed)}
                >
                  <PlusIcon />
                  新增「{typed}」
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </ComboboxContent>
    </Popover>
  )
}
