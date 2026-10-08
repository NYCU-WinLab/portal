import { AppShell } from "@/components/app-shell"
import { getSession } from "@/lib/auth/session"

// The portal's corners: the lab in the breadcrumb, the app's pages and the
// account (登入, or the member's name) in the top right.
export async function PortalShell({
  page,
  nav,
  layout,
  children,
}: {
  page?: { label: string; href: string; tip: string }
  nav?: { label: string; href: string; tip: string }[]
  layout?: "column" | "spotlight" | "wide"
  children: React.ReactNode
}) {
  const session = await getSession()
  return (
    <AppShell
      layout={layout}
      breadcrumb={[
        { label: "WinLab", href: "/", tip: "所有服務" },
        ...(page ? [page] : []),
      ]}
      nav={nav}
      account={
        session
          ? {
              label: session.user.name,
              href: "/profile",
              tip: session.user.email,
            }
          : { label: "登入", href: "/sign-in", tip: "auth.winlab.tw" }
      }
    >
      {children}
    </AppShell>
  )
}
