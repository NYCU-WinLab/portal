import { notFound } from "next/navigation"

import { AvatarStack } from "@/components/avatar-stack"
import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
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
import { getBentoOrder } from "@/lib/actions/bento"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"
import { overBudget } from "@/lib/bento"
import { dateLabel } from "@/lib/leave-dates"
import { cn } from "@/lib/utils"

import { bentoNav, bentoPage } from "../../nav"
import { OrderDialog } from "../../order-dialog"
import { CopyButton, OrderAdmin, RemoveLineButton } from "./order-actions"

export const dynamic = "force-dynamic"

const link = "underline-offset-4 hover:underline"

/** "雞腿飯（半糖、少冰）" */
const dishLabel = (line: { name: string; options: { label: string }[] }) =>
  line.options.length
    ? `${line.name}（${line.options.map((option) => option.label).join("、")}）`
    : line.name

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

  return (
    <PortalShell page={bentoPage} nav={bentoNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={restaurant.name}
          actions={
            <>
              {admin && <OrderAdmin orderId={order.id} status={order.status} />}
              {open && (
                <OrderDialog
                  orderId={order.id}
                  restaurant={restaurant.name}
                  menu={data.menu}
                  optionGroups={data.optionGroups}
                  members={members}
                  me={actor.userId}
                />
              )}
            </>
          }
        />
        <Focus>
          <FocusLabel>
            {dateLabel(order.date)}
            {order.batch && ` 第 ${order.batch} 批`} ·{" "}
            {open ? "開放點餐" : "已關單"}
          </FocusLabel>
          <FocusTitle>
            <FocusHighlight>
              <NumberTicker value={totals.people} />
            </FocusHighlight>{" "}
            人 ·{" "}
            <FocusHighlight>
              <NumberTicker value={totals.dishes} />
            </FocusHighlight>{" "}
            份 · NT${" "}
            <FocusHighlight>
              <NumberTicker value={totals.total} />
            </FocusHighlight>
          </FocusTitle>
          <FocusMeta>
            {people.length > 0 && (
              <AvatarStack
                people={people.map((person) => ({
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
        </Focus>
        <section className="flex flex-col gap-2">
          <SectionHeader title="每個人" />
          {people.length === 0 ? (
            <EmptyState noun="人點餐" />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {people.map((person) => (
                <ExpandRow
                  key={person.userId}
                  defaultOpen={person.userId === actor.userId && open}
                  actions={
                    open &&
                    person.userId !== actor.userId && (
                      <CopyButton
                        orderId={order.id}
                        from={person}
                        replacing={mine?.lines.length ?? 0}
                      />
                    )
                  }
                  summary={
                    <span className="flex items-center gap-4">
                      <span className="w-20 shrink-0 truncate font-medium">
                        {person.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {person.lines.map((line) => line.name).join("、")}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          overBudget(person.userId, person.total) &&
                            "text-destructive"
                        )}
                      >
                        {person.total}
                      </span>
                    </span>
                  }
                >
                  <ul className="flex flex-col">
                    {person.lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex min-h-10 items-center gap-4"
                      >
                        <span className="min-w-0 flex-1">
                          {dishLabel(line)}
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {line.price}
                        </span>
                        {open && (person.userId === actor.userId || admin) && (
                          <RemoveLineButton lineId={line.id} name={line.name} />
                        )}
                      </li>
                    ))}
                  </ul>
                </ExpandRow>
              ))}
            </ul>
          )}
        </section>
        {dishes.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="給店家" />
            <ul className="flex stagger-rise flex-col">
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
          </section>
        )}
        <section className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
          <a href={`tel:${restaurant.phone}`} className={link}>
            {restaurant.phone}
          </a>
          {restaurant.mapUrl && (
            <a
              href={restaurant.mapUrl}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              地圖
            </a>
          )}
          {restaurant.menuImage && (
            <a
              href={`/bento/restaurants/${restaurant.id}/menu-image?v=${restaurant.menuImage}`}
              target="_blank"
              rel="noreferrer"
              className={link}
            >
              菜單照片
            </a>
          )}
          {!open && order.closedAt && (
            <span>
              {new Date(order.closedAt).toLocaleString("zh-TW", {
                timeZone: "Asia/Taipei",
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              關單
            </span>
          )}
        </section>
      </div>
    </PortalShell>
  )
}
