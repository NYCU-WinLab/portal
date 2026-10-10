// A signature image is checked before anything decodes it. A PNG decoder
// allocates width x height x 4 bytes from the header, a PNG can carry a
// second header later on, and an animated PNG makes pdf-lib decode every
// frame at full size before refusing it. So the chunks are walked: exactly
// one IHDR, first, within the size limit, and only still-image chunks.

const MAX_SIDE = 3000
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const STILL_PNG_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "sBIT",
  "bKGD",
  "pHYs",
  "tIME",
  "tEXt",
  "zTXt",
  "iTXt",
  // Later additions to the PNG spec, still images only.
  "eXIf",
  "cICP",
  "mDCV",
  "cLLI",
  "sPLT",
  "hIST",
  // Apple's hint for decoding in parallel; decoders that do not know it
  // skip it.
  "iDOT",
])

export function checkSignatureImage(data: Buffer, contentType: string) {
  if (contentType === "image/png") {
    if (!data.subarray(0, 8).equals(PNG)) throw new Error("這不是 PNG 檔")
    let offset = 8
    let headers = 0
    while (offset + 8 <= data.length) {
      const length = data.readUInt32BE(offset)
      const type = data.toString("latin1", offset + 4, offset + 8)
      if (offset === 8 && type !== "IHDR") throw new Error("PNG 格式不對")
      if (!STILL_PNG_CHUNKS.has(type))
        throw new Error("簽名不能是動畫或特殊 PNG")
      if (type === "IHDR") {
        headers += 1
        const width = data.readUInt32BE(offset + 8)
        const height = data.readUInt32BE(offset + 12)
        if (headers > 1 || width > MAX_SIDE || height > MAX_SIDE)
          throw new Error(`簽名圖片最大 ${MAX_SIDE} × ${MAX_SIDE}`)
      }
      if (type === "IEND") return
      offset += 12 + length
    }
    throw new Error("PNG 不完整")
  }
  if (contentType === "image/jpeg") {
    if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error("這不是 JPEG 檔")
    // Find the frame header (SOF0-SOF15, not DHT/JPG/DAC) for its size.
    for (let offset = 2; offset + 9 < data.length;) {
      if (data[offset] !== 0xff) throw new Error("JPEG 格式不對")
      const marker = data[offset + 1]
      const length = data.readUInt16BE(offset + 2)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        const height = data.readUInt16BE(offset + 5)
        const width = data.readUInt16BE(offset + 7)
        if (width > MAX_SIDE || height > MAX_SIDE)
          throw new Error(`簽名圖片最大 ${MAX_SIDE} × ${MAX_SIDE}`)
        return
      }
      offset += 2 + length
    }
    throw new Error("JPEG 不完整")
  }
  throw new Error("簽名要是 PNG 或 JPEG")
}
