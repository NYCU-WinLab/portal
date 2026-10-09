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

import { MenuList } from "../menu-list"
import { bentoNav, bentoPage } from "../nav"
import { RestaurantLinks } from "../restaurant-links"
import { AddRestaurant, RestaurantAdmin } from "./restaurant-admin"

export const dynamic = "force-dynamic"

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
                    <RestaurantLinks restaurant={restaurant} />
                    {admin && (
                      <RestaurantAdmin
                        restaurant={restaurant}
                        menu={menu}
                        optionGroups={optionGroups}
                      />
                    )}
                    <MenuList menu={menu} optionGroups={optionGroups} />
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
