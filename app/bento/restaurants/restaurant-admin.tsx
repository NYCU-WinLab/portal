"use client"

import { PlusIcon, XIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { OptionGroup } from "@/lib/actions/bento-restaurants"
import { report } from "@/lib/report"

import {
  addRestaurant,
  deleteRestaurant,
  saveMenu,
  saveMenuImage,
  saveOptions,
  updateRestaurant,
} from "../actions"

const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim()

type Info = { name: string; phone: string; mapUrl: string | null }

function InfoFields({ info }: { info?: Info }) {
  return (
    <>
      <FormField label="店名" required>
        <Input name="name" maxLength={100} defaultValue={info?.name} />
      </FormField>
      <FormField label="電話" required>
        <Input name="phone" maxLength={40} defaultValue={info?.phone} />
      </FormField>
      <FormField label="地圖連結">
        <Input name="mapUrl" type="url" defaultValue={info?.mapUrl ?? ""} />
      </FormField>
    </>
  )
}

export function AddRestaurant() {
  return (
    <FormDialog
      trigger={<Button>新增</Button>}
      title="新增餐廳"
      submitLabel="新增"
      onSubmit={(data) =>
        report(
          addRestaurant({
            name: value(data, "name"),
            phone: value(data, "phone"),
            mapUrl: value(data, "mapUrl"),
          }),
          "已新增"
        )
      }
    >
      <InfoFields />
    </FormDialog>
  )
}

type Dish = { id?: string; category: string; name: string; price: string }

// The dish list as editable rows; saving replaces the whole menu.
function MenuEditor({
  restaurantId,
  menu,
}: {
  restaurantId: string
  menu: { id: string; category: string; name: string; price: number }[]
}) {
  const initial = () =>
    menu.map((dish) => ({ ...dish, price: String(dish.price) }))
  const [rows, setRows] = React.useState<Dish[]>(initial)
  const edit = (index: number, change: Partial<Dish>) =>
    setRows((all) =>
      all.map((row, at) => (at === index ? { ...row, ...change } : row))
    )

  return (
    <FormDialog
      trigger={<Button variant="outline">編輯菜單</Button>}
      onOpenChange={(open) => open && setRows(initial())}
      title="編輯菜單"
      size="wide"
      submitLabel="儲存"
      onSubmit={() =>
        report(
          saveMenu({
            restaurantId,
            items: rows
              .filter((row) => row.name.trim())
              .map((row) => ({
                id: row.id,
                category: row.category,
                name: row.name,
                price: Number(row.price),
              })),
          }),
          "已儲存菜單"
        )
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 text-muted-foreground">
          <span className="w-28 shrink-0">分類</span>
          <span className="min-w-0 flex-1">菜名</span>
          <span className="w-20 shrink-0">價格</span>
          <span className="w-10 shrink-0" />
        </div>
        {rows.map((row, index) => (
          <div key={row.id ?? `new-${index}`} className="flex gap-2">
            <Input
              aria-label="分類"
              className="w-28 shrink-0"
              value={row.category}
              onChange={(event) =>
                edit(index, { category: event.target.value })
              }
            />
            <Input
              aria-label="菜名"
              className="min-w-0 flex-1"
              value={row.name}
              onChange={(event) => edit(index, { name: event.target.value })}
            />
            <Input
              aria-label="價格"
              className="w-20 shrink-0 tabular-nums"
              inputMode="numeric"
              value={row.price}
              onChange={(event) => edit(index, { price: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`刪除 ${row.name}`}
              onClick={() =>
                setRows((all) => all.filter((_, at) => at !== index))
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows((all) => [
              ...all,
              { category: all.at(-1)?.category ?? "", name: "", price: "" },
            ])
          }
        >
          <PlusIcon />
          加一道
        </Button>
      </div>
    </FormDialog>
  )
}

type Group = {
  name: string
  required: boolean
  multiple: boolean
  values: { label: string; priceDelta: string }[]
}

// Option groups as editable blocks; saving replaces them all.
function OptionsEditor({
  restaurantId,
  groups,
}: {
  restaurantId: string
  groups: OptionGroup[]
}) {
  const initial = () =>
    groups.map((group) => ({
      name: group.name,
      required: group.required,
      multiple: group.multiple,
      values: group.values.map((option) => ({
        label: option.label,
        priceDelta: String(option.priceDelta),
      })),
    }))
  const [rows, setRows] = React.useState<Group[]>(initial)
  const edit = (index: number, change: (group: Group) => Group) =>
    setRows((all) => all.map((row, at) => (at === index ? change(row) : row)))

  return (
    <FormDialog
      trigger={<Button variant="outline">編輯選項</Button>}
      onOpenChange={(open) => open && setRows(initial())}
      title="編輯選項"
      size="wide"
      submitLabel="儲存"
      onSubmit={() =>
        report(
          saveOptions({
            restaurantId,
            groups: rows.map((group) => ({
              ...group,
              values: group.values
                .filter((option) => option.label.trim())
                .map((option) => ({
                  label: option.label,
                  priceDelta: Number(option.priceDelta || 0),
                })),
            })),
          }),
          "已儲存選項"
        )
      }
    >
      <div className="flex flex-col gap-6">
        {rows.map((group, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 border-b border-border pb-6"
          >
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="選項名稱"
                placeholder="甜度、冰量、不醬"
                className="min-w-40 flex-1"
                value={group.name}
                onChange={(event) =>
                  edit(index, (row) => ({ ...row, name: event.target.value }))
                }
              />
              <Button
                type="button"
                variant={group.required ? "default" : "outline"}
                aria-pressed={group.required}
                onClick={() =>
                  edit(index, (row) => ({ ...row, required: !row.required }))
                }
              >
                必選
              </Button>
              <Button
                type="button"
                variant={group.multiple ? "default" : "outline"}
                aria-pressed={group.multiple}
                onClick={() =>
                  edit(index, (row) => ({ ...row, multiple: !row.multiple }))
                }
              >
                可複選
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`刪除 ${group.name}`}
                onClick={() =>
                  setRows((all) => all.filter((_, at) => at !== index))
                }
              >
                <XIcon />
              </Button>
            </div>
            {group.values.map((option, at) => (
              <div key={at} className="flex gap-2 pl-4">
                <Input
                  aria-label="選項"
                  className="min-w-0 flex-1"
                  value={option.label}
                  onChange={(event) =>
                    edit(index, (row) => ({
                      ...row,
                      values: row.values.map((other, i) =>
                        i === at
                          ? { ...other, label: event.target.value }
                          : other
                      ),
                    }))
                  }
                />
                <Input
                  aria-label="加價"
                  placeholder="加價"
                  className="w-20 shrink-0 tabular-nums"
                  inputMode="numeric"
                  value={option.priceDelta === "0" ? "" : option.priceDelta}
                  onChange={(event) =>
                    edit(index, (row) => ({
                      ...row,
                      values: row.values.map((other, i) =>
                        i === at
                          ? { ...other, priceDelta: event.target.value }
                          : other
                      ),
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`刪除 ${option.label}`}
                  onClick={() =>
                    edit(index, (row) => ({
                      ...row,
                      values: row.values.filter((_, i) => i !== at),
                    }))
                  }
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() =>
                edit(index, (row) => ({
                  ...row,
                  values: [...row.values, { label: "", priceDelta: "" }],
                }))
              }
            >
              <PlusIcon />
              加選項
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows((all) => [
              ...all,
              {
                name: "",
                required: false,
                multiple: false,
                values: [{ label: "", priceDelta: "" }],
              },
            ])
          }
        >
          <PlusIcon />
          加一組
        </Button>
      </div>
    </FormDialog>
  )
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function MenuImageButton({
  restaurantId,
  hasImage,
}: {
  restaurantId: string
  hasImage: boolean
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [pending, startTransition] = React.useTransition()

  function upload(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      toast.error("圖片最大 4 MB")
      return
    }
    startTransition(async () => {
      await report(
        saveMenuImage({
          restaurantId,
          image: { contentType: file.type, base64: await readBase64(file) },
        }),
        "已上傳菜單照片"
      ).catch(() => {})
    })
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) upload(file)
        }}
      />
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        {pending ? "上傳中…" : hasImage ? "換照片" : "上傳照片"}
      </Button>
      {hasImage && (
        <ConfirmDialog
          trigger={<Button variant="outline">刪照片</Button>}
          title="刪除菜單照片？"
          confirmLabel="刪除"
          onConfirm={() =>
            report(saveMenuImage({ restaurantId, image: null }), "已刪除照片")
          }
        />
      )}
    </>
  )
}

// Everything a bento admin can change about one restaurant.
export function RestaurantAdmin({
  restaurant,
  menu,
  optionGroups,
}: {
  restaurant: Info & {
    id: string
    active: boolean
    pinned: boolean
    menuImage: number | null
  }
  menu: { id: string; category: string; name: string; price: number }[]
  optionGroups: OptionGroup[]
}) {
  const restaurantId = restaurant.id
  return (
    <div className="flex flex-wrap gap-2">
      <FormDialog
        trigger={<Button variant="outline">修改資料</Button>}
        title="修改餐廳"
        submitLabel="儲存"
        onSubmit={(data) =>
          report(
            updateRestaurant({
              restaurantId,
              name: value(data, "name"),
              phone: value(data, "phone"),
              mapUrl: value(data, "mapUrl"),
            }),
            "已儲存"
          )
        }
      >
        <InfoFields info={restaurant} />
      </FormDialog>
      <MenuEditor restaurantId={restaurantId} menu={menu} />
      <OptionsEditor restaurantId={restaurantId} groups={optionGroups} />
      <MenuImageButton
        restaurantId={restaurantId}
        hasImage={restaurant.menuImage !== null}
      />
      <Button
        variant="outline"
        onClick={() =>
          report(
            updateRestaurant({ restaurantId, pinned: !restaurant.pinned }),
            restaurant.pinned ? "已取消置頂" : "已置頂"
          ).catch(() => {})
        }
      >
        {restaurant.pinned ? "取消置頂" : "置頂"}
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          report(
            updateRestaurant({ restaurantId, active: !restaurant.active }),
            restaurant.active ? "已停用" : "已啟用"
          ).catch(() => {})
        }
      >
        {restaurant.active ? "停用" : "啟用"}
      </Button>
      <ConfirmDialog
        trigger={<Button variant="destructive">刪除</Button>}
        title={`刪除 ${restaurant.name} 和它的菜單？`}
        confirmLabel="刪除"
        onConfirm={() => report(deleteRestaurant(restaurantId), "已刪除")}
      />
    </div>
  )
}
