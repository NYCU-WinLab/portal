import { deflateSync, inflateSync } from "node:zlib"

import { checkSignatureImage } from "@/lib/pdf-sign/image"
import { array, dict, type Increment, name, num, ref } from "@/lib/pdf-sign/pdf"

// The signer's handwritten signature as a widget appearance, written
// straight into an increment: for PDFs that already carry someone else's
// signature, which must not be re-saved. A JPEG goes in as it is
// (DCTDecode); a PNG is decoded here (8-bit, not interlaced: what canvases
// and phones write) into RGB plus an alpha soft mask. Anything else gets
// an invisible signature instead.

const WIDTH = 140
const MAX_HEIGHT = 56
const MARGIN = 24

type Decoded = {
  width: number
  height: number
  colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK"
  /** Image data and its filter: raw samples to deflate, or a JPEG. */
  data: Uint8Array
  filter: "FlateDecode" | "DCTDecode"
  alpha?: Uint8Array
}

function decodeJpeg(data: Buffer): Decoded | null {
  for (let offset = 2; offset + 9 < data.length;) {
    const marker = data[offset + 1]
    const length = data.readUInt16BE(offset + 2)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      const components = data[offset + 9]
      const colorSpace =
        components === 1
          ? "DeviceGray"
          : components === 3
            ? "DeviceRGB"
            : components === 4
              ? "DeviceCMYK"
              : null
      if (!colorSpace || data[offset + 4] !== 8) return null
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
        colorSpace,
        data,
        filter: "DCTDecode",
      }
    }
    offset += 2 + length
  }
  return null
}

function decodePng(data: Buffer): Decoded | null {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let palette: Buffer | null = null
  let transparency: Buffer | null = null
  const chunks: Buffer[] = []
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString("latin1", offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      colorType = body[9]
      // 8-bit, standard compression and filtering, no interlace.
      if (body[8] !== 8 || body[10] !== 0 || body[11] !== 0 || body[12] !== 0)
        return null
    } else if (type === "PLTE") palette = body
    else if (type === "tRNS") transparency = body
    else if (type === "IDAT") chunks.push(body)
    else if (type === "IEND") break
    offset += 12 + length
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels || !width || !height) return null
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(chunks), {
    maxOutputLength: (stride + 1) * height,
  })
  if (raw.length < (stride + 1) * height) return null
  // Undo the per-row filters (the same five as the PNG predictors).
  const pixels = Buffer.alloc(stride * height)
  for (let r = 0; r < height; r++) {
    const type = raw[r * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? pixels[r * stride + i - channels] : 0
      const up = r > 0 ? pixels[(r - 1) * stride + i] : 0
      const upLeft =
        r > 0 && i >= channels ? pixels[(r - 1) * stride + i - channels] : 0
      let value = raw[r * (stride + 1) + 1 + i]
      if (type === 1) value += left
      else if (type === 2) value += up
      else if (type === 3) value += (left + up) >> 1
      else if (type === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      pixels[r * stride + i] = value & 0xff
    }
  }
  const count = width * height
  const gray = colorType === 0 || colorType === 4
  const color = Buffer.alloc(count * (gray ? 1 : 3))
  const alpha = Buffer.alloc(count, 255)
  let hasAlpha = false
  for (let p = 0; p < count; p++) {
    const at = p * channels
    if (colorType === 3) {
      if (!palette) return null
      const index = pixels[at]
      palette.copy(color, p * 3, index * 3, index * 3 + 3)
      if (transparency && index < transparency.length)
        alpha[p] = transparency[index]
    } else if (gray) {
      color[p] = pixels[at]
      if (colorType === 4) alpha[p] = pixels[at + 1]
    } else {
      color[p * 3] = pixels[at]
      color[p * 3 + 1] = pixels[at + 1]
      color[p * 3 + 2] = pixels[at + 2]
      if (colorType === 6) alpha[p] = pixels[at + 3]
    }
    if (alpha[p] !== 255) hasAlpha = true
  }
  return {
    width,
    height,
    colorSpace: gray ? "DeviceGray" : "DeviceRGB",
    data: color,
    filter: "FlateDecode",
    alpha: hasAlpha ? alpha : undefined,
  }
}

/** Adds the appearance to the increment; null when the image can't be used. */
export function addAppearance(
  increment: Increment,
  image: { data: Buffer; contentType: string; corner: string },
  mediaBox: number[]
): { appearance: number; rect: number[] } | null {
  checkSignatureImage(image.data, image.contentType)
  const decoded =
    image.contentType === "image/png"
      ? decodePng(image.data)
      : decodeJpeg(image.data)
  if (!decoded) return null
  const imageDict = (
    colorSpace: string,
    extra: Record<string, ReturnType<typeof num>> = {}
  ) =>
    dict({
      Type: name("XObject"),
      Subtype: name("Image"),
      Width: num(decoded.width),
      Height: num(decoded.height),
      ColorSpace: name(colorSpace),
      BitsPerComponent: num(8),
      ...extra,
    })
  const mask = decoded.alpha
    ? increment.add(
        (() => {
          const d = imageDict("DeviceGray")
          if (d.t === "dict") d.entries.set("Filter", name("FlateDecode"))
          return d
        })(),
        deflateSync(decoded.alpha)
      )
    : null
  const main = imageDict(decoded.colorSpace)
  if (main.t === "dict") {
    main.entries.set("Filter", name(decoded.filter))
    if (mask !== null) main.entries.set("SMask", ref(mask))
  }
  const imageN = increment.add(
    main,
    decoded.filter === "FlateDecode" ? deflateSync(decoded.data) : decoded.data
  )

  let width = WIDTH
  let height = (WIDTH * decoded.height) / decoded.width
  if (height > MAX_HEIGHT) {
    width = (width * MAX_HEIGHT) / height
    height = MAX_HEIGHT
  }
  width = Math.round(width * 100) / 100
  height = Math.round(height * 100) / 100
  const [x0, y0, x1, y1] = mediaBox
  const left = image.corner.endsWith("l")
  const top = image.corner.startsWith("t")
  const x = left ? x0 + MARGIN : x1 - MARGIN - width
  const y = top ? y1 - MARGIN - height : y0 + MARGIN
  const content = Buffer.from(
    `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`,
    "latin1"
  )
  const appearance = increment.add(
    dict({
      Type: name("XObject"),
      Subtype: name("Form"),
      BBox: array(num(0), num(0), num(width), num(height)),
      Resources: dict({ XObject: dict({ Im0: ref(imageN) }) }),
    }),
    content
  )
  return {
    appearance,
    rect: [x, y, x + width, y + height].map((n) => Math.round(n * 100) / 100),
  }
}
