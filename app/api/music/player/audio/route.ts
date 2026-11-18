import { playerAuthorized } from "@/lib/actions/music-player"
import { audioType, failAudio, receiveAudio } from "@/lib/music-audio"

// The player posts here the song a member's browser waits for (it learns the
// id from `upload` in its state): the file as the body, ?videoId= and ?ext=.
// Or ?videoId= and ?error= with no body when it could not get the song. Only
// the player's token opens it, and the proxy leaves it alone, so the body
// is not capped at the proxy's size.

export async function POST(request: Request) {
  if (!playerAuthorized(request)) return new Response(null, { status: 401 })
  const query = new URL(request.url).searchParams
  const videoId = query.get("videoId")
  if (!videoId) return new Response(null, { status: 400 })

  const error = query.get("error")
  if (error !== null) {
    failAudio(videoId, error)
    return new Response(null, { status: 204 })
  }

  const ext = query.get("ext") ?? ""
  if (!request.body || !audioType(ext))
    return new Response(null, { status: 400 })
  try {
    await receiveAudio(videoId, ext, request.body)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "收不下這個音檔"
    // The browser should not wait out the timer for a file that will not come.
    failAudio(videoId, message)
    return Response.json(
      { error: message },
      { status: message === "音檔太大" ? 413 : 400 }
    )
  }
  return new Response(null, { status: 204 })
}
