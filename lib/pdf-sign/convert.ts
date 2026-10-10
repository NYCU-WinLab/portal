import { PDFDocument } from "pdf-lib"

// What an upload becomes before signing: a PDF is checked (header, pdf-lib
// can open it, page 1 reachable), a JPEG is wrapped on a page of its own
// size. Runs in the PDF worker (lib/pdf-sign/isolated.ts), never in the
// web server process.

/** Most pixels an uploaded photo may have: a 2000 px photo is 4 million,
 * a 600 dpi A4 scan about 35 million. Viewers decode it to show it. */
const MAX_PIXELS = 40_000_000

function checkPixels({ width, height }: { width: number; height: number }) {
  if (width * height > MAX_PIXELS)
    throw new Error(`圖片太大(${width} × ${height})，請縮小後再傳`)
}

/** The uploaded bytes as a PDF: PDFs are checked, images wrapped on a page. */
export async function toPdf(
  contentType: "application/pdf" | "image/jpeg",
  data: Buffer
) {
  if (contentType === "application/pdf") {
    if (!data.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new Error("這不是 PDF 檔")
    const pdf = await PDFDocument.load(data, { updateMetadata: false }).catch(
      () => {
        throw new Error("PDF 打不開，可能已損毀或有密碼")
      }
    )
    // Walking the page tree here catches cyclic or empty trees before the
    // signer sees the file.
    try {
      if (pdf.getPageCount() === 0) throw new Error("no pages")
      pdf.getPage(0)
    } catch {
      throw new Error("PDF 的頁面結構有問題")
    }
    return data
  }
  // pdf-lib reads only the JPEG's header and keeps it compressed.
  const pdf = await PDFDocument.create()
  // A copy: pdf-lib reads the underlying ArrayBuffer from offset 0, and
  // Node keeps small Buffers inside a shared pool.
  const image = await pdf.embedJpg(new Uint8Array(data)).catch(() => {
    throw new Error("JPEG 打不開")
  })
  checkPixels(image)
  const page = pdf.addPage([image.width, image.height])
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  })
  return Buffer.from(await pdf.save())
}
