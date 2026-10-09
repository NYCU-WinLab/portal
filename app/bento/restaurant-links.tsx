"use client"

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
import type { OptionGroup } from "@/lib/actions/bento-restaurants"

import { MenuList } from "./menu-list"

const link = "underline-offset-4 hover:underline"

// 電話、地圖、菜單 for one restaurant. 菜單 opens the photo (when there is
// one) above the typed menu.
export function RestaurantLinks({
  restaurant,
  menu,
  optionGroups,
}: {
  restaurant: {
    id: string
    name: string
    phone: string
    mapUrl: string | null
    menuImage: number | null
  }
  menu?: { id: string; category: string; name: string; price: number }[]
  optionGroups?: OptionGroup[]
}) {
  const image =
    restaurant.menuImage &&
    `/bento/restaurants/${restaurant.id}/menu-image?v=${restaurant.menuImage}`
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
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
      {menu ? (
        <Dialog>
          <DialogTrigger render={<button type="button" className={link} />}>
            菜單
          </DialogTrigger>
          <DialogContent size="wide" showCloseButton={false}>
            <DialogHeader className="pr-0">
              <DialogTitle>{restaurant.name}</DialogTitle>
            </DialogHeader>
            {image && (
              <a href={image} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image}
                  alt={`${restaurant.name} 菜單`}
                  className="w-full rounded-control"
                />
              </a>
            )}
            <MenuList menu={menu} optionGroups={optionGroups ?? []} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                關閉
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        image && (
          <a href={image} target="_blank" rel="noreferrer" className={link}>
            菜單照片
          </a>
        )
      )}
    </div>
  )
}
