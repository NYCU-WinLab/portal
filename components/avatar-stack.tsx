"use client"

import { useEffect, useRef, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type StackPerson = { id: string; name: string; image?: string | null }

// A member's picture, by id; people outside the lab (an email as id) have
// none. The route answers 404 without one, and the initial shows.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const picture = (person: StackPerson) =>
  person.image ?? (UUID.test(person.id) ? `/avatars/${person.id}` : null)

// The first character a name is known by: 詹 for 詹詠翔, Z for Zhan.
const initial = (name: string) => Array.from(name.trim())[0] ?? "?"

// Several people in the space of one: avatars overlap, and spread apart on
// the spring when pointed at or focused. Each names its person in a tooltip.
// Past max, the rest collapse into a +N. A finger cannot hover, so a tap
// opens the name, and a tap anywhere else closes it.
function AvatarStack({
  people,
  max = 5,
  className,
}: {
  people: StackPerson[]
  max?: number
  className?: string
}) {
  const shown = people.slice(0, max)
  const rest = people.slice(max)
  const root = useRef<HTMLDivElement>(null)
  const touched = useRef(false)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    if (open === null) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [open])
  // One tooltip at a time, by key: hover and focus go through onOpenChange,
  // a tap through onClick.
  const tooltip = (key: string) => ({
    open: open === key,
    onOpenChange: (next: boolean) => {
      if (touched.current) return
      setOpen((current) => (next ? key : current === key ? null : current))
    },
  })
  const tap = (key: string) => ({
    onPointerDown: (event: React.PointerEvent) => {
      touched.current = event.pointerType !== "mouse"
    },
    onClick: () => {
      if (touched.current) setOpen((current) => (current === key ? null : key))
    },
  })
  return (
    <div
      ref={root}
      data-slot="avatar-stack"
      className={cn("group/stack flex items-center", className)}
    >
      {shown.map((person, index) => (
        <Tooltip key={person.id} {...tooltip(person.id)}>
          <TooltipTrigger
            closeOnClick={false}
            render={
              <button
                type="button"
                aria-label={person.name}
                {...tap(person.id)}
                className={cn(
                  "rounded-full transition-all duration-spring outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  index > 0 &&
                    "-ml-3 group-focus-within/stack:ml-1 group-hover/stack:ml-1"
                )}
              />
            }
          >
            <Avatar className="ring-2 ring-background">
              {picture(person) && <AvatarImage src={picture(person)!} alt="" />}
              <AvatarFallback>{initial(person.name)}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{person.name}</TooltipContent>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip {...tooltip("rest")}>
          <TooltipTrigger
            closeOnClick={false}
            render={
              <button
                type="button"
                aria-label={rest.map((person) => person.name).join("、")}
                {...tap("rest")}
                className="-ml-3 rounded-full transition-all duration-spring outline-none group-focus-within/stack:ml-1 group-hover/stack:ml-1 focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            }
          >
            <Avatar className="ring-2 ring-background">
              <AvatarFallback className="tabular-nums">
                +{rest.length}
              </AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>
            {rest.map((person) => person.name).join("、")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

export { AvatarStack }
