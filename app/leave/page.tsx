import { AvatarStack } from "@/components/avatar-stack"
import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusMeta,
  FocusTitle,
} from "@/components/focus"
import { NumberTicker } from "@/components/ui/number-ticker"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { listLeaves } from "@/lib/actions/leave"
import { isAdmin } from "@/lib/actions/authz"
import { listMeetingStats } from "@/lib/actions/stats"
import { requireActor } from "@/lib/auth/session"
import { dateLabel, upcomingMondays } from "@/lib/leave-dates"

import { LeaveForm } from "./leave-form"
import { WithdrawButton } from "./withdraw-button"

export const dynamic = "force-dynamic"

export default async function LeavePage() {
  const actor = await requireActor("/leave")
  const [{ dates }, { dates: past }] = await Promise.all([
    runAction(listLeaves, actor, {}),
    runAction(listLeaves, actor, { past: true }),
  ])
  const admin = await isAdmin(actor, "meetings")
  const counts = admin
    ? (await runAction(listMeetingStats, actor, {})).members
        .filter((row) => row.leaves + row.leaveScheduled > 0)
        .sort((a, b) => b.leaves - a.leaves || a.name.localeCompare(b.name))
    : []
  const nextMonday = upcomingMondays()[0]
  const away = dates.find((row) => row.date === nextMonday)?.members ?? []
  const mondays = upcomingMondays().map((date) => ({
    value: date,
    label: dateLabel(date),
  }))

  return (
    <PortalShell
      page={{ label: "Leave", href: "/leave", tip: "週一實驗室會議" }}
    >
      <div className="flex flex-col gap-12">
        <PageHeader title="請假" actions={<LeaveForm mondays={mondays} />} />
        <Focus>
          <FocusLabel>{dateLabel(nextMonday)} 的實驗室會議</FocusLabel>
          <FocusTitle>
            {away.length === 0 ? (
              "沒有人請假"
            ) : (
              <>
                <FocusHighlight>
                  <NumberTicker value={away.length} />
                </FocusHighlight>{" "}
                人請假
              </>
            )}
          </FocusTitle>
          {away.length > 0 && (
            <FocusMeta>
              <AvatarStack
                people={away.map((member) => ({
                  id: member.userId,
                  name: member.name,
                }))}
              />
              {away.some((member) => member.userId === actor.userId) && (
                <span>包括你</span>
              )}
            </FocusMeta>
          )}
        </Focus>
        {dates.length === 0 ? (
          <EmptyState noun="請假" />
        ) : (
          dates.map(({ date, members }) => (
            <section key={date} className="flex flex-col gap-2">
              <SectionHeader title={dateLabel(date)} />
              <ul className="flex stagger-rise flex-col">
                {members.map((member) => (
                  <li
                    key={member.userId}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                  >
                    <span className="shrink-0 font-medium">{member.name}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {member.reason}
                    </span>
                    {member.userId === actor.userId && (
                      <WithdrawButton date={date} label={dateLabel(date)} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {counts.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="請假次數" />
            <ul className="flex stagger-rise flex-col">
              {counts.map((row) => (
                <li
                  key={row.userId}
                  className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                >
                  <span className="min-w-0 flex-1 font-medium">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {row.leaves} 次
                    {row.leaveScheduled > 0 &&
                      `（之後 ${row.leaveScheduled} 次）`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {past.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="過去" />
            <ul className="flex stagger-rise flex-col">
              {past.flatMap(({ date, members }) =>
                members.map((member) => (
                  <li
                    key={`${date}-${member.userId}`}
                    className="flex min-h-14 items-center gap-4 border-b border-border py-2"
                  >
                    <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                      {dateLabel(date)}
                    </span>
                    <span className="shrink-0 font-medium">{member.name}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {member.reason}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        )}
      </div>
    </PortalShell>
  )
}
