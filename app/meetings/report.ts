import { toast } from "sonner"

/** Toasts a server action's outcome; throws on error so a dialog stays open
 * with the input kept. */
export async function report(
  pending: Promise<{ error?: string }>,
  success: string
) {
  const { error } = await pending
  if (error) {
    toast.error(error)
    throw new Error(error)
  }
  toast.success(success)
}
