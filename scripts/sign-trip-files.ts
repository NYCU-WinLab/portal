// Signs trip files uploaded before the portal signed uploads, once. Run
// where the app runs, with its environment: bun scripts/sign-trip-files.ts
import { signLegacyTripFiles } from "@/lib/actions/trip"

const count = await signLegacyTripFiles((line) => console.log(line))
console.log(`signed ${count} files`)
process.exit(0)
