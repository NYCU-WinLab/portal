import { DoorPage } from "./door-page"

export const dynamic = "force-dynamic"

export default function Door() {
  return <DoorPage autoOpen={false} />
}
