import Link from "next/link"

import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { buttonVariants } from "@/components/ui/button"

// What requireAdminPage shows, with a 403: the page is there, the member
// is not one of its admins.
export default function Forbidden() {
  return (
    <PortalShell layout="spotlight">
      <StatusPage
        title="這一頁只有管理員能看"
        action={
          <Link prefetch href="/" className={buttonVariants()}>
            回到首頁
          </Link>
        }
      />
    </PortalShell>
  )
}
