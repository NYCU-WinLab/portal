// The API contract: every action an API key can reach, with its input and
// output as JSON Schema, written to contract/actions.json. Clients (the
// WinLab Mac app) generate their types from that file, so it must match the
// code: `bun run api:check` fails when it is stale, and when a change would
// break a client already built against the main branch.
//
// Inputs come from the zod schemas. Outputs have no schema of their own;
// they are read from the TypeScript type each action's run returns, as the
// JSON the API sends (Date becomes a string, undefined drops out).
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import ts from "typescript"
import { z } from "zod"

import { actions, appOfAction } from "@/lib/actions/registry"

type Schema = Record<string, unknown>
type Entry = {
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

const FILE = "contract/actions.json"
const root = process.cwd()

// The program, to read each action's output type.
const config = ts.getParsedCommandLineOfConfigFile(
  resolve(root, "tsconfig.json"),
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"))
    },
  }
)
if (!config) throw new Error("tsconfig.json not readable")
const program = ts.createProgram(
  config.fileNames.filter((f) => f.includes("/lib/actions/")),
  config.options
)
const checker = program.getTypeChecker()

/** Output type of each defineAction({ name }) in lib/actions, by name. */
function outputTypes() {
  const found = new Map<string, ts.Type>()
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.includes("/lib/actions/")) continue
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "defineAction" &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const name = node.arguments[0].properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) && p.name.getText() === "name"
        )
        if (name && ts.isStringLiteral(name.initializer)) {
          const action = checker.getTypeAtLocation(node)
          const run = checker.getPropertyOfType(action, "run")
          const signature = run
            ? checker
                .getTypeOfSymbolAtLocation(run, node)
                .getCallSignatures()[0]
            : undefined
          if (signature) {
            const returned = checker.getReturnTypeOfSignature(signature)
            found.set(
              name.initializer.text,
              checker.getAwaitedType(returned) ?? returned
            )
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return found
}

const isUndefined = (t: ts.Type) =>
  !!(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))

/** JSON Schema for the JSON a value of this type serializes to. */
function toSchema(type: ts.Type, seen: ts.Type[] = []): Schema {
  const f = type.flags
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}
  if (f & ts.TypeFlags.Null) return { type: "null" }
  if (f & ts.TypeFlags.StringLiteral)
    return { type: "string", const: (type as ts.StringLiteralType).value }
  if (f & ts.TypeFlags.NumberLiteral)
    return { type: "number", const: (type as ts.NumberLiteralType).value }
  if (f & ts.TypeFlags.BooleanLiteral)
    return { type: "boolean", const: checker.typeToString(type) === "true" }
  if (f & ts.TypeFlags.StringLike) return { type: "string" }
  if (f & ts.TypeFlags.NumberLike) return { type: "number" }
  if (f & ts.TypeFlags.BooleanLike) return { type: "boolean" }
  if (isUndefined(type)) return { type: "null" }

  if (type.isUnion()) {
    const parts = type.types.filter((t) => !isUndefined(t))
    // true | false is how TypeScript spells boolean.
    const bools = parts.filter((t) => t.flags & ts.TypeFlags.BooleanLiteral)
    const rest = parts.filter((t) => !(t.flags & ts.TypeFlags.BooleanLiteral))
    const schemas = [
      ...(bools.length === 2
        ? [{ type: "boolean" }]
        : bools.map((t) => toSchema(t, seen))),
      ...rest.map((t) => toSchema(t, seen)),
    ]
    const strings = schemas.filter(
      (s) => s.type === "string" && "const" in s && Object.keys(s).length === 2
    )
    if (strings.length === schemas.length)
      return { type: "string", enum: strings.map((s) => s.const).sort() }
    if (schemas.length === 1) return schemas[0]!
    return { anyOf: schemas }
  }

  if (seen.includes(type)) return {}
  const next = [...seen, type]
  const symbol = type.getSymbol()?.getName()
  if (symbol === "Date") return { type: "string", format: "date-time" }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference)
    return { type: "array", items: item ? toSchema(item, next) : {} }
  }
  if (f & ts.TypeFlags.Object) {
    const properties: Record<string, Schema> = {}
    const required: string[] = []
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0]
      const propertyType = declaration
        ? checker.getTypeOfSymbolAtLocation(property, declaration)
        : checker.getTypeOfSymbol(property)
      // Functions never reach JSON.
      if (propertyType.getCallSignatures().length) continue
      const optional =
        !!(property.flags & ts.SymbolFlags.Optional) ||
        (propertyType.isUnion() && propertyType.types.some(isUndefined))
      properties[property.getName()] = toSchema(propertyType, next)
      if (!optional) required.push(property.getName())
    }
    const index = checker.getIndexInfoOfType(type, ts.IndexKind.String)
    const schema: Schema = { type: "object", properties }
    if (required.length) schema.required = required
    schema.additionalProperties = index ? toSchema(index.type, next) : false
    return schema
  }
  return {}
}

/** Same key order every time, so the file diffs cleanly. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)])
    )
  return value
}

function contract(): Entry[] {
  const outputs = outputTypes()
  return actions
    .filter((a) => !a.mcpExcludedBecause && appOfAction.get(a.name))
    .map((a) => {
      const type = outputs.get(a.name)
      if (!type) throw new Error(`${a.name}: output type not found`)
      const input = sorted(z.toJSONSchema(a.input, { io: "input" })) as Schema
      const output = sorted(
        type.flags & ts.TypeFlags.Void ? { type: "null" } : toSchema(type)
      ) as Schema
      const hash = createHash("sha256")
        .update(JSON.stringify({ input, output }))
        .digest("hex")
        .slice(0, 16)
      return {
        name: a.name,
        title: a.title,
        description: a.description,
        kind: a.kind,
        app: appOfAction.get(a.name)!,
        ...(a.admin ? { admin: a.admin } : {}),
        hash,
        input,
        output,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// What a client built against the old contract would trip on.
function breaking(before: Entry[], after: Entry[]) {
  const problems: string[] = []
  const now = new Map(after.map((e) => [e.name, e]))
  for (const old of before) {
    const cur = now.get(old.name)
    if (!cur) {
      problems.push(`${old.name}: removed`)
      continue
    }
    // Inputs: a client sends what the old schema allowed.
    compare(cur.input, old.input, `${old.name} input`, problems, "input")
    // Outputs: a client reads what the old schema promised.
    compare(old.output, cur.output, `${old.name} output`, problems, "output")
  }
  return problems
}

/** Problems where `wide` accepts less than `narrow` promises: every value
 * valid for `narrow` must stay valid for `wide`. New object keys are fine:
 * clients ignore keys they do not know. */
function compare(
  wide: Schema,
  narrow: Schema,
  at: string,
  out: string[],
  side: "input" | "output"
) {
  if (!Object.keys(wide).length) return
  if (!Object.keys(narrow).length) return void out.push(`${at}: became untyped`)
  const types = (s: Schema): string[] =>
    s.anyOf
      ? (s.anyOf as Schema[]).flatMap(types)
      : s.type
        ? [s.type as string]
        : []
  const wideTypes = new Set(types(wide))
  for (const t of types(narrow))
    if (!wideTypes.has(t) && !(t === "integer" && wideTypes.has("number")))
      out.push(`${at}: ${t} no longer allowed`)
  if (wide.enum && narrow.enum)
    for (const v of narrow.enum as unknown[])
      if (!(wide.enum as unknown[]).includes(v))
        out.push(`${at}: value ${JSON.stringify(v)} no longer allowed`)
  if (wide.enum && !narrow.enum && narrow.type === "string")
    out.push(`${at}: string narrowed to an enum`)
  if (wide.type === "object" && narrow.type === "object") {
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
  if (wide.type === "array" && narrow.type === "array")
    compare(
      (wide.items ?? {}) as Schema,
      (narrow.items ?? {}) as Schema,
      `${at}[]`,
      out,
      side
    )
}

const text = JSON.stringify(contract(), null, 2) + "\n"

if (process.argv.includes("--check")) {
  const problems: string[] = []
  const committed = await readFile(FILE, "utf8").catch(() => "")
  if (committed !== text)
    problems.push(`${FILE} is stale: run bun run api:contract`)
  // Against the base branch: a breaking change needs "API-Break: <why>" in
  // a commit message on this branch, and a client release to go with it.
  const base = process.env.API_BASE_REF ?? "origin/main"
  let before: Entry[] | undefined
  try {
    before = JSON.parse(
      execFileSync("git", ["show", `${base}:${FILE}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    )
  } catch {}
  if (before) {
    const breaks = breaking(before, JSON.parse(text))
    const log = execFileSync("git", ["log", "--format=%B", `${base}..HEAD`], {
      encoding: "utf8",
    })
    if (breaks.length && !/^API-Break: \S/m.test(log))
      problems.push(
        ...breaks.map((b) => `breaking: ${b}`),
        'add a commit trailer "API-Break: <why>" once the clients are ready'
      )
  }
  if (problems.length) {
    console.error(problems.join("\n"))
    process.exit(1)
  }
  console.log(`${FILE}: up to date`)
} else {
  await writeFile(FILE, text)
  console.log(`${FILE}: ${JSON.parse(text).length} actions`)
}
