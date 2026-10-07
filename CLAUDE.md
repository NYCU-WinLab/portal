@AGENTS.md

# WinLab Portal

The rewrite of portal.winlab.tw on plain Postgres. Apps move over one at a time; each move also drops what the old app carried but no longer needs (tables, columns, admin screens).

## Rules

- **Every read and write is an action** in `lib/actions/<app>.ts`, made with `defineAction` and listed in `lib/actions/registry.ts`. Pages call `runAction(action, actor, input)`; `lib/mcp/server.ts` builds the MCP tools from the same registry. Never write a separate MCP tool or a page-only query.
- **Only `lib/actions`, `lib/auth` and `lib/db` import `@/lib/db`.** `bun run actions:check` fails otherwise, and when an action is missing from the registry.
- **An action stays off MCP only with a reason** in `mcpExcludedBecause`, e.g. a signature image an agent must never supply.
- **Action fields**: `name` snake_case (the tool name), `title` in Chinese (what members call it), `description` in English for agents, `kind` query or mutation.
- **Permissions live in the action's `run`**, checked against `actor.userId`; a page and an MCP call get the same answer.
- **Schema**: edit `lib/db/*.ts`, run `bun run db:generate`, commit the SQL in `drizzle/`. Tables are snake_case plurals; the Better Auth tables keep its model names as export keys (`user`, `oauthClient`) so its adapter finds them.
- **MCP lives at `/mcp`**; discovery is under `/.well-known/` at the site root.
- **Design** comes from ui.winlab.tw (`bunx shadcn@latest add @winlab/<item>`); its DESIGN.md is the rulebook and `bun run tokens:check` enforces the token part.
- **Observability**: actions run in a span (`action <name>`, with `via` web or mcp); send ids and counts, never member content.

## Verify

`bun run typecheck && bun run lint && bun run format:check && bun run tokens:check && bun run actions:check && bun run build`. Build and run on the sandbox, not the MacBook.
