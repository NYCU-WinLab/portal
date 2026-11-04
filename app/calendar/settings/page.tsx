import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { getMyAppointmentSchedule } from "@/lib/actions/appointments"
import { getMyCalendar } from "@/lib/actions/calendar"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"
import { LINK_FAILURES } from "@/lib/google-calendar"

import { AppointmentSchedule } from "../appointment-schedule"
import { RotateFeeds } from "../feed-link"
import { MyCalendar } from "../my-calendar"
import { calendarNav, calendarPage } from "../nav"

export const dynamic = "force-dynamic"

export default async function CalendarSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const actor = await requireActor("/calendar/settings")
  const [{ error }, mine, appointments] = await Promise.all([
    searchParams,
    runAction(getMyCalendar, actor, {}),
    runAction(getMyAppointmentSchedule, actor, {}),
  ])

  return (
    <PortalShell page={calendarPage} nav={calendarNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="設定" />
        <section className="flex flex-col gap-6">
          <SectionHeader title="Google 行事曆" />
          {error && (
            <p className="text-destructive">
              {Object.hasOwn(LINK_FAILURES, error)
                ? LINK_FAILURES[error as keyof typeof LINK_FAILURES]
                : LINK_FAILURES.failed}
            </p>
          )}
          {mine.configured || mine.link ? (
            <MyCalendar link={mine.link} />
          ) : (
            <p className="text-muted-foreground">行事曆沒有設定 Google 登入</p>
          )}
        </section>
        {appointments.linked && (
          <section className="flex flex-col gap-6">
            <SectionHeader title="開放預約的時段" />
            <AppointmentSchedule schedule={appointments.schedule} />
          </section>
        )}
        <section className="flex flex-col gap-6">
          <SectionHeader title="訂閱連結" />
          <RotateFeeds />
        </section>
      </div>
    </PortalShell>
  )
}
