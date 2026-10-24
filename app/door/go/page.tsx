import { redirect } from "next/navigation"

// Old home-screen icons still launch /door/go. It no longer opens anything:
// Android can open a /door/go link from a chat app inside the installed app,
// so the door opens only on a press (#49).
export default function DoorGo() {
  redirect("/door")
}
