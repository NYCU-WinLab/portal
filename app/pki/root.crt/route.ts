import { rootIdentity } from "@/lib/actions/signing-keys"

// The signing CA's certificate, public: PDF readers follow the link in
// member certificates, and members import it as a trusted root.
export async function GET() {
  const root = await rootIdentity()
  return new Response(Buffer.from(root.certificate.der), {
    headers: {
      "Content-Type": "application/pkix-cert",
      "Content-Disposition": 'attachment; filename="winlab-portal-root-ca.crt"',
      "Cache-Control": "public, max-age=86400",
    },
  })
}
