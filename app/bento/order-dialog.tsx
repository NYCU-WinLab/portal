"use client"

import { ArrowLeftIcon, MinusIcon, PlusIcon } from "lucide-react"
import * as React from "react"

import { EmptyState } from "@/components/empty-state"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { OptionGroup } from "@/lib/actions/bento-restaurants"
import { dishLabel, ntd } from "@/lib/bento"
import { report } from "@/lib/report"
import { cn } from "@/lib/utils"

import { order } from "./actions"

type Dish = { id: string; category: string; name: string; price: number }

// 點餐: pick a dish from the menu (search by name or heading), then its
// options and how many, then order. A bento admin can order for someone else.
export function OrderDialog({
  orderId,
  restaurant,
  menu,
  optionGroups,
  mine,
  members,
  me,
  trigger = <Button>點餐</Button>,
}: {
  orderId: string
  restaurant: string
  menu: Dish[]
  optionGroups: OptionGroup[]
  /** What the member already has on this order. */
  mine: {
    id: string
    name: string
    options: { label: string }[]
    price: number
  }[]
  /** Given to bento admins only: who they can order for. */
  members?: Member[]
  me: string
  trigger?: React.ReactElement
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [dish, setDish] = React.useState<Dish | null>(null)
  const [picked, setPicked] = React.useState<string[]>([])
  const [quantity, setQuantity] = React.useState(1)
  const [forUser, setForUser] = React.useState<string | null>(me)
  const [pending, startTransition] = React.useTransition()

  function reset() {
    setQuery("")
    setDish(null)
    setPicked([])
    setQuantity(1)
    setForUser(me)
  }

  const shown = query.trim()
    ? menu.filter((item) =>
        `${item.category} ${item.name}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      )
    : menu
  const categories = new Map<string, Dish[]>()
  for (const item of shown)
    categories.set(item.category, [
      ...(categories.get(item.category) ?? []),
      item,
    ])

  const each =
    (dish?.price ?? 0) +
    optionGroups
      .flatMap((group) => group.values)
      .filter((value) => picked.includes(value.id))
      .reduce((sum, value) => sum + value.priceDelta, 0)
  const missing = optionGroups.filter(
    (group) =>
      group.required && !group.values.some((value) => picked.includes(value.id))
  )

  function toggle(group: OptionGroup, valueId: string) {
    setPicked((ids) => {
      if (ids.includes(valueId)) return ids.filter((id) => id !== valueId)
      const others = group.multiple
        ? ids
        : ids.filter((id) => !group.values.some((value) => value.id === id))
      return [...others, valueId]
    })
  }

  function submit() {
    if (!dish) return
    startTransition(async () => {
      try {
        await report(
          order({
            orderId,
            menuItemId: dish.id,
            optionValueIds: picked,
            quantity,
            userId: forUser ?? me,
          }),
          `已點 ${dish.name}${quantity > 1 ? ` × ${quantity}` : ""}`
        )
        setOpen(false)
        reset()
      } catch {
        // report showed the error; keep the choice for another try.
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent size="wide" showCloseButton={false}>
        <DialogHeader className="pr-0">
          <DialogTitle>{dish ? dish.name : restaurant}</DialogTitle>
        </DialogHeader>
        {dish ? (
          <fieldset disabled={pending} className="flex min-w-0 flex-col gap-6">
            {optionGroups.map((group) => (
              <div key={group.id} className="flex flex-col gap-2">
                <Label className="gap-1">
                  {group.name}
                  {group.required && (
                    <span aria-hidden className="text-destructive">
                      *
                    </span>
                  )}
                  {group.multiple && (
                    <span className="text-muted-foreground">可複選</span>
                  )}
                </Label>
                <div
                  role="group"
                  aria-label={group.name}
                  className="flex flex-wrap gap-2"
                >
                  {group.values.map((value) => (
                    <Button
                      key={value.id}
                      type="button"
                      variant={
                        picked.includes(value.id) ? "default" : "outline"
                      }
                      aria-pressed={picked.includes(value.id)}
                      onClick={() => toggle(group, value.id)}
                    >
                      {value.label}
                      {value.priceDelta !== 0 && (
                        <span className="tabular-nums opacity-70">
                          {value.priceDelta > 0 ? "+" : ""}
                          {value.priceDelta}
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-2">
              <Label>份數</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="少一份"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((n) => n - 1)}
                >
                  <MinusIcon />
                </Button>
                <span className="w-8 text-center tabular-nums">{quantity}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="多一份"
                  disabled={quantity >= 10}
                  onClick={() => setQuantity((n) => n + 1)}
                >
                  <PlusIcon />
                </Button>
              </div>
            </div>
            {members && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="bento-for">幫誰點</Label>
                <MemberCombobox
                  id="bento-for"
                  members={members}
                  value={forUser}
                  onValueChange={setForUser}
                />
              </div>
            )}
          </fieldset>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {mine.length > 0 && (
              <section className="flex flex-col border-b border-border pb-4">
                <h3 className="pb-1 text-muted-foreground">
                  你點了 {ntd(mine.reduce((sum, line) => sum + line.price, 0))}
                </h3>
                <ul className="flex flex-col">
                  {mine.map((line) => (
                    <li
                      key={line.id}
                      className="flex min-h-10 items-center gap-4"
                    >
                      <span className="min-w-0 flex-1">{dishLabel(line)}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {line.price}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <Input
              type="search"
              placeholder="搜尋菜名"
              aria-label="搜尋菜名"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {shown.length === 0 ? (
              <EmptyState
                noun="菜"
                query={query.trim() || undefined}
                onClearQuery={() => setQuery("")}
              />
            ) : (
              [...categories].map(([category, dishes]) => (
                <section key={category} className="flex flex-col">
                  {category && (
                    <h3 className="pb-1 text-muted-foreground">{category}</h3>
                  )}
                  <ul className="flex flex-col">
                    {dishes.map((item) => (
                      <li key={item.id} className="border-b border-border">
                        <button
                          type="button"
                          onClick={() => setDish(item)}
                          className="flex min-h-12 w-full items-center gap-4 text-left transition-colors duration-state outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="min-w-0 flex-1">{item.name}</span>
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            {item.price}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
        <DialogFooter className={cn(dish && "sm:justify-between")}>
          {dish ? (
            <>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDish(null)
                  setPicked([])
                  setQuantity(1)
                }}
              >
                <ArrowLeftIcon />
                換一道
              </Button>
              <div className="flex gap-3">
                <DialogClose
                  disabled={pending}
                  render={<Button type="button" variant="outline" />}
                >
                  取消
                </DialogClose>
                <Button
                  disabled={pending || missing.length > 0}
                  onClick={submit}
                >
                  {pending
                    ? "點餐中…"
                    : missing.length > 0
                      ? `請選${missing[0].name}`
                      : `點餐 ${ntd(each * quantity)}`}
                </Button>
              </div>
            </>
          ) : (
            <DialogClose render={<Button type="button" variant="outline" />}>
              取消
            </DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
