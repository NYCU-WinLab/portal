"use client"

import { useRouter } from "next/navigation"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const ALL = "all"

// How the door was opened, as one control beside the record tabs.
export function SourceSelect({
  sources,
  source,
}: {
  sources: Record<string, string>
  source?: string
}) {
  const router = useRouter()
  const items = [
    { value: ALL, label: "全部來源" },
    ...Object.entries(sources).map(([value, label]) => ({ value, label })),
  ]
  return (
    <Select
      value={source ?? ALL}
      onValueChange={(value) =>
        router.push(value === ALL ? "/door/log" : `/door/log?source=${value}`)
      }
      items={items}
    >
      <SelectTrigger aria-label="來源" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
