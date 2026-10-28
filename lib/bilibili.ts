// Reads Bilibili: one video's details from a pasted link. Public, no
// credentials. Bilibili answers its plain API with 412 to anything that is not
// its own page, so requests are signed the way the page signs them (WBI).
// The player on the lab network fetches the audio itself.
import { createHash } from "node:crypto"

import type { Track } from "@/lib/youtube"

const API = "https://api.bilibili.com"
const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
}
const timeout = () => AbortSignal.timeout(8000)

/** A music id is `bilibili:<bvid>`, or `bilibili:<bvid>_p<n>` for part n of
 * a video with several parts. */
const ID = /^bilibili:(BV[0-9A-Za-z]{10})(?:_p(\d{1,3}))?$/
export const ID_PATTERN = ID.source

// The page's shuffle of the two key halves into the signing salt.
const MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

let salt: { value: string; at: number } | null = null
async function signingSalt() {
  // The keys change daily; an hour old is fresh enough.
  if (salt && Date.now() - salt.at < 3600_000) return salt.value
  const nav = await read<{
    wbi_img: { img_url: string; sub_url: string }
  }>("/x/web-interface/nav", {}, true)
  const key = (url: string) => url.slice(url.lastIndexOf("/") + 1).split(".")[0]
  const raw = key(nav.wbi_img.img_url) + key(nav.wbi_img.sub_url)
  salt = {
    value: MIXIN.map((i) => raw[i])
      .join("")
      .slice(0, 32),
    at: Date.now(),
  }
  return salt.value
}

/** GET an API path; `anyCode` keeps data from answers with a nonzero code
 * (the nav call says "not signed in" and still has the keys). */
async function read<T>(
  path: string,
  query: Record<string, string>,
  anyCode = false
): Promise<T> {
  let search = new URLSearchParams(query)
  if (!anyCode) {
    const signed = new URLSearchParams(
      Object.entries({ ...query, wts: String(Math.floor(Date.now() / 1000)) })
        .map(([k, v]) => [k, v.replace(/[!'()*]/g, "")])
        .sort(([a], [b]) => a.localeCompare(b))
    )
    const rid = createHash("md5")
      .update(signed.toString() + (await signingSalt()))
      .digest("hex")
    search = new URLSearchParams([...signed, ["w_rid", rid]])
  }
  const response = await fetch(`${API}${path}?${search}`, {
    headers,
    cache: "no-store",
    signal: timeout(),
  })
  if (!response.ok) throw new Error(`Bilibili ${path} ${response.status}`)
  const body = (await response.json()) as { code: number; data: T }
  if (body.code !== 0 && !anyCode) throw new Error("找不到這部 Bilibili 影片")
  return body.data
}

/** The music id a Bilibili link points at, or null. Accepts bilibili.com
 * video links (BV or av), with ?p= for one part, and b23.tv short links. */
export async function parseLink(text: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.hostname === "b23.tv") {
    const response = await fetch(url, {
      redirect: "manual",
      headers,
      signal: timeout(),
    })
    const to = response.headers.get("location")
    if (!to) return null
    url = new URL(to, url)
  }
  if (!/(^|\.)bilibili\.com$/.test(url.hostname)) return null
  const match = url.pathname.match(/\/video\/(BV[0-9A-Za-z]{10}|av\d+)/i)
  if (!match) return null
  let bvid = match[1]
  if (/^av/i.test(bvid)) {
    const view = await read<{ bvid: string }>("/x/web-interface/wbi/view", {
      aid: bvid.slice(2),
    })
    bvid = view.bvid
  }
  const part = Number(url.searchParams.get("p") ?? 1)
  return part > 1 ? `bilibili:${bvid}_p${part}` : `bilibili:${bvid}`
}

/** One video (or one part of it) by music id. */
export async function getTrack(id: string): Promise<Track> {
  const match = id.match(ID)
  if (!match) throw new Error("不是 Bilibili 影片")
  const view = await read<{
    title: string
    pic: string
    owner: { name: string }
    pages: { page: number; part: string; duration: number }[]
  }>("/x/web-interface/wbi/view", { bvid: match[1] })
  const number = Number(match[2] ?? 1)
  const page = view.pages.find((p) => p.page === number)
  if (!page) throw new Error("這部影片沒有這一 P")
  return {
    videoId: id,
    title:
      view.pages.length > 1 && page.part
        ? `${view.title}：${page.part}`
        : view.title,
    artist: view.owner.name,
    durationS: page.duration || null,
    thumbnail: view.pic.replace(/^http:/, "https:"),
  }
}
