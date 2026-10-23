// Field kinds on a document sent round for signatures, as the page shows
// them, and the size a new one starts at (fractions of the page).
export const fieldKinds = [
  { category: "signature", label: "簽名", width: 0.2, height: 0.08 },
  { category: "id_number", label: "身分證字號", width: 0.2, height: 0.04 },
  { category: "phone", label: "電話", width: 0.2, height: 0.04 },
  { category: "contact_address", label: "通訊地址", width: 0.35, height: 0.04 },
  {
    category: "household_address",
    label: "戶籍地址",
    width: 0.35,
    height: 0.04,
  },
  { category: "other", label: "其他", width: 0.3, height: 0.04 },
] as const

export type FieldCategory = (typeof fieldKinds)[number]["category"]

export const fieldLabel = (category: string, label?: string | null) =>
  label || fieldKinds.find((kind) => kind.category === category)?.label || ""

/** A stroke and fill per signer, so each one's boxes read as a set. */
const tones = [
  "stroke-primary fill-primary/10",
  "stroke-success fill-success/10",
  "stroke-warning fill-warning/10",
  "stroke-destructive fill-destructive/10",
  "stroke-foreground fill-foreground/10",
]

export function signerTone(signerId: string | null) {
  if (!signerId) return "stroke-muted-foreground fill-muted/40"
  let hash = 0
  for (const char of signerId) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return tones[Math.abs(hash) % tones.length]
}
