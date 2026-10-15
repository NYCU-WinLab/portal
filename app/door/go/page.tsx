import { DoorPage } from "../door-page"

export const dynamic = "force-dynamic"

// What the home-screen icon launches (the manifest's start_url): one tap on
// the icon is one open. A link someone follows goes to /door, which waits
// for a press.
export default function DoorGo() {
  return <DoorPage autoOpen />
}
