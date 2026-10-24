import { z } from "zod"

import { announceProgress } from "@/lib/actions/changes"
import { setVoiceJobProgress } from "@/lib/actions/door-phrases"

import { panelJson, panelRefused } from "../../panel-auth"

// The voice job on furnace, with the panel's secret: POST {text, step,
// steps} after each step of the text it is making, {text: null} once it has
// nothing left. Only the door admins' voice pages refresh on it.

const body = z.object({
  text: z.string().min(1).max(200).nullable(),
  step: z.int().min(0).max(20).default(0),
  steps: z.int().min(0).max(20).default(0),
})

export async function POST(request: Request) {
  const refused = panelRefused(request)
  if (refused) return refused
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return Response.json({ error: "bad request" }, { status: 400 })
  setVoiceJobProgress(parsed.data)
  await announceProgress("door_voice").catch(() => {})
  return panelJson({ ok: true })
}
