// The greeting service at the door (display.winlab.tw, on the lab's host):
// it shows who came in on the LED panel and says hi on the HomePod. The
// portal tells it the name of whoever opened the door, by button or by card;
// the service owns the name rules and the font.
//   POST /api/greet  {"name": string, "seconds": number}  -> 2xx

const MAX_NAME_LENGTH = 64

export function displayConfigured() {
  return Boolean(process.env.DISPLAY_API_URL && process.env.DISPLAY_API_SECRET)
}

/** Greets name at the door. Never throws: the door is already open, and a
 * dark panel is not worth an error anywhere. */
export async function greet(name: string) {
  const base = process.env.DISPLAY_API_URL
  const secret = process.env.DISPLAY_API_SECRET
  const trimmed = Array.from(name.trim()).slice(0, MAX_NAME_LENGTH).join("")
  if (!base || !secret || !trimmed) return false
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/greet`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: trimmed, seconds: 10 }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}
