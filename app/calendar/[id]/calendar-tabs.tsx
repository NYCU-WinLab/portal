"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// 預約 and 行程 of one member, when they take appointments.
export function CalendarTabs({
  booking,
  schedule,
  defaultTab,
}: {
  booking: React.ReactNode
  schedule: React.ReactNode
  defaultTab: "booking" | "schedule"
}) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="booking">預約</TabsTrigger>
        <TabsTrigger value="schedule">行程</TabsTrigger>
      </TabsList>
      <TabsContent value="booking">{booking}</TabsContent>
      <TabsContent value="schedule">{schedule}</TabsContent>
    </Tabs>
  )
}
