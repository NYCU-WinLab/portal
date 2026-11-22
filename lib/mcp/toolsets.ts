import type { Action } from "@/lib/actions/define"
import { actions, appOfAction } from "@/lib/actions/registry"
import type { AdminApp } from "@/lib/apps"
import { apiApps, type ApiApp } from "@/lib/api-apps"

/** Actions that belong to no app (access management) form this toolset. */
export const accessToolset = "access"

/** What a member's tool list holds when the client names nothing. */
export const defaultToolsets: readonly string[] = [
  "profile",
  "calendar",
  "leave",
  "bulletin",
  "members",
]

/** Every toolset a client may name, besides "all" and "default". */
export const toolsetNames: readonly string[] = [
  ...(Object.keys(apiApps) as ApiApp[]),
  accessToolset,
]

const toolsetOf = (action: Action) =>
  appOfAction.get(action.name) ?? accessToolset

/** The toolsets a request names: `?toolsets=a,b` or the X-Portal-Toolsets
 * header, comma separated. "all" lists everything, "default" the default
 * set; unknown names are ignored, and none left means the default. */
export function parseToolsets(raw: string | null | undefined): Set<string> {
  const names = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const chosen = new Set<string>()
  for (const name of names) {
    if (name === "all") return new Set(toolsetNames)
    if (name === "default") defaultToolsets.forEach((t) => chosen.add(t))
    else if (toolsetNames.includes(name)) chosen.add(name)
  }
  return chosen.size > 0 ? chosen : new Set(defaultToolsets)
}

/** The tools a member may call: every MCP action except the ones only
 * other apps' admins may run. Whatever toolsets are chosen, this holds. */
export const callableActions = (adminOf: ReadonlySet<AdminApp>) =>
  actions.filter(
    (a) => !a.mcpExcludedBecause && (!a.admin || adminOf.has(a.admin))
  )

/** The callable tools that tools/list shows for the chosen toolsets. */
export const listedActions = (
  adminOf: ReadonlySet<AdminApp>,
  toolsets: ReadonlySet<string>
) => callableActions(adminOf).filter((a) => toolsets.has(toolsetOf(a)))

/** The routing paragraph for the server instructions. */
export const routing = [
  `tools/list shows only the default toolsets (${defaultToolsets.join(", ")}). Every other tool stays callable by name.`,
  `To list more, connect with ?toolsets=<a,b> or the X-Portal-Toolsets header ("all" lists everything).`,
  `Toolsets: ${toolsetNames
    .map((t) =>
      t in apiApps
        ? `${t} (${apiApps[t as ApiApp]})`
        : `${t} (admins, door cards, API keys, developer apps)`
    )
    .join(", ")}.`,
].join(" ")
