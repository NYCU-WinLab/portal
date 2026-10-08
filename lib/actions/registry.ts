import type { Action } from "@/lib/actions/define"
import { createLeave, deleteLeave, listLeaves } from "@/lib/actions/leave"
import { getProfile } from "@/lib/actions/profile"
import { whoami } from "@/lib/actions/users"

/** Every action, in the order MCP lists them. */
export const actions: Action[] = [
  whoami,
  getProfile,
  listLeaves,
  createLeave,
  deleteLeave,
]
