import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFName,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib"

// Before signing, an upload is saved again by pdf-lib with plain xref
// tables and no object streams, the only shape our incremental writer has
// to read. The signer's appearance (their handwritten signature, scaled
// into a corner of page 1) is added here as a form XObject for the
// signature widget to show.

export type Corner = "tl" | "tr" | "bl" | "br"

const WIDTH = 140
const MAX_HEIGHT = 56
const MARGIN = 24

export async function preparePdf(
  input: Uint8Array,
  appearance: { image: Uint8Array; contentType: string; corner: Corner } | null
) {
  const pdf = await PDFDocument.load(input, { updateMetadata: false })
  let widget: { appearance: number; rect: number[] } | null = null
  if (appearance) {
    const image =
      appearance.contentType === "image/png"
        ? await pdf.embedPng(appearance.image)
        : await pdf.embedJpg(appearance.image)
    let width = WIDTH
    let height = (WIDTH * image.height) / image.width
    if (height > MAX_HEIGHT) {
      width = (width * MAX_HEIGHT) / height
      height = MAX_HEIGHT
    }
    const page = pdf.getPage(0)
    const box = page.getMediaBox()
    const left = appearance.corner.endsWith("l")
    const top = appearance.corner.startsWith("t")
    const x = left ? box.x + MARGIN : box.x + box.width - MARGIN - width
    const y = top ? box.y + box.height - MARGIN - height : box.y + MARGIN
    const form = pdf.context.formXObject(
      [
        pushGraphicsState(),
        concatTransformationMatrix(width, 0, 0, height, 0, 0),
        drawObject("Im0"),
        popGraphicsState(),
      ],
      {
        BBox: [0, 0, width, height],
        Resources: { XObject: { Im0: image.ref } },
      }
    )
    form.dict.set(PDFName.of("Subtype"), PDFName.of("Form"))
    const formRef = pdf.context.register(form)
    widget = {
      appearance: formRef.objectNumber,
      rect: [x, y, x + width, y + height].map((n) => Math.round(n * 100) / 100),
    }
  }
  const bytes = await pdf.save({
    useObjectStreams: false,
    addDefaultPage: false,
  })
  return { bytes, widget }
}
