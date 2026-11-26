import type { Action } from "@/lib/actions/define"
import { actions, appOfAction } from "@/lib/actions/registry"
import type { AdminApp } from "@/lib/apps"
import { apiApps, type ApiApp } from "@/lib/api-apps"

/** Actions that belong to no app (access management) form this toolset. */
export const accessToolset = "access"

/** Every toolset a client may name, besides "all". */
export const toolsetNames: readonly string[] = [
  ...(Object.keys(apiApps) as ApiApp[]),
  accessToolset,
]

const toolsetOf = (action: Action) =>
  appOfAction.get(action.name) ?? accessToolset

/** The toolsets a request names: `?toolsets=a,b` or the X-Portal-Toolsets
 * header, comma separated. Naming toolsets only narrows tools/list: "all",
 * no names, or only unknown names list everything. */
export function parseToolsets(raw: string | null | undefined): Set<string> {
  const names = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const chosen = new Set<string>()
  for (const name of names) {
    if (name === "all") return new Set(toolsetNames)
    if (toolsetNames.includes(name)) chosen.add(name)
  }
  return chosen.size > 0 ? chosen : new Set(toolsetNames)
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
  `tools/list shows every tool unless you name toolsets. For a shorter list, connect with ?toolsets=<a,b> or the X-Portal-Toolsets header; every tool you may run stays callable by name either way.`,
  `Toolsets: ${toolsetNames
    .map((t) =>
      t in apiApps
        ? `${t} (${apiApps[t as ApiApp]})`
        : `${t} (admins, door cards, API keys, developer apps, account-application review)`
    )
    .join(", ")}.`,
].join(" ")
