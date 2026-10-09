"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type StackPerson = { id: string; name: string; image?: string | null }

// The first character a name is known by: 詹 for 詹詠翔, Z for Zhan.
const initial = (name: string) => Array.from(name.trim())[0] ?? "?"

// Several people in the space of one: avatars overlap, and spread apart on
// the spring when pointed at or focused. Each names its person in a tooltip.
// Past max, the rest collapse into a +N.
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
  return (
    <div
      data-slot="avatar-stack"
      className={cn("group/stack flex items-center", className)}
    >
      {shown.map((person, index) => (
        <Tooltip key={person.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={person.name}
                className={cn(
                  "rounded-full transition-all duration-spring outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  index > 0 &&
                    "-ml-3 group-focus-within/stack:ml-1 group-hover/stack:ml-1"
                )}
              />
            }
          >
            <Avatar className="ring-2 ring-background">
              {person.image && <AvatarImage src={person.image} alt="" />}
              <AvatarFallback>{initial(person.name)}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{person.name}</TooltipContent>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={rest.map((person) => person.name).join("、")}
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
