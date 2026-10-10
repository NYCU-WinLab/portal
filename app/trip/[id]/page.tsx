import { notFound } from "next/navigation"

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
import { buttonVariants } from "@/components/ui/button"
import { NumberTicker } from "@/components/ui/number-ticker"
import { runAction } from "@/lib/actions/define"
import { getTrip } from "@/lib/actions/trip"
import { requireActor } from "@/lib/auth/session"

import { FileRow } from "../file-row"
import { tripNav, tripPage } from "../nav"
import { TripAdmin } from "../trip-forms"
import { UploadDialog } from "../upload-dialog"

export const dynamic = "force-dynamic"

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor(`/trip/${id}`)
  const data = await runAction(getTrip, actor, { tripId: id }).catch(() => null)
  if (!data) notFound()
  const { trip, admin, mine, people } = data
  const open = trip.status === "open"
  const files = people.reduce((sum, person) => sum + person.files.length, 0)
  // An admin's own files are under 我的檔案, not again among the others.

  return (
    <PortalShell page={tripPage} nav={tripNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title={trip.name}
          actions={
            <>
              {admin && <TripAdmin trip={trip} files={files} />}
              {open && <UploadDialog tripId={trip.id} />}
            </>
          }
        />
        <Focus>
          <FocusLabel>{open ? "開放上傳" : "已關閉"}</FocusLabel>
          <FocusTitle>
            你上傳了{" "}
            <FocusHighlight>
              <NumberTicker value={mine.length} />
            </FocusHighlight>{" "}
            份
          </FocusTitle>
          {trip.description && (
            <FocusMeta>
              <span>{trip.description}</span>
            </FocusMeta>
          )}
        </Focus>
        <section className="flex flex-col gap-2">
          <SectionHeader title="我的檔案" />
          {mine.length === 0 ? (
            <EmptyState noun="檔案" />
          ) : (
            <ul className="flex stagger-rise flex-col">
              {mine.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  canEdit={open}
                  canDelete={open || admin}
                />
              ))}
            </ul>
          )}
        </section>
        {admin &&
          people
            .filter((person) => person.userId !== actor.userId)
            .map((person) => (
              <section
                key={person.userId ?? "left"}
                className="flex flex-col gap-2"
              >
                <SectionHeader
                  title={`${person.name}，${person.files.length} 份`}
                  actions={
                    person.userId && (
                      <a
                        href={`/trip/${trip.id}/download?member=${person.userId}`}
                        className={buttonVariants({ variant: "outline" })}
                      >
                        下載
                      </a>
                    )
                  }
                />
                <ul className="flex stagger-rise flex-col">
                  {person.files.map((file) => (
                    <FileRow
                      key={file.id}
                      file={file}
                      canEdit={false}
                      canDelete
                    />
                  ))}
                </ul>
              </section>
            ))}
      </div>
    </PortalShell>
  )
}
