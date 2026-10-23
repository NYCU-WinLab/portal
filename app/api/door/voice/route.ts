import { z } from "zod"

import { missingVoiceTexts, storeVoiceClip } from "@/lib/actions/door-phrases"
import { soundType } from "@/lib/door-greeting"

import { panelJson, panelRefused } from "../panel-auth"

// The voice job on furnace, with the panel's secret: GET lists the texts the
// door needs and has no clip for; POST {text, base64} stores one clip.

const CLIP_MAX_BYTES = 512 * 1024

export async function GET(request: Request) {
  return panelRefused(request) ?? panelJson(await missingVoiceTexts())
}

const body = z.object({
  text: z.string().min(1).max(200),
  base64: z.base64().max(Math.ceil((CLIP_MAX_BYTES * 4) / 3) + 4),
})

export async function POST(request: Request) {
  const refused = panelRefused(request)
  if (refused) return refused
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return Response.json({ error: "bad request" }, { status: 400 })
  const { missing } = await missingVoiceTexts()
  if (!missing.includes(parsed.data.text))
    return Response.json({ error: "not needed" }, { status: 409 })
  const audio = Buffer.from(parsed.data.base64, "base64")
  const type = soundType(audio)
  if (!type || audio.length > CLIP_MAX_BYTES)
    return Response.json({ error: "not audio" }, { status: 400 })
  await storeVoiceClip(parsed.data.text, audio, type)
  return panelJson({ ok: true })
}
