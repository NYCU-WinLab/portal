"use client"

import { MinusIcon, PlusIcon, XIcon } from "lucide-react"
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
import { dishLabel } from "@/lib/bento"
import { ntd } from "@/lib/money"
import { report } from "@/lib/report"

import { order } from "./actions"

type Dish = { id: string; category: string; name: string; price: number }

/** A dish waiting in the cart, with its options picked. */
type Pick = {
  key: string
  dish: Dish
  optionValueIds: string[]
  options: { label: string }[]
  each: number
  quantity: number
}

// Buttons sit on one row at every width, the same size, and stay in view
// at the bottom while a long menu scrolls under them.
const footer =
  "sticky -bottom-6 -mx-6 -mb-6 flex-row justify-end bg-background/80 px-6 pt-4 pb-6 backdrop-blur-md"

function Stepper({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (value: number) => void
  label: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${label}少一份`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon />
      </Button>
      <span className="w-6 text-center tabular-nums">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${label}多一份`}
        disabled={value >= 10}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon />
      </Button>
    </div>
  )
}

// 點餐: put dishes in the cart (a dish with options asks for them first),
// then order them all at once. A bento admin can order for someone else.
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
  const [cart, setCart] = React.useState<Pick[]>([])
  const [dish, setDish] = React.useState<Dish | null>(null)
  const [picked, setPicked] = React.useState<string[]>([])
  const [quantity, setQuantity] = React.useState(1)
  const [forUser, setForUser] = React.useState<string | null>(me)
  const [pending, startTransition] = React.useTransition()

  function reset() {
    setQuery("")
    setCart([])
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

  const pickedValues = optionGroups.flatMap((group) =>
    group.values
      .filter((value) => picked.includes(value.id))
      .map((value) => ({ ...value, group }))
  )
  const each =
    (dish?.price ?? 0) +
    pickedValues.reduce((sum, value) => sum + value.priceDelta, 0)
  const missing = optionGroups.filter(
    (group) =>
      group.required && !group.values.some((value) => picked.includes(value.id))
  )
  const total = cart.reduce((sum, item) => sum + item.each * item.quantity, 0)
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)
  const inCart = (dishId: string) =>
    cart
      .filter((item) => item.dish.id === dishId)
      .reduce((sum, item) => sum + item.quantity, 0)

  function toggle(group: OptionGroup, valueId: string) {
    setPicked((ids) => {
      if (ids.includes(valueId)) return ids.filter((id) => id !== valueId)
      const others = group.multiple
        ? ids
        : ids.filter((id) => !group.values.some((value) => value.id === id))
      return [...others, valueId]
    })
  }

  // The same dish with the same options adds up instead of a second row.
  function addToCart(item: Omit<Pick, "key">) {
    const key = `${item.dish.id}:${[...item.optionValueIds].sort().join(",")}`
    setCart((all) =>
      all.some((other) => other.key === key)
        ? all.map((other) =>
            other.key === key
              ? {
                  ...other,
                  quantity: Math.min(10, other.quantity + item.quantity),
                }
              : other
          )
        : [...all, { ...item, key }]
    )
  }

  function choose(item: Dish) {
    if (optionGroups.length === 0) {
      addToCart({
        dish: item,
        optionValueIds: [],
        options: [],
        each: item.price,
        quantity: 1,
      })
      return
    }
    setDish(item)
    setPicked([])
    setQuantity(1)
  }

  function add() {
    if (!dish) return
    addToCart({
      dish,
      optionValueIds: picked,
      options: pickedValues.map((value) => ({ label: value.label })),
      each,
      quantity,
    })
    setDish(null)
  }

  function submit() {
    startTransition(async () => {
      try {
        await report(
          order({
            orderId,
            items: cart.map((item) => ({
              menuItemId: item.dish.id,
              optionValueIds: item.optionValueIds,
              quantity: item.quantity,
            })),
            userId: forUser ?? me,
          }),
          `已點 ${count} 份，${ntd(total)}`
        )
        setOpen(false)
        reset()
      } catch {
        // report showed the error; keep the cart for another try.
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
          <div className="flex min-w-0 flex-col gap-6">
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
              <Stepper value={quantity} onChange={setQuantity} label="" />
            </div>
          </div>
        ) : (
          <fieldset disabled={pending} className="flex min-w-0 flex-col gap-6">
            {mine.length > 0 && (
              <section className="flex flex-col">
                <h3 className="pb-1 text-muted-foreground">
                  已經點了{" "}
                  {ntd(mine.reduce((sum, line) => sum + line.price, 0))}
                </h3>
                <ul className="flex flex-col text-muted-foreground">
                  {mine.map((line) => (
                    <li
                      key={line.id}
                      className="flex min-h-10 items-center gap-4"
                    >
                      <span className="min-w-0 flex-1">{dishLabel(line)}</span>
                      <span className="shrink-0 tabular-nums">
                        {line.price}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {cart.length > 0 && (
              <section className="flex flex-col">
                <h3 className="pb-1 text-muted-foreground">這次要點</h3>
                <ul className="flex flex-col">
                  {cart.map((item) => (
                    <li
                      key={item.key}
                      className="flex min-h-10 items-center gap-2 border-b border-border"
                    >
                      <span className="min-w-0 flex-1">
                        {dishLabel({
                          name: item.dish.name,
                          options: item.options,
                        })}
                      </span>
                      <Stepper
                        value={item.quantity}
                        label={item.dish.name}
                        onChange={(next) =>
                          setCart((all) =>
                            all.map((other) =>
                              other.key === item.key
                                ? { ...other, quantity: next }
                                : other
                            )
                          )
                        }
                      />
                      <span className="w-12 shrink-0 text-right tabular-nums">
                        {item.each * item.quantity}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`拿掉 ${item.dish.name}`}
                        onClick={() =>
                          setCart((all) =>
                            all.filter((other) => other.key !== item.key)
                          )
                        }
                      >
                        <XIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {members && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="bento-for">幫誰點</Label>
                <MemberCombobox
                  id="bento-for"
                  className="w-full"
                  members={members}
                  value={forUser}
                  onValueChange={setForUser}
                />
              </div>
            )}
            <div className="flex flex-col gap-4">
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
                            onClick={() => choose(item)}
                            className="flex min-h-12 w-full items-center gap-4 text-left transition-colors duration-state outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <span className="min-w-0 flex-1">{item.name}</span>
                            {inCart(item.id) > 0 && (
                              <span className="shrink-0 text-primary tabular-nums">
                                × {inCart(item.id)}
                              </span>
                            )}
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
          </fieldset>
        )}
        <DialogFooter className={footer}>
          {dish ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDish(null)}
              >
                返回
              </Button>
              <Button disabled={missing.length > 0} onClick={add}>
                {missing.length > 0
                  ? `請選${missing[0].name}`
                  : `加入 ${ntd(each * quantity)}`}
              </Button>
            </>
          ) : (
            <>
              <DialogClose
                disabled={pending}
                render={<Button type="button" variant="outline" />}
              >
                取消
              </DialogClose>
              <Button disabled={pending || count === 0} onClick={submit}>
                {pending
                  ? "點餐中…"
                  : count === 0
                    ? "點餐"
                    : `點餐 ${count} 份，${ntd(total)}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
