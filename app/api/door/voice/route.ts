import { z } from "zod"

import { announceChange } from "@/lib/actions/changes"
import {
  missingVoiceTexts,
  pruneVoiceClips,
  storeVoiceClip,
  voiceJobSeen,
} from "@/lib/actions/door-phrases"
import { reloadGreetings } from "@/lib/display"
import { soundType } from "@/lib/door-greeting"

import { panelJson, panelRefused } from "../panel-auth"

// The voice job on furnace, with the panel's secret: GET drops the clips the
// door no longer needs and lists the texts it needs and has no clip for (the
// job asks every few seconds, which also marks it online); POST {text,
// base64} stores one clip, refreshes the admins' pages and tells the door to
// fetch it now.

const CLIP_MAX_BYTES = 512 * 1024

export async function GET(request: Request) {
  const refused = panelRefused(request)
  if (refused) return refused
  voiceJobSeen()
  await pruneVoiceClips()
  return panelJson(await missingVoiceTexts())
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
  await announceChange("store_door_voice_clip").catch(() => {})
  void reloadGreetings()
  return panelJson({ ok: true })
}
