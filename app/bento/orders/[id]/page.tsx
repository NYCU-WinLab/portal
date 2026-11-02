import { ChevronDown } from "lucide-react"
import { notFound } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusMeta,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { getBentoOrder } from "@/lib/actions/bento"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"
import { dishLabel, overBudget } from "@/lib/bento"
import { ntd } from "@/lib/money"
import { dateLabel } from "@/lib/leave-dates"
import { cn } from "@/lib/utils"

import { bentoNav, bentoPage } from "../../nav"
import { OrderDialog } from "../../order-dialog"
import { RestaurantLinks } from "../../restaurant-links"
import { CopyButton, OrderAdmin, RemoveLineButton } from "./order-actions"

export const dynamic = "force-dynamic"

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor(`/bento/orders/${id}`)
  const data = await runAction(getBentoOrder, actor, { orderId: id }).catch(
    () => null
  )
  if (!data) notFound()
  const admin = await isAdmin(actor, "bento")
  const members = admin ? await runAction(listMembers, actor, {}) : undefined
  const { order, restaurant, people, dishes, totals } = data
  const open = order.status === "open"
  const mine = people.find((person) => person.userId === actor.userId)
  // Your own row first, then everyone else in the server's order.
  const rows = mine
    ? [mine, ...people.filter((person) => person !== mine)]
    : people

  return (
    <PortalShell page={bentoPage} nav={bentoNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={restaurant.name}
          actions={
            <>
              {open && (
                <OrderDialog
                  orderId={order.id}
                  restaurant={restaurant.name}
                  menu={data.menu}
                  optionGroups={data.optionGroups}
                  mine={mine?.lines ?? []}
                  members={members}
                  me={actor.userId}
                />
              )}
              {admin && <OrderAdmin orderId={order.id} status={order.status} />}
            </>
          }
        />
        <Focus>
          <FocusLabel>
            {dateLabel(order.date)}
            {order.batch && ` 第 ${order.batch} 批`}，
            {open ? "開放點餐" : "已關單"}
          </FocusLabel>
          <FocusTitle>
            {mine ? (
              <FocusHighlight>
                {mine.lines.map(dishLabel).join("、")}
              </FocusHighlight>
            ) : (
              "你還沒點"
            )}
          </FocusTitle>
          {mine && (
            <FocusMeta>
              <span>
                {mine.lines.length} 份，共{" "}
                <span
                  className={cn(
                    overBudget(actor.userId, mine.total) && "text-destructive"
                  )}
                >
                  {ntd(mine.total)}
                </span>
              </span>
            </FocusMeta>
          )}
          <RestaurantLinks
            restaurant={restaurant}
            menu={data.menu}
            optionGroups={data.optionGroups}
          />
        </Focus>
        {admin && dishes.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <h2 className="font-semibold">給店家</h2>
              <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                {dishes.length} 種
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <ul className="mt-2 flex stagger-rise flex-col">
              {dishes.map((dish) => (
                <li
                  key={dish.name}
                  className="flex flex-col gap-1 border-b border-border py-3"
                >
                  <span className="flex gap-4">
                    <span className="min-w-0 flex-1">{dish.name}</span>
                    <span className="shrink-0 tabular-nums">
                      × {dish.count}
                    </span>
                  </span>
                  {dish.combos.some((combo) => combo.options) &&
                    dish.combos.map((combo) => (
                      <span
                        key={combo.options}
                        className="flex gap-4 text-muted-foreground"
                      >
                        <span className="min-w-0 flex-1">
                          {combo.options || "不加選項"}（
                          {combo.people.join("、")}）
                        </span>
                        <span className="shrink-0 tabular-nums">
                          × {combo.count}
                        </span>
                      </span>
                    ))}
                </li>
              ))}
            </ul>
          </details>
        )}
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="每個人"
            actions={
              <span className="text-muted-foreground tabular-nums">
                {totals.people} 人點了 {totals.dishes} 份，共{" "}
                {ntd(totals.total)}
              </span>
            }
          />
          {people.length === 0 ? (
            <EmptyState noun="人點餐" />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {rows.map((person) => (
                <li
                  key={person.userId}
                  className="flex gap-4 border-b border-border py-2"
                >
                  <span className="flex min-h-10 w-20 shrink-0 items-center truncate font-medium">
                    {person.name}
                  </span>
                  <ul className="flex min-w-0 flex-1 flex-col">
                    {person.lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex min-h-10 items-center gap-4"
                      >
                        <span className="min-w-0 flex-1">
                          {dishLabel(line)}
                        </span>
                        {person.lines.length > 1 && (
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            {line.price}
                          </span>
                        )}
                        {open && (person.userId === actor.userId || admin) && (
                          <RemoveLineButton lineId={line.id} name={line.name} />
                        )}
                      </li>
                    ))}
                  </ul>
                  {open && person.userId !== actor.userId && (
                    <CopyButton
                      orderId={order.id}
                      from={person}
                      replacing={mine?.lines.length ?? 0}
                    />
                  )}
                  <span
                    className={cn(
                      "flex min-h-10 w-12 shrink-0 items-center justify-end tabular-nums",
                      overBudget(person.userId, person.total) &&
                        "text-destructive"
                    )}
                  >
                    {person.total}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {!open && order.closedAt && (
          <p className="text-muted-foreground">
            {new Date(order.closedAt).toLocaleString("zh-TW", {
              timeZone: "Asia/Taipei",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            關單
          </p>
        )}
      </div>
    </PortalShell>
  )
}
