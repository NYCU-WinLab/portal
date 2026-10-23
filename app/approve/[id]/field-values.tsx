import type { PageSize } from "@/components/pdf-view"

export type ShownField = {
  id: string
  page: number
  x: number
  y: number
  width: number
  height: number
  category: string
  value: string | null
}

// Filled-in values drawn on the page: a signature as its image, the rest
// as text.
export function FieldValues({
  fields,
  page,
  size,
}: {
  fields: ShownField[]
  page: number
  size: PageSize
}) {
  return fields
    .filter((f) => f.page === page && f.value)
    .map((f) => {
      const x = f.x * size.width
      const y = f.y * size.height
      const w = f.width * size.width
      const h = f.height * size.height
      return f.category === "signature" &&
        f.value!.startsWith("data:image/") ? (
        <image key={f.id} href={f.value!} x={x} y={y} width={w} height={h} />
      ) : (
        <text
          key={f.id}
          x={x + 2}
          y={y + h / 2}
          dominantBaseline="middle"
          fontSize={Math.min(h * 0.6, 14)}
          fill="black"
        >
          {f.value}
        </text>
      )
    })
}
