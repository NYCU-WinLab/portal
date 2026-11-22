import { fromJSONSchema, type ZodType } from "zod"
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server"

import contract from "@/contract/mcp-outputs.json"

type Json = Record<string, unknown>

// contract/mcp-outputs.json is generated from each action's real return type
// (scripts/api-contract.ts), so the output schema MCP serves cannot drift
// from what the action returns. Imported, not read: the image has no
// contract folder.
const outputs = new Map(Object.entries(contract as Record<string, Json>))

/** MCP wants an object at the root. A union of objects is one: say so.
 * Other roots (an array, an object or null) go out as they are; the SDK
 * wraps them as { result } for 2025-era clients. */
function rooted(schema: Json): Json {
  const branches = schema.anyOf
  if (
    schema.type === undefined &&
    Array.isArray(branches) &&
    branches.every((b) => (b as Json).type === "object")
  )
    return { ...schema, type: "object" }
  return schema
}

/** The action's output as a schema MCP can serve and validate with, or
 * undefined when the contract has none for this name. */
export function servedOutput(name: string): StandardSchemaWithJSON | undefined {
  const raw = outputs.get(name)
  if (!raw) return undefined
  const json = rooted(raw)
  const zod: ZodType = fromJSONSchema(raw as never)
  const std = zod["~standard"]
  return {
    "~standard": {
      ...std,
      jsonSchema: { input: () => json, output: () => json },
    },
  } as StandardSchemaWithJSON
}

/** The JSON a client receives: Dates are strings, undefined drops out. */
export const asJson = (value: unknown): unknown =>
  value === undefined ? null : JSON.parse(JSON.stringify(value))
