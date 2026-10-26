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
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import ts from "typescript"
import { z } from "zod"

import { breaking, type Entry, type Schema } from "./api-compat"

import { actions, appOfAction, backgroundChanges } from "@/lib/actions/registry"

const FILE = "contract/actions.json"

/** TypeScript files under these folders. */
async function sources(dirs: string[]): Promise<string[]> {
  const out: string[] = []
  for (const dir of dirs)
    for (const entry of await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    }))
      if (entry.isFile() && /\.tsx?$/.test(entry.name))
        out.push(join(entry.parentPath, entry.name))
  return out
}
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
// noUncheckedIndexedAccess only here: `const [row] = rows` may be
// undefined at runtime, and the contract must say so.
const program = ts.createProgram(
  config.fileNames.filter((f) => f.includes("/lib/actions/")),
  { ...config.options, noUncheckedIndexedAccess: true }
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
    // String literals become one enum, beside null or anything else.
    const isConst = (s: Schema) =>
      s.type === "string" && "const" in s && Object.keys(s).length === 2
    const consts = [...new Set(schemas.filter(isConst).map((s) => s.const))]
    const all = [
      ...schemas.filter((s) => !isConst(s)),
      ...(consts.length
        ? [{ type: "string", enum: (consts as string[]).sort() }]
        : []),
    ]
    // Same shape twice (two variants that serialize alike) counts once.
    const unique = [
      ...new Map(all.map((s) => [JSON.stringify(sorted(s)), s])).values(),
    ].sort((a, b) =>
      JSON.stringify(sorted(a)).localeCompare(JSON.stringify(sorted(b)))
    )
    if (unique.length === 1) return unique[0]!
    return { anyOf: unique }
  }

  // A branded primitive (string & { brand }) is the primitive.
  if (type.isIntersection()) {
    const primitive = type.types.find(
      (t) =>
        t.flags &
        (ts.TypeFlags.StringLike |
          ts.TypeFlags.NumberLike |
          ts.TypeFlags.BooleanLike)
    )
    if (primitive) return toSchema(primitive, seen)
  }

  if (seen.includes(type)) return {}
  const next = [...seen, type]
  const symbol = type.getSymbol()?.getName()
  if (symbol === "Date") return { type: "string", format: "date-time" }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference)
    return { type: "array", items: item ? toSchema(item, next) : {} }
  }
  // Objects, and intersections of objects (A & B): the merged properties.
  if (f & ts.TypeFlags.Object || type.isIntersection()) {
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
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  let baseFound = true
  try {
    git("rev-parse", "--verify", `${base}^{commit}`)
  } catch {
    baseFound = false
    // A shallow clone has no base to compare with: say so, and fail in CI.
    const message = `cannot find ${base}; breaking changes not checked`
    if (process.env.CI) problems.push(message)
    else console.warn(message)
  }
  // No contract on the base yet (the change that adds it): nothing to break.
  if (baseFound)
    try {
      before = JSON.parse(git("show", `${base}:${FILE}`))
    } catch {}
  if (before) {
    const breaks = breaking(before, JSON.parse(text))
    const log = git("log", "--format=%B", `${base}..HEAD`)
    if (breaks.length && !/^API-Break: \S/m.test(log))
      problems.push(
        ...breaks.map((b) => `breaking: ${b}`),
        'add a commit trailer "API-Break: <why>" once the clients are ready'
      )
  }
  // Every change announced outside an action must say which app it is in,
  // or API keys would miss it (or see what they should not).
  for (const path of await sources(["lib", "app"])) {
    const text = await readFile(path, "utf8")
    for (const m of text.matchAll(/announceChange\(\s*([`"])([^`"$]*)/g)) {
      const name = m[2]!.startsWith("player_") ? "player_*" : m[2]!
      // progress:<topic> never reaches API keys (appOfChange says null).
      if (name.startsWith("progress:")) continue
      if (
        name &&
        !Object.hasOwn(backgroundChanges, name) &&
        !appOfAction.has(name)
      )
        problems.push(
          `${path}: announceChange("${name}") is not in backgroundChanges`
        )
    }
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
