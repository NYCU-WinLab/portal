import { AppShell } from "@/components/app-shell"
import { LiveRefresh } from "@/components/live-refresh"
import { adminAppsOf, type Gated, visibleTo } from "@/lib/actions/authz"
import { getSession } from "@/lib/auth/session"

// The portal's corners: the lab in the breadcrumb, the app's pages in the
// top right. The account (登入, or the member's name) shows only on pages
// outside an app, such as the portal home; inside an app the top right is
// the app's own pages. A nav item with admin shows only to that app's
// admins.
export async function PortalShell({
  page,
  nav,
  layout,
  children,
}: {
  page?: { label: string; href: string; tip: string }
  nav?: ({ label: string; href: string; tip: string } & Gated)[]
  layout?: "column" | "spotlight" | "wide"
  children: React.ReactNode
}) {
  const gated = nav?.some((item) => item.admin)
  const session = page && !gated ? null : await getSession()
  const shown =
    nav && gated
      ? visibleTo(
          session
            ? await adminAppsOf({ userId: session.user.id, via: "web" })
            : new Set(),
          nav
        )
      : nav
  return (
    <AppShell
      layout={layout}
      breadcrumb={[
        { label: "WinLab", href: "/", tip: "所有服務" },
        ...(page ? [page] : []),
      ]}
      nav={shown?.map(({ label, href, tip }) => ({ label, href, tip }))}
      account={
        page
          ? undefined
          : session
            ? {
                label: session.user.name,
                href: "/profile",
                tip: session.user.email,
              }
            : { label: "登入", href: "/sign-in", tip: "auth.winlab.tw" }
      }
    >
      <LiveRefresh />
      {children}
    </AppShell>
  )
}
