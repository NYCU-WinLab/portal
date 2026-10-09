import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { Badge } from "@/components/ui/badge"
import { isAdmin } from "@/lib/actions/authz"
import {
  getBentoRestaurant,
  listBentoRestaurants,
} from "@/lib/actions/bento-restaurants"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { bentoNav, bentoPage } from "../nav"
import { AddRestaurant, RestaurantAdmin } from "./restaurant-admin"

export const dynamic = "force-dynamic"

const link = "underline-offset-4 hover:underline"

export default async function RestaurantsPage() {
  const actor = await requireActor("/bento/restaurants")
  const [{ restaurants }, admin] = await Promise.all([
    runAction(listBentoRestaurants, actor, {}),
    isAdmin(actor, "bento"),
  ])
  const details = await Promise.all(
    restaurants.map((restaurant) =>
      runAction(getBentoRestaurant, actor, { restaurantId: restaurant.id })
    )
  )

  return (
    <PortalShell page={bentoPage} nav={bentoNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="餐廳" actions={admin && <AddRestaurant />} />
        {restaurants.length === 0 ? (
          <EmptyState noun="餐廳" />
        ) : (
          <ul className="flex stagger-rise flex-col">
            {restaurants.map((restaurant, index) => {
              const { menu, optionGroups } = details[index]
              const categories = new Map<string, typeof menu>()
              for (const dish of menu)
                categories.set(dish.category, [
                  ...(categories.get(dish.category) ?? []),
                  dish,
                ])
              return (
                <ExpandRow
                  key={restaurant.id}
                  summary={
                    <span className="flex items-center gap-3">
                      <span
                        className={
                          restaurant.active
                            ? "min-w-0 truncate"
                            : "min-w-0 truncate text-muted-foreground"
                        }
                      >
                        {restaurant.name}
                      </span>
                      {restaurant.pinned && (
                        <Badge variant="outline">置頂</Badge>
                      )}
                      {!restaurant.active && (
                        <Badge variant="muted">停用</Badge>
                      )}
                      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                        {restaurant.dishes} 道
                      </span>
                    </span>
                  }
                >
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground">
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
                    </div>
                    {admin && (
                      <RestaurantAdmin
                        restaurant={restaurant}
                        menu={menu}
                        optionGroups={optionGroups}
                      />
                    )}
                    {optionGroups.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {optionGroups.map((group) => (
                          <p key={group.id}>
                            <span className="text-muted-foreground">
                              {group.name}
                              {group.required && "（必選）"}
                              {group.multiple && "（可複選）"}：
                            </span>
                            {group.values
                              .map(
                                (option) =>
                                  `${option.label}${option.priceDelta ? ` +${option.priceDelta}` : ""}`
                              )
                              .join("、")}
                          </p>
                        ))}
                      </div>
                    )}
                    {[...categories].map(([category, dishes]) => (
                      <section key={category} className="flex flex-col">
                        {category && (
                          <h3 className="pb-1 text-muted-foreground">
                            {category}
                          </h3>
                        )}
                        <ul className="flex flex-col">
                          {dishes.map((dish) => (
                            <li
                              key={dish.id}
                              className="flex min-h-10 items-center gap-4 border-b border-border"
                            >
                              <span className="min-w-0 flex-1">
                                {dish.name}
                              </span>
                              <span className="shrink-0 text-muted-foreground tabular-nums">
                                {dish.price}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </ExpandRow>
              )
            })}
          </ul>
        )}
      </div>
    </PortalShell>
  )
}
