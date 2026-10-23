import { redirect } from "next/navigation"

import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { meetingForJoin } from "@/lib/actions/rooms-meetings"

export const dynamic = "force-dynamic"

// The link in a meeting invite. The invite goes out the moment the room is
// booked, minutes before the Teams meeting exists, so it points here and
// this sends people on once there is one. Open without signing in:
// attendees from a Keycloak group need no portal account, and the booking
// id is an unguessable uuid only invitees were sent.

const titles = {
  pending: "線上會議還在建立，稍後重新整理",
  cancelled: "這場會議已取消",
  offline: "這場會議只借了教室，沒有線上會議",
  failed: "這場會議沒有建成線上會議",
  missing: "找不到這場會議",
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const meeting = /^[0-9a-f-]{36}$/i.test(id)
    ? await meetingForJoin(id)
    : ({ state: "missing" } as const)
  if (meeting.state === "ready") redirect(meeting.url)
  return (
    <PortalShell layout="spotlight">
      <StatusPage title={titles[meeting.state]} />
    </PortalShell>
  )
}
