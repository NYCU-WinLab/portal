// Whether a new API contract breaks clients built against the old one.
// Used by scripts/api-contract.ts --check; cases in api-compat.test.ts.

export type Schema = Record<string, unknown>
export type Entry = {
  name: string
  title: string
  description: string
  kind: "query" | "mutation"
  app: string
  admin?: string
  hash: string
  input: Schema
  output: Schema
}

// What a client built against the old contract would trip on.
export function breaking(before: Entry[], after: Entry[]) {
  const problems: string[] = []
  const now = new Map(after.map((e) => [e.name, e]))
  for (const old of before) {
    const cur = now.get(old.name)
    if (!cur) {
      problems.push(`${old.name}: removed`)
      continue
    }
    // A key allowed into the old app, or a member who is not an admin,
    // would be refused.
    if (cur.app !== old.app)
      problems.push(`${old.name}: moved from ${old.app} to ${cur.app}`)
    if (cur.admin && cur.admin !== old.admin)
      problems.push(`${old.name}: now for ${cur.admin} admins only`)
    // Inputs: a client sends what the old schema allowed.
    compare(cur.input, old.input, `${old.name} input`, problems, "input")
    // Outputs: a client reads what the old schema promised.
    compare(old.output, cur.output, `${old.name} output`, problems, "output")
  }
  return problems
}

const isEmpty = (s: Schema) => Object.keys(s).length === 0
/** The alternatives a schema allows. String literals, whether written as
 * const or enum and in however many branches, become one enum branch. */
function branches(s: Schema): Schema[] {
  const all = s.anyOf ? (s.anyOf as Schema[]).flatMap(branches) : [s]
  const literal = (b: Schema) =>
    b.type === "string" &&
    Object.keys(b).every((k) => ["type", "const", "enum"].includes(k)) &&
    ("const" in b || "enum" in b)
  const values = all
    .filter(literal)
    .flatMap((b) => ("const" in b ? [b.const] : (b.enum as unknown[])))
  if (values.length < 2 && all.filter(literal).length < 2) return all
  return [
    ...all.filter((b) => !literal(b)),
    { type: "string", enum: [...new Set(values)] },
  ]
}
const kind = (s: Schema) => (s.type as string | undefined) ?? "any"

/** Problems where `wide` accepts less than `narrow` promises: every value
 * valid for `narrow` must stay valid for `wide`. For a union, each branch
 * of `narrow` must fit some branch of `wide`. New object keys are fine:
 * clients ignore keys they do not know. */
function compare(
  wide: Schema,
  narrow: Schema,
  at: string,
  out: string[],
  side: "input" | "output"
) {
  if (isEmpty(wide)) return
  if (isEmpty(narrow)) return void out.push(`${at}: became untyped`)
  const wb = branches(wide)
  const nb = branches(narrow)
  if (wb.length === 1 && nb.length === 1)
    return compareOne(wb[0]!, nb[0]!, at, out, side)
  for (const n of nb) {
    const candidates = wb.filter(
      (w) =>
        isEmpty(w) ||
        kind(w) === kind(n) ||
        (kind(n) === "integer" && kind(w) === "number")
    )
    if (!candidates.length) {
      out.push(`${at}: ${kind(n)} no longer allowed`)
      continue
    }
    // The closest branch: none of its problems if one fits.
    let closest: string[] | undefined
    for (const w of candidates) {
      const problems: string[] = []
      compareOne(w, n, at, problems, side)
      if (!closest || problems.length < closest.length) closest = problems
      if (!problems.length) break
    }
    out.push(...closest!)
  }
}

const upper = ["maxLength", "maximum", "exclusiveMaximum", "maxItems"]
const lower = ["minLength", "minimum", "exclusiveMinimum", "minItems"]

function compareOne(
  wide: Schema,
  narrow: Schema,
  at: string,
  out: string[],
  side: "input" | "output"
) {
  if (isEmpty(wide)) return
  if (isEmpty(narrow)) return void out.push(`${at}: became untyped`)
  const wk = kind(wide)
  const nk = kind(narrow)
  if (wk !== nk && !(nk === "integer" && wk === "number"))
    return void out.push(`${at}: ${nk} no longer allowed`)
  if ("const" in wide || wide.enum) {
    const allowed = "const" in wide ? [wide.const] : (wide.enum as unknown[])
    const values = narrow.enum
      ? (narrow.enum as unknown[])
      : "const" in narrow
        ? [narrow.const]
        : undefined
    if (!values) out.push(`${at}: narrowed to an enum`)
    for (const v of values ?? [])
      if (!allowed.includes(v))
        out.push(`${at}: value ${JSON.stringify(v)} no longer allowed`)
  }
  for (const k of upper)
    if (
      typeof wide[k] === "number" &&
      !(typeof narrow[k] === "number" && narrow[k] <= wide[k])
    )
      out.push(`${at}: ${k} tightened to ${wide[k]}`)
  for (const k of lower)
    if (
      typeof wide[k] === "number" &&
      !(typeof narrow[k] === "number" && narrow[k] >= wide[k])
    )
      out.push(`${at}: ${k} tightened to ${wide[k]}`)
  for (const k of ["pattern", "format"])
    if (wide[k] !== undefined && wide[k] !== narrow[k])
      out.push(`${at}: ${k} changed`)
  if (wk === "object") {
    const wp = (wide.properties ?? {}) as Record<string, Schema>
    const np = (narrow.properties ?? {}) as Record<string, Schema>
    const wr = new Set((wide.required ?? []) as string[])
    const nr = new Set((narrow.required ?? []) as string[])
    for (const key of wr)
      if (!nr.has(key))
        out.push(
          side === "input"
            ? `${at}.${key}: now required`
            : `${at}.${key}: may be missing`
        )
    for (const [key, schema] of Object.entries(np))
      if (wp[key]) compare(wp[key], schema, `${at}.${key}`, out, side)
  }
  if (wk === "array")
    compare(
      (wide.items ?? {}) as Schema,
      (narrow.items ?? {}) as Schema,
      `${at}[]`,
      out,
      side
    )
}
