import { currentCrl } from "@/lib/actions/signing-keys"

// The signing CA's CRL, public and fresh on every request, valid a week.
export async function GET() {
  return new Response(Buffer.from(await currentCrl()), {
    headers: {
      "Content-Type": "application/pkix-crl",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
