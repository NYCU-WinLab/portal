import { panelGreetings } from "@/lib/actions/door-greetings"

import { panelJson, panelRefused } from "../panel-auth"

// What the door panel greets with: suffix, quiet, playlist and phrases keyed
// by display name, and pool and voice holding hour-long signed urls.
export async function GET(request: Request) {
  return panelRefused(request) ?? panelJson(await panelGreetings())
}
