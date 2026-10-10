import { inflateSync } from "node:zlib"

// A small PDF reader and incremental writer for files with classic xref
// tables: the ones pdf-lib writes when we normalize an upload, plus our own
// increments on top. It reads only dictionaries and arrays (never stream
// contents) and writes new object versions after the last %%EOF, so every
// earlier byte, and every earlier signature, stays as it was.

export type PdfValue =
  | { t: "name"; v: string }
  | { t: "num"; v: string }
  | { t: "ref"; n: number; g: number }
  | { t: "str"; raw: string }
  | { t: "word"; v: "true" | "false" | "null" }
  | { t: "array"; items: PdfValue[] }
  | { t: "dict"; entries: Map<string, PdfValue> }

export const name = (v: string): PdfValue => ({ t: "name", v })
export const num = (v: number): PdfValue => ({ t: "num", v: String(v) })
export const ref = (n: number): PdfValue => ({ t: "ref", n, g: 0 })
export const array = (...items: PdfValue[]): PdfValue => ({ t: "array", items })
export const dict = (entries: Record<string, PdfValue>): PdfValue => ({
  t: "dict",
  entries: new Map(Object.entries(entries)),
})

/** A text string: plain when ASCII, UTF-16BE with a byte-order mark otherwise. */
export function text(value: string): PdfValue {
  if (/^[\x20-\x7e]*$/.test(value))
    return { t: "str", raw: `(${value.replace(/[\\()]/g, "\\$&")})` }
  let hex = "FEFF"
  for (let i = 0; i < value.length; i++)
    hex += value.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase()
  return { t: "str", raw: `<${hex}>` }
}

export function serialize(value: PdfValue): string {
  switch (value.t) {
    case "name":
      return `/${value.v}`
    case "num":
      return value.v
    case "ref":
      return `${value.n} ${value.g} R`
    case "str":
      return value.raw
    case "word":
      return value.v
    case "array":
      return `[${value.items.map(serialize).join(" ")}]`
    case "dict":
      return `<<${[...value.entries].map(([key, item]) => `/${key} ${serialize(item)}`).join(" ")}>>`
  }
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIMITERS = new Set([..."()<>[]{}/%"].map((c) => c.charCodeAt(0)))

class Lexer {
  constructor(
    private s: string,
    public pos: number
  ) {}

  skip() {
    while (this.pos < this.s.length) {
      const code = this.s.charCodeAt(this.pos)
      if (WHITESPACE.has(code)) this.pos++
      else if (code === 0x25) {
        while (this.pos < this.s.length && !"\r\n".includes(this.s[this.pos]))
          this.pos++
      } else break
    }
  }

  /** The next bare word or number, without moving past it. */
  peekWord() {
    this.skip()
    let end = this.pos
    while (
      end < this.s.length &&
      !WHITESPACE.has(this.s.charCodeAt(end)) &&
      !DELIMITERS.has(this.s.charCodeAt(end))
    )
      end++
    return this.s.slice(this.pos, end)
  }

  word() {
    const word = this.peekWord()
    this.pos += word.length
    return word
  }

  expect(word: string) {
    const got = this.word()
    if (got !== word) throw new Error(`PDF: expected ${word}, got ${got}`)
  }

  value(): PdfValue {
    this.skip()
    const s = this.s
    const c = s[this.pos]
    if (c === "/") {
      this.pos++
      return { t: "name", v: this.word() }
    }
    if (c === "<" && s[this.pos + 1] === "<") {
      this.pos += 2
      const entries = new Map<string, PdfValue>()
      for (;;) {
        this.skip()
        if (s.startsWith(">>", this.pos)) {
          this.pos += 2
          return { t: "dict", entries }
        }
        const key = this.value()
        if (key.t !== "name") throw new Error("PDF: dictionary key not a name")
        entries.set(key.v, this.value())
      }
    }
    if (c === "<") {
      const end = s.indexOf(">", this.pos)
      const raw = s.slice(this.pos, end + 1)
      this.pos = end + 1
      return { t: "str", raw }
    }
    if (c === "(") {
      const start = this.pos
      let depth = 0
      for (; this.pos < s.length; this.pos++) {
        if (s[this.pos] === "\\") this.pos++
        else if (s[this.pos] === "(") depth++
        else if (s[this.pos] === ")" && --depth === 0) break
      }
      this.pos++
      return { t: "str", raw: s.slice(start, this.pos) }
    }
    if (c === "[") {
      this.pos++
      const items: PdfValue[] = []
      for (;;) {
        this.skip()
        if (s[this.pos] === "]") {
          this.pos++
          return { t: "array", items }
        }
        items.push(this.value())
      }
    }
    const word = this.word()
    if (word === "true" || word === "false" || word === "null")
      return { t: "word", v: word }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word))
      throw new Error(`PDF: unexpected ${JSON.stringify(word.slice(0, 20))}`)
    // "n g R" is a reference; look ahead without committing.
    if (/^\d+$/.test(word)) {
      const save = this.pos
      const generation = this.word()
      if (/^\d+$/.test(generation) && this.word() === "R")
        return { t: "ref", n: Number(word), g: Number(generation) }
      this.pos = save
    }
    return { t: "num", v: word }
  }
}

export type Pdf = {
  bytes: Uint8Array
  /** latin1 view of bytes: one char per byte, so offsets match. */
  s: string
  offsets: Map<number, number>
  /** Objects inside object streams: [stream object number, index]. */
  compressed: Map<number, [number, number]>
  trailer: Map<string, PdfValue>
  /** Where the newest xref section starts. */
  startxref: number
  size: number
  /** The newest section is a cross-reference stream (PDF 1.5 and later),
   * so increments are written the same way. */
  xrefStream: boolean
  objectStreams: Map<number, { s: string; first: number; offsets: number[] }>
}

/** Most bytes a stream may inflate to: xref and object streams are small,
 * and the cap keeps a compression bomb from filling memory. */
const MAX_INFLATED = 32 * 1024 * 1024

const numberOf = (value: PdfValue | undefined) =>
  value?.t === "num" ? Number(value.v) : undefined

/** A stream object at offset: its dictionary and raw (still encoded) data. */
function streamAt(
  pdf: Pick<Pdf, "s" | "bytes"> & Partial<Pdf>,
  offset: number
) {
  const lexer = new Lexer(pdf.s, offset)
  lexer.word()
  lexer.word()
  lexer.expect("obj")
  const dict = lexer.value()
  if (dict.t !== "dict") throw new Error("PDF: stream without a dictionary")
  lexer.skip()
  if (!pdf.s.startsWith("stream", lexer.pos)) throw new Error("PDF: no stream")
  let start = lexer.pos + 6
  if (pdf.s[start] === "\r") start++
  if (pdf.s[start] === "\n") start++
  let lengthValue = dict.entries.get("Length")
  if (lengthValue?.t === "ref" && pdf.offsets)
    lengthValue = getObject(pdf as Pdf, lengthValue.n)
  const length = numberOf(lengthValue)
  if (length === undefined || length < 0 || start + length > pdf.bytes.length)
    throw new Error("PDF: bad stream length")
  return { dict: dict.entries, data: pdf.bytes.subarray(start, start + length) }
}

/** Undoes FlateDecode and the PNG predictors that xref streams use. */
function decode(dict: Map<string, PdfValue>, data: Uint8Array) {
  const filter = dict.get("Filter")
  const filters = filter?.t === "array" ? filter.items : filter ? [filter] : []
  if (filters.length === 0) return data
  if (
    filters.length !== 1 ||
    filters[0].t !== "name" ||
    filters[0].v !== "FlateDecode"
  )
    throw new Error("PDF: unsupported stream filter")
  let out = new Uint8Array(inflateSync(data, { maxOutputLength: MAX_INFLATED }))
  const parmsValue = dict.get("DecodeParms")
  const parms =
    parmsValue?.t === "dict"
      ? parmsValue.entries
      : parmsValue?.t === "array" && parmsValue.items[0]?.t === "dict"
        ? parmsValue.items[0].entries
        : undefined
  const predictor = numberOf(parms?.get("Predictor")) ?? 1
  if (predictor >= 10) {
    const columns = numberOf(parms?.get("Columns")) ?? 1
    const colors = numberOf(parms?.get("Colors")) ?? 1
    const bits = numberOf(parms?.get("BitsPerComponent")) ?? 8
    const bpp = Math.max(1, Math.ceil((colors * bits) / 8))
    const rowLength = Math.ceil((columns * colors * bits) / 8)
    const rows = Math.floor(out.length / (rowLength + 1))
    const result = new Uint8Array(rows * rowLength)
    for (let r = 0; r < rows; r++) {
      const type = out[r * (rowLength + 1)]
      const row = out.subarray(
        r * (rowLength + 1) + 1,
        (r + 1) * (rowLength + 1)
      )
      const at = r * rowLength
      for (let i = 0; i < rowLength; i++) {
        const left = i >= bpp ? result[at + i - bpp] : 0
        const up = r > 0 ? result[at - rowLength + i] : 0
        const upLeft = r > 0 && i >= bpp ? result[at - rowLength + i - bpp] : 0
        let value = row[i]
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
        result[at + i] = value & 0xff
      }
    }
    out = result
  } else if (predictor !== 1) throw new Error("PDF: unsupported predictor")
  return out
}

export function parsePdf(bytes: Uint8Array): Pdf {
  const s = Buffer.from(bytes).toString("latin1")
  const at = s.lastIndexOf("startxref")
  if (at < 0) throw new Error("PDF: no startxref")
  const startxref = Number(new Lexer(s, at + 9).word())
  if (!Number.isInteger(startxref) || startxref < 0 || startxref >= s.length)
    throw new Error("PDF: bad startxref")
  const offsets = new Map<number, number>()
  const compressed = new Map<number, [number, number]>()
  // Newer sections come first; the first entry seen for a number wins,
  // free ones included.
  const known = new Set<number>()
  let trailer: Map<string, PdfValue> | null = null
  let xrefStream = false
  const seen = new Set<number>()

  const readXrefStream = (offset: number) => {
    const { dict, data: raw } = streamAt({ s, bytes }, offset)
    const data = decode(dict, raw)
    const w = dict.get("W")
    const widths =
      w?.t === "array" ? w.items.map((item) => numberOf(item) ?? 0) : []
    if (widths.length !== 3 || widths.some((n) => n < 0 || n > 8))
      throw new Error("PDF: bad xref stream /W")
    const indexValue = dict.get("Index")
    const index =
      indexValue?.t === "array"
        ? indexValue.items.map((item) => numberOf(item) ?? 0)
        : [0, numberOf(dict.get("Size")) ?? 0]
    const entry = widths[0] + widths[1] + widths[2]
    let at = 0
    const field = (width: number, fallback: number) => {
      if (width === 0) return fallback
      let value = 0
      for (let i = 0; i < width; i++) value = value * 256 + data[at++]
      return value
    }
    // Every listed entry needs its bytes: no counts beyond the data, and
    // no zero-width entries that would loop without reading anything.
    const listed = index.reduce((sum, n, i) => (i % 2 ? sum + n : sum), 0)
    if (entry === 0 || listed * entry > data.length)
      throw new Error("PDF: xref stream /Index beyond its data")
    for (let k = 0; k + 1 < index.length; k += 2) {
      for (let i = 0; i < index[k + 1]; i++) {
        if (at + entry > data.length) throw new Error("PDF: xref stream short")
        const type = field(widths[0], 1)
        const second = field(widths[1], 0)
        const third = field(widths[2], 0)
        const n = index[k] + i
        if (known.has(n)) continue
        known.add(n)
        if (type === 1) offsets.set(n, second)
        else if (type === 2) compressed.set(n, [second, third])
      }
    }
    return dict
  }

  for (let section: number | null = startxref; section !== null;) {
    if (seen.has(section)) throw new Error("PDF: xref loop")
    seen.add(section)
    let sectionTrailer: Map<string, PdfValue>
    const lexer: Lexer = new Lexer(s, section)
    if (lexer.peekWord() === "xref") {
      lexer.word()
      for (;;) {
        const first = lexer.peekWord()
        if (first === "trailer") break
        const start = Number(lexer.word())
        const count = Number(lexer.word())
        if (!Number.isInteger(start) || !Number.isInteger(count) || count < 0)
          throw new Error("PDF: bad xref section")
        lexer.skip()
        for (let i = 0; i < count; i++) {
          const entry = s.slice(lexer.pos, lexer.pos + 20)
          const [offset, , kind] = entry.trim().split(/\s+/)
          if (!known.has(start + i)) {
            known.add(start + i)
            if (kind === "n") offsets.set(start + i, Number(offset))
          }
          lexer.pos += 20
          lexer.skip()
        }
      }
      lexer.expect("trailer")
      const dictValue: PdfValue = lexer.value()
      if (dictValue.t !== "dict") throw new Error("PDF: bad trailer")
      sectionTrailer = dictValue.entries
      // A hybrid file lists its compressed objects in a stream too.
      const hidden = numberOf(sectionTrailer.get("XRefStm"))
      if (hidden !== undefined) readXrefStream(hidden)
    } else {
      sectionTrailer = readXrefStream(section)
      if (trailer === null) xrefStream = true
    }
    trailer ??= sectionTrailer
    const prev = numberOf(sectionTrailer.get("Prev"))
    section = prev ?? null
  }
  const size = numberOf(trailer!.get("Size"))
  return {
    bytes,
    s,
    offsets,
    compressed,
    trailer: trailer!,
    startxref,
    size: size ?? Math.max(0, ...known) + 1,
    xrefStream,
    objectStreams: new Map(),
  }
}

/** A page object by number, with the MediaBox it or its parents give. */
export function pageAt(pdf: Pdf, n: number) {
  const dict = getDict(pdf, ref(n))
  const type = dict.get("Type")
  if (type?.t !== "name" || type.v !== "Page")
    throw new Error(`PDF: object ${n} is not a page`)
  let mediaBox = resolve(pdf, dict.get("MediaBox"))
  let parent = dict.get("Parent")
  for (let depth = 0; !mediaBox && parent && depth < 32; depth++) {
    const up = getDict(pdf, parent)
    mediaBox = resolve(pdf, up.get("MediaBox"))
    parent = up.get("Parent")
  }
  return {
    n,
    dict,
    mediaBox:
      mediaBox?.t === "array"
        ? mediaBox.items.map((item) => Number((item as { v: string }).v))
        : [0, 0, 612, 792],
  }
}

export function getObject(pdf: Pdf, n: number): PdfValue {
  const offset = pdf.offsets.get(n)
  if (offset !== undefined) {
    const lexer = new Lexer(pdf.s, offset)
    if (Number(lexer.word()) !== n)
      throw new Error(`PDF: object ${n} misplaced`)
    lexer.word()
    lexer.expect("obj")
    return lexer.value()
  }
  const inStream = pdf.compressed.get(n)
  if (!inStream) throw new Error(`PDF: object ${n} missing`)
  const [streamN, index] = inStream
  let objects = pdf.objectStreams.get(streamN)
  if (!objects) {
    const streamOffset = pdf.offsets.get(streamN)
    if (streamOffset === undefined)
      throw new Error(`PDF: object stream ${streamN} missing`)
    const { dict, data } = streamAt(pdf, streamOffset)
    const text = Buffer.from(decode(dict, data)).toString("latin1")
    const count = numberOf(dict.get("N")) ?? 0
    const first = numberOf(dict.get("First")) ?? 0
    // Each object needs at least "n o " in the header.
    if (count < 0 || first < 0 || first > text.length || count * 4 > first)
      throw new Error(`PDF: object stream ${streamN} header too short`)
    const header = new Lexer(text, 0)
    const list: number[] = []
    for (let i = 0; i < count; i++) {
      header.word()
      list.push(Number(header.word()))
    }
    objects = { s: text, first, offsets: list }
    pdf.objectStreams.set(streamN, objects)
  }
  const at = objects.offsets[index]
  if (at === undefined) throw new Error(`PDF: object ${n} missing`)
  return new Lexer(objects.s, objects.first + at).value()
}

export function resolve(
  pdf: Pdf,
  value: PdfValue | undefined
): PdfValue | undefined {
  return value?.t === "ref" ? getObject(pdf, value.n) : value
}

export function getDict(pdf: Pdf, value: PdfValue | undefined) {
  const resolved = resolve(pdf, value)
  if (resolved?.t !== "dict") throw new Error("PDF: expected a dictionary")
  return resolved.entries
}

export const rootRef = (pdf: Pdf) => {
  const root = pdf.trailer.get("Root")
  if (root?.t !== "ref") throw new Error("PDF: no /Root")
  return root.n
}

/** The first page's object number, and its MediaBox (inherited if need be). */
export function firstPage(pdf: Pdf) {
  let node = getDict(pdf, getDict(pdf, ref(rootRef(pdf))).get("Pages"))
  let mediaBox = resolve(pdf, node.get("MediaBox"))
  // At most 32 levels and never the same node twice: a cyclic tree fails
  // instead of spinning.
  const visited = new Set<number>()
  for (let depth = 0; ; depth++) {
    if (depth > 32) throw new Error("PDF: page tree too deep")
    const kids = resolve(pdf, node.get("Kids"))
    const first = kids?.t === "array" ? kids.items[0] : undefined
    if (first?.t !== "ref") throw new Error("PDF: no pages")
    if (visited.has(first.n)) throw new Error("PDF: page tree loops")
    visited.add(first.n)
    const child = getDict(pdf, first)
    mediaBox = resolve(pdf, child.get("MediaBox")) ?? mediaBox
    if (
      child.get("Type")?.t === "name" &&
      (child.get("Type") as { v: string }).v === "Page"
    )
      return {
        n: first.n,
        dict: child,
        mediaBox:
          mediaBox?.t === "array"
            ? mediaBox.items.map((item) => Number((item as { v: string }).v))
            : [0, 0, 612, 792],
      }
    node = child
  }
}

/** New objects and new versions of old ones, written after the file. */
export class Increment {
  private objects = new Map<number, Uint8Array>()
  private next: number

  constructor(private pdf: Pdf) {
    this.next = pdf.size
  }

  reserve() {
    return this.next++
  }

  /** Sets object n to a value, or to a stream when data is given. */
  set(n: number, value: PdfValue, data?: Uint8Array) {
    if (data) {
      if (value.t !== "dict") throw new Error("PDF: stream needs a dictionary")
      value.entries.set("Length", num(data.length))
    }
    const head = Buffer.from(`${n} 0 obj\n${serialize(value)}\n`, "latin1")
    const body = data
      ? Buffer.concat([
          head.subarray(0, head.length - 1),
          Buffer.from("\nstream\n", "latin1"),
          data,
          Buffer.from("\nendstream\n", "latin1"),
        ])
      : head
    this.objects.set(
      n,
      Buffer.concat([body, Buffer.from("endobj\n", "latin1")])
    )
  }

  add(value: PdfValue, data?: Uint8Array) {
    const n = this.reserve()
    this.set(n, value, data)
    return n
  }

  /** The whole file with this increment appended. */
  build(): Uint8Array {
    const base = Buffer.from(this.pdf.bytes)
    const parts: Buffer[] = [base]
    let offset = base.length
    if (base[base.length - 1] !== 0x0a) {
      parts.push(Buffer.from("\n"))
      offset += 1
    }
    const positions = new Map<number, number>()
    for (const [n, body] of [...this.objects].sort((a, b) => a[0] - b[0])) {
      positions.set(n, offset)
      parts.push(Buffer.from(body))
      offset += body.length
    }
    const xrefAt = offset
    const trailer = new Map(this.pdf.trailer)
    for (const key of [
      "Prev",
      "XRefStm",
      "Type",
      "W",
      "Index",
      "Filter",
      "DecodeParms",
      "Length",
      "Size",
    ])
      trailer.delete(key)
    trailer.set("Prev", num(this.pdf.startxref))
    if (this.pdf.xrefStream) {
      // A file indexed by an xref stream gets its update the same way:
      // one stream object listing the new objects and itself.
      const self = this.next++
      positions.set(self, xrefAt)
      const entries = [...positions].sort((a, b) => a[0] - b[0])
      const data = Buffer.alloc(entries.length * 7)
      entries.forEach(([, position], i) => {
        data[i * 7] = 1
        data.writeUInt32BE(position, i * 7 + 1)
      })
      trailer.set("Type", name("XRef"))
      trailer.set("Size", num(this.next))
      trailer.set("W", array(num(1), num(4), num(2)))
      trailer.set("Index", array(...entries.flatMap(([n]) => [num(n), num(1)])))
      trailer.set("Length", num(data.length))
      parts.push(
        Buffer.from(
          `${self} 0 obj\n${serialize({ t: "dict", entries: trailer })}\nstream\n`,
          "latin1"
        ),
        data,
        Buffer.from(
          `\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`,
          "latin1"
        )
      )
    } else {
      let xref = "xref\n"
      for (const [n, position] of positions)
        xref += `${n} 1\n${String(position).padStart(10, "0")} 00000 n\r\n`
      trailer.set("Size", num(this.next))
      xref += `trailer\n${serialize({ t: "dict", entries: trailer })}\nstartxref\n${xrefAt}\n%%EOF\n`
      parts.push(Buffer.from(xref, "latin1"))
    }
    return new Uint8Array(Buffer.concat(parts))
  }
}
