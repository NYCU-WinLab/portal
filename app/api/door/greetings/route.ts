import { panelGreetings } from "@/lib/actions/door-greetings"

import { panelJson, panelRefused } from "../panel-auth"

// {suffix, color, sound} for the door panel, each keyed by display name;
// sound holds {url, mode, version} with an hour-long signed url.
export async function GET(request: Request) {
  return panelRefused(request) ?? panelJson(await panelGreetings())
}
