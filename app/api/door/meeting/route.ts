import { panelMeeting } from "@/lib/actions/door-greetings"

import { panelJson, panelRefused } from "../panel-auth"

// The next lab meeting for the door panel's countdown, or {meeting: null}.
export async function GET(request: Request) {
  return panelRefused(request) ?? panelJson({ meeting: await panelMeeting() })
}
