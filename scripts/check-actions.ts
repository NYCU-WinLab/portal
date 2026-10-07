// Keeps pages and MCP in step. Every action in lib/actions must be in the
// registry (MCP builds its tools from it), each must be well-formed, and
// only lib/actions, lib/auth and lib/db may touch the database, so nothing
// reaches it around an action.
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { defined } from "@/lib/actions/define"
import { actions } from "@/lib/actions/registry"

const problems: string[] = []

// Load every action module so defineAction records its name.
for (const file of await readdir("lib/actions")) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue
  if (file === "define.ts" || file === "registry.ts") continue
  await import(`@/lib/actions/${file}`)
}

const registered = new Set(actions.map((action) => action.name))
for (const name of defined) {
  if (!registered.has(name))
    problems.push(`${name}: not in lib/actions/registry.ts`)
}
if (registered.size !== actions.length) problems.push("duplicate action names")

for (const action of actions) {
  if (!/^[a-z][a-z0-9_]*$/.test(action.name))
    problems.push(`${action.name}: name must be snake_case`)
  if (!/\p{Script=Han}/u.test(action.title))
    problems.push(`${action.name}: title must be Chinese, as members call it`)
  if (action.description.length < 40)
    problems.push(`${action.name}: description too short for an agent`)
  if (
    action.mcpExcludedBecause !== undefined &&
    !action.mcpExcludedBecause.trim()
  )
    problems.push(`${action.name}: mcpExcludedBecause needs a reason`)
}

async function* sources(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (/\.tsx?$/.test(entry.name)) yield path
  }
}
const allowed = ["lib/actions/", "lib/auth/", "lib/db/"]
for (const root of ["app", "components", "lib"]) {
  for await (const path of sources(root)) {
    if (allowed.some((prefix) => path.startsWith(prefix))) continue
    if (/from "@\/lib\/db(\/[\w-]+)?"/.test(await readFile(path, "utf8")))
      problems.push(`${path}: reads the database outside lib/actions`)
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}
console.log(`${actions.length} actions, all on MCP or excused`)
