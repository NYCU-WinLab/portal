import { authenticate } from "@/lib/api-key-http"
import { onChange } from "@/lib/actions/changes"
import { appOfChange } from "@/lib/actions/registry"
import { getSession } from "@/lib/auth/session"

// Server-sent events: one line per change anywhere in the portal, so open
// pages can refresh. The payload is an action name. Signed-in members get
// every change; an API key (the Mac app) gets the changes in its apps only,
// and the stream ends once the key cannot be confirmed again.
const KEY_RECHECK_MS = 60_000
const KEY_RECHECK_TIMEOUT_MS = 10_000

export async function GET(request: Request) {
  let wants: (action: string) => boolean = () => true
  let recheck: (() => Promise<boolean>) | null = null
  if (!(await getSession())) {
    if (!request.headers.get("authorization"))
      return new Response(null, { status: 401 })
    const holder = await authenticate(request)
    if (holder instanceof Response) return holder
    wants = (action) => {
      const app = appOfChange(action)
      return !!app && holder.apps.has(app)
    }
    // Revoked, left the lab, or no answer in time: the stream ends and the
    // client reconnects, which checks the key from scratch.
    recheck = () =>
      Promise.race([
        authenticate(request, { touch: false }).then(
          (h) => !(h instanceof Response)
        ),
        new Promise<boolean>((done) =>
          setTimeout(() => done(false), KEY_RECHECK_TIMEOUT_MS)
        ),
      ]).catch(() => false)
  }

  const encoder = new TextEncoder()
  let closed = false
  let stop = () => {}
  const stream = new ReadableStream({
    async start(controller) {
      const close = () => {
        closed = true
        stop()
        try {
          controller.close()
        } catch {}
      }
      // Registered first, so a client gone before LISTEN is up leaks nothing.
      request.signal.addEventListener("abort", close)
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          stop()
        }
      }
      send("retry: 3000\n\n")
      const off = await onChange((action) => {
        if (wants(action)) send(`data: ${action}\n\n`)
      })
      // Keeps proxies from closing a quiet connection.
      const ping = setInterval(() => send(": ping\n\n"), 25_000)
      const check = recheck
        ? setInterval(() => {
            void recheck!().then((ok) => ok || close())
          }, KEY_RECHECK_MS)
        : undefined
      stop = () => {
        clearInterval(ping)
        clearInterval(check)
        off()
      }
      if (closed || request.signal.aborted) close()
    },
    cancel() {
      closed = true
      stop()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  })
}
