import { redirect } from "next/navigation"

// The schedule moved onto the sounds page; old links land there.
export default function DoorSchedulePage() {
  redirect("/door/sounds")
}
