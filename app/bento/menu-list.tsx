import type { OptionGroup } from "@/lib/actions/bento-restaurants"

type Dish = { id: string; category: string; name: string; price: number }

// A restaurant's menu as members read it: option groups, then dishes under
// their headings. Shared by the restaurants page and an order's 菜單.
export function MenuList({
  menu,
  optionGroups,
}: {
  menu: Dish[]
  optionGroups: OptionGroup[]
}) {
  const categories = new Map<string, Dish[]>()
  for (const dish of menu)
    categories.set(dish.category, [
      ...(categories.get(dish.category) ?? []),
      dish,
    ])
  return (
    <div className="flex flex-col gap-6">
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
            <h3 className="pb-1 text-muted-foreground">{category}</h3>
          )}
          <ul className="flex flex-col">
            {dishes.map((dish) => (
              <li
                key={dish.id}
                className="flex min-h-10 items-center gap-4 border-b border-border"
              >
                <span className="min-w-0 flex-1">{dish.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {dish.price}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
