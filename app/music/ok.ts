import { toast } from "sonner"

/** Shows an action's error as a toast; true when it worked. */
export function ok(result: { error?: string }) {
  if (result.error) toast.error(result.error)
  return !result.error
}
