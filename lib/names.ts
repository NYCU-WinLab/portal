const compoundSurnames = [
  "歐陽",
  "司馬",
  "諸葛",
  "上官",
  "司徒",
  "夏侯",
  "張簡",
  "范姜",
]

/** 詹詠翔 → 詠翔; a name that is not 2 to 4 Han characters stays whole. */
export function givenName(name: string) {
  const full = name.trim()
  if (!/^[㐀-鿿]{2,4}$/.test(full)) return full
  const surname = compoundSurnames.some((c) => full.startsWith(c)) ? 2 : 1
  return full.slice(surname)
}
