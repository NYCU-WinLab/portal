"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

const config = {
  in: { label: "收入", color: "success" },
  out: { label: "支出", color: "destructive" },
} satisfies ChartConfig

// "2026-09" → "26/9"
const monthTick = (month: string) =>
  `${month.slice(2, 4)}/${Number(month.slice(5))}`

// Money in and out per month; out includes bank fees.
export function MonthlyChart({
  months,
}: {
  months: { month: string; in: number; out: number }[]
}) {
  return (
    <ChartContainer config={config} className="h-72 w-full">
      <BarChart data={months} barGap={2}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickFormatter={monthTick}
          minTickGap={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatLabel={(month) =>
                `${String(month).slice(0, 4)} 年 ${Number(String(month).slice(5))} 月`
              }
              formatValue={(value) => `NT$ ${value.toLocaleString("en-US")}`}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="in" fill="var(--color-in)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="out" fill="var(--color-out)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
