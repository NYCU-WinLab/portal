// The door relay: an ESP32 behind door.winlab.tw that closes the door
// controller's exit contact for a moment. The controller decides how long
// the door stays unlocked. Its API takes a bearer token that never leaves the
// server:
//   GET  /api/state         -> { open: boolean }
//   POST /api/pulse?ms=500  -> { open: false, pulsed_ms: number }

const PULSE_MS = 500

export function doorConfigured() {
  return Boolean(process.env.DOOR_API_URL && process.env.DOOR_API_SECRET)
}

async function call(path: string, method: "GET" | "POST") {
  const base = process.env.DOOR_API_URL
  const secret = process.env.DOOR_API_SECRET
  if (!base || !secret) throw new Error("門禁沒有設定")
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers: { authorization: `Bearer ${secret}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    throw new Error("連不上門禁")
  })
  if (!response.ok) throw new Error(`門禁回應 ${response.status}`)
  const body = (await response.json()) as { open?: unknown }
  if (typeof body.open !== "boolean") throw new Error("門禁回應格式不對")
  return { open: body.open }
}

/** Whether the relay answers. */
export const doorState = () => call("/api/state", "GET")

/** One short closure of the contact: the door unlocks. */
export const pulseDoor = () => call(`/api/pulse?ms=${PULSE_MS}`, "POST")
