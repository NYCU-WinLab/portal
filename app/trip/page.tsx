import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusMeta,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { runAction } from "@/lib/actions/define"
import { getMySignature } from "@/lib/actions/signature"
import { listTrips } from "@/lib/actions/trip"
import { requireActor } from "@/lib/auth/session"

import { tripNav, tripPage } from "./nav"
import { CreateTrip } from "./trip-forms"
import { UploadDialog } from "./upload-dialog"

export const dynamic = "force-dynamic"

type Listed = Awaited<ReturnType<typeof listTrips.run>>["trips"][number]

function TripRow({ trip }: { trip: Listed }) {
  return (
    <li className="border-b border-border">
      <Link
        href={`/trip/${trip.id}`}
        prefetch
        className="flex min-h-14 items-center gap-4 py-2 transition-colors duration-state hover:text-muted-foreground"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{trip.name}</span>
          {trip.description && (
            <span className="truncate text-muted-foreground">
              {trip.description}
            </span>
          )}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {"files" in trip
            ? `${trip.people} 人，${trip.files} 份`
            : `你傳了 ${trip.mine} 份`}
        </span>
      </Link>
    </li>
  )
}

export default async function TripPage() {
  const actor = await requireActor("/trip")
  const [{ trips, admin }, signature] = await Promise.all([
    runAction(listTrips, actor, {}),
    runAction(getMySignature, actor, {}),
  ])
  const open = trips.filter((trip) => trip.status === "open")
  const closed = trips.filter((trip) => trip.status === "closed")
  const focus = open[0]

  return (
    <PortalShell page={tripPage} nav={tripNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="出差" actions={admin && <CreateTrip />} />
        {focus ? (
          <Focus>
            {/* The whole block opens the trip; links and the button sit
                above the title link's cover. */}
            <div className="group/focus relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-3">
                <FocusLabel>開放上傳</FocusLabel>
                <FocusTitle>
                  <Link
                    href={`/trip/${focus.id}`}
                    prefetch
                    className="underline-offset-4 outline-none group-hover/focus:underline after:absolute after:inset-0 focus-visible:underline"
                  >
                    {focus.name}
                  </Link>
                </FocusTitle>
                <FocusMeta>
                  <span>
                    你上傳了{" "}
                    <FocusHighlight>
                      <NumberTicker value={focus.mine} />
                    </FocusHighlight>{" "}
                    份
                  </span>
                  {"files" in focus && (
                    <span>
                      全部 {focus.people} 人，{focus.files} 份
                    </span>
                  )}
                  {!signature.hasImage && (
                    <Link
                      href="/profile"
                      className="relative z-10 underline-offset-4 hover:underline"
                    >
                      還沒有簽名
                    </Link>
                  )}
                </FocusMeta>
              </div>
              <div className="relative z-10">
                <UploadDialog tripId={focus.id} />
              </div>
            </div>
          </Focus>
        ) : (
          <Focus>
            <FocusLabel>出差</FocusLabel>
            <FocusTitle>沒有開放上傳的出差</FocusTitle>
          </Focus>
        )}
        {open.length > 1 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="開放中" />
            <ul className="flex stagger-rise flex-col">
              {open.slice(1).map((trip) => (
                <TripRow key={trip.id} trip={trip} />
              ))}
            </ul>
          </section>
        )}
        <section className="flex flex-col gap-2">
          <SectionHeader title="已關閉" />
          {closed.length === 0 ? (
            <EmptyState noun="關閉的出差" />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {closed.map((trip) => (
                <TripRow key={trip.id} trip={trip} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </PortalShell>
  )
}
