import sharp from "sharp"

// Turns an uploaded picture into the two squares the portal stores. The
// file is checked by its bytes, decoded once with a pixel cap and a time
// limit, turned upright by its EXIF orientation, cropped to the centre and
// written again as WebP, which keeps no metadata (location, camera). One
// picture is decoded at a time across the server, with a short queue, so
// uploads cannot crowd out the rest of the portal.

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const MAX_PIXELS = 16_000_000
const DECODE_SECONDS = 10
const QUEUE_MAX = 3
export const AVATAR_SIZES = { small: 96, large: 256 } as const

/** png, jpeg or webp by the file's own first bytes, else null. */
function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp"
  return null
}

let running: Promise<unknown> = Promise.resolve()
let waiting = 0

/** Runs job after the decodes before it, or refuses when QUEUE_MAX wait. */
async function oneAtATime<T>(job: () => Promise<T>) {
  if (waiting >= QUEUE_MAX) throw new Error("很多人在上傳，請稍後再試")
  waiting++
  const turn = running.then(
    () => job(),
    () => job()
  )
  running = turn.catch(() => {})
  try {
    return await turn
  } finally {
    waiting--
  }
}

export async function avatarImages(bytes: Buffer) {
  if (!bytes.length) throw new Error("圖片是空的")
  if (bytes.length > AVATAR_MAX_BYTES) throw new Error("圖片超過 5 MB")
  if (!imageType(bytes)) throw new Error("只接受 png、jpg、webp 圖片")
  try {
    return await oneAtATime(async () => {
      const large = await sharp(bytes, {
        limitInputPixels: MAX_PIXELS,
        animated: false,
      })
        .timeout({ seconds: DECODE_SECONDS })
        .rotate()
        .resize(AVATAR_SIZES.large, AVATAR_SIZES.large, { fit: "cover" })
        .webp({ quality: 85 })
        .toBuffer()
      // The small one comes from the 256 px result, not the upload.
      const small = await sharp(large)
        .resize(AVATAR_SIZES.small, AVATAR_SIZES.small)
        .webp({ quality: 85 })
        .toBuffer()
      return { small, large }
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("很多人"))
      throw error
    throw new Error("讀不懂這張圖片")
  }
}
