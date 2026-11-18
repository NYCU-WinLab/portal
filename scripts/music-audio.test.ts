import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// The module reads its folder when it loads.
const dir = mkdtempSync(path.join(tmpdir(), "music-audio-test-"))
process.env.MUSIC_AUDIO_DIR = dir
const audio = await import("../lib/music-audio")

const body = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("music audio relay", () => {
  test("a wanted song is listed until the player posts it", async () => {
    const waiting = audio.fetchAudio("aaaaaaaaaaa")
    // Reading the folder comes first, so the want opens a tick later.
    await Bun.sleep(20)
    expect(audio.wantedIds()).toEqual(["aaaaaaaaaaa"])
    await audio.receiveAudio("aaaaaaaaaaa", "m4a", body(new Uint8Array(10)))
    const file = await waiting
    expect(file.type).toBe("audio/mp4")
    expect(file.size).toBe(10)
    expect(audio.wantedIds()).toEqual([])
  })

  test("a song the portal holds is served without asking the player", async () => {
    const file = await audio.fetchAudio("aaaaaaaaaaa")
    expect(file.size).toBe(10)
    expect(audio.wantedIds()).toEqual([])
  })

  test("browsers asking for one song share one want", async () => {
    const first = audio.fetchAudio("bilibili:BV1xx_p2")
    const second = audio.fetchAudio("bilibili:BV1xx_p2")
    await Bun.sleep(20)
    expect(audio.wantedIds()).toEqual(["bilibili:BV1xx_p2"])
    const bytes = new Uint8Array([1, 2, 3])
    await audio.receiveAudio("bilibili:BV1xx_p2", "webm", body(bytes))
    const [a, b] = await Promise.all([first, second])
    expect(a.path).toBe(b.path)
    expect([...readFileSync(a.path)]).toEqual([1, 2, 3])
  })

  test("the player's failure reaches the browser that waits", async () => {
    const waiting = audio.fetchAudio("ccccccccccc")
    await Bun.sleep(20)
    audio.failAudio("ccccccccccc", "下載失敗")
    expect(waiting).rejects.toThrow("下載失敗")
    await Bun.sleep(20)
    expect(audio.wantedIds()).toEqual([])
  })

  test("a browser that gives up stops waiting", async () => {
    const controller = new AbortController()
    const waiting = audio.fetchAudio("ddddddddddd", controller.signal)
    await Bun.sleep(20)
    controller.abort()
    expect(waiting).rejects.toThrow("已取消")
    // The want stays for the player to finish: another browser may come.
    expect(audio.wantedIds()).toEqual(["ddddddddddd"])
    audio.failAudio("ddddddddddd", "測試結束")
  })

  test("a file over the limit is refused and leaves nothing behind", async () => {
    const waiting = audio.fetchAudio("eeeeeeeeeee")
    await Bun.sleep(20)
    expect(
      audio.receiveAudio(
        "eeeeeeeeeee",
        "m4a",
        body(new Uint8Array(21 * 1024 * 1024))
      )
    ).rejects.toThrow("音檔太大")
    await Bun.sleep(50)
    expect(await audio.cachedAudio("eeeeeeeeeee")).toBeNull()
    audio.failAudio("eeeeeeeeeee", "測試結束")
    expect(waiting).rejects.toThrow()
  })

  test("an unknown format and an id that names a path are refused", async () => {
    expect(
      audio.receiveAudio("fffffffffff", "exe", body(new Uint8Array(1)))
    ).rejects.toThrow("不支援")
    // An extension that is a property of every object is not audio either.
    expect(audio.audioType("constructor")).toBeNull()
    expect(audio.fetchAudio("../../etc/passwd")).rejects.toThrow("不是音檔")
  })
})
