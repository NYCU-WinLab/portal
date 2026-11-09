import { AvatarStack } from "@/components/avatar-stack"
import { Countdown } from "@/components/countdown"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusMeta,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { listMyAppointments } from "@/lib/actions/appointments"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"
import { dayLabel } from "@/lib/rooms/time"

import { calendarNav, calendarPage } from "../nav"
import { AppointmentTabs } from "./appointment-tabs"

export const dynamic = "force-dynamic"

export default async function AppointmentsPage() {
  const actor = await requireActor("/calendar/appointments")
  const { withMe, byMe } = await runAction(listMyAppointments, actor, {})
  const next = [...withMe, ...byMe].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt)
  )[0]

  return (
    <PortalShell page={calendarPage} nav={calendarNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="預約" />
        {next && (
          <Focus>
            <FocusLabel>
              下一個，{dayLabel(next.date)} {next.start}
            </FocusLabel>
            <FocusTitle>
              和 <FocusHighlight>{next.with}</FocusHighlight>，
              <Countdown to={next.startsAt}>進行中</Countdown> 後
            </FocusTitle>
            <FocusMeta>
              <AvatarStack people={[{ id: next.withId, name: next.with }]} />
              {next.title}
            </FocusMeta>
          </Focus>
        )}
        <AppointmentTabs withMe={withMe} byMe={byMe} />
      </div>
    </PortalShell>
  )
}
