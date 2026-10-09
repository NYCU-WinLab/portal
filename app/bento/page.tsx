import Link from "next/link"

import { AvatarStack } from "@/components/avatar-stack"
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
import { NumberTicker } from "@/components/ui/number-ticker"
import { listMembers } from "@/lib/actions/admins"
import { isAdmin } from "@/lib/actions/authz"
import { getBentoOrder, listBentoOrders } from "@/lib/actions/bento"
import { listBentoRestaurants } from "@/lib/actions/bento-restaurants"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"
import { dishLabel } from "@/lib/bento"
import { ntd } from "@/lib/money"
import { dateLabel, taipeiToday } from "@/lib/leave-dates"

import { CreateOrder } from "./create-order"
import { bentoNav, bentoPage } from "./nav"
import { OrderDialog } from "./order-dialog"
import { RestaurantLinks } from "./restaurant-links"

export const dynamic = "force-dynamic"

type Listed = Awaited<ReturnType<typeof listBentoOrders.run>>["orders"][number]

const when = (order: { date: string; batch: number | null }) =>
  `${dateLabel(order.date)}${order.batch ? ` 第 ${order.batch} 批` : ""}`

function OrderRow({ order }: { order: Listed }) {
  return (
    <li className="border-b border-border">
      <Link
        href={`/bento/orders/${order.id}`}
        prefetch
        className="flex min-h-14 items-center gap-4 py-2 transition-colors duration-state hover:text-muted-foreground"
      >
        <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
          {when(order)}
        </span>
        <span className="min-w-0 flex-1 truncate">{order.restaurant}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {order.people} 人，{ntd(order.total)}
        </span>
      </Link>
    </li>
  )
}

export default async function BentoPage() {
  const actor = await requireActor("/bento")
  const [{ orders }, admin] = await Promise.all([
    runAction(listBentoOrders, actor, { limit: 60 }),
    isAdmin(actor, "bento"),
  ])
  const open = orders.filter((order) => order.status === "open")
  const past = orders.filter((order) => order.status === "closed")
  const [focus, members, restaurants] = await Promise.all([
    open[0] ? runAction(getBentoOrder, actor, { orderId: open[0].id }) : null,
    admin ? runAction(listMembers, actor, {}) : undefined,
    admin ? runAction(listBentoRestaurants, actor, {}) : null,
  ])
  const mine = focus?.people.find((person) => person.userId === actor.userId)

  return (
    <PortalShell page={bentoPage} nav={bentoNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="便當"
          actions={
            restaurants && (
              <CreateOrder
                today={taipeiToday()}
                restaurants={restaurants.restaurants
                  .filter((restaurant) => restaurant.active)
                  .map((restaurant) => ({
                    value: restaurant.id,
                    label: restaurant.name,
                  }))}
              />
            )
          }
        />
        {focus ? (
          <Focus>
            {/* The whole block opens the order: the title's link covers it,
                and the links and button inside sit above that cover. */}
            <div className="group/focus relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-3">
                <FocusLabel>{when(focus.order)}，開放點餐</FocusLabel>
                <FocusTitle>
                  <Link
                    href={`/bento/orders/${focus.order.id}`}
                    prefetch
                    className="underline-offset-4 outline-none group-hover/focus:underline after:absolute after:inset-0 focus-visible:underline"
                  >
                    {focus.restaurant.name}
                  </Link>
                </FocusTitle>
                <FocusMeta>
                  <span>
                    <FocusHighlight>
                      <NumberTicker value={focus.totals.people} />
                    </FocusHighlight>{" "}
                    人點了{" "}
                    <FocusHighlight>
                      <NumberTicker value={focus.totals.dishes} />
                    </FocusHighlight>{" "}
                    份，共 {ntd(focus.totals.total)}
                  </span>
                  {focus.people.length > 0 && (
                    <AvatarStack
                      people={focus.people.map((person) => ({
                        id: person.userId,
                        name: person.name,
                      }))}
                    />
                  )}
                  <span>
                    {mine
                      ? `你點了 ${mine.lines.map(dishLabel).join("、")}`
                      : "你還沒點"}
                  </span>
                </FocusMeta>
                <div className="relative z-10 w-fit">
                  <RestaurantLinks
                    restaurant={focus.restaurant}
                    menu={focus.menu}
                    optionGroups={focus.optionGroups}
                  />
                </div>
              </div>
              <div className="relative z-10">
                <OrderDialog
                  orderId={focus.order.id}
                  restaurant={focus.restaurant.name}
                  menu={focus.menu}
                  optionGroups={focus.optionGroups}
                  mine={mine?.lines ?? []}
                  members={members}
                  me={actor.userId}
                />
              </div>
            </div>
          </Focus>
        ) : (
          <Focus>
            <FocusLabel>今天</FocusLabel>
            <FocusTitle>還沒開單</FocusTitle>
          </Focus>
        )}
        {open.length > 1 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="開放中" />
            <ul className="flex stagger-rise flex-col">
              {open.slice(1).map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </ul>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <SectionHeader title="過去" />
          {past.length === 0 ? (
            <EmptyState noun="訂單" />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {past.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </PortalShell>
  )
}
