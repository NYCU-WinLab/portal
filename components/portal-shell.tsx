import { AppShell } from "@/components/app-shell"
import { getSession } from "@/lib/auth/session"

// The portal's corners: the lab in the breadcrumb, the member and build at
// the bottom left. Apps add their own page and nav as they move over.
export async function PortalShell({
  page,
  nav,
  layout,
  children,
}: {
  page?: { label: string; href: string }
  nav?: { label: string; href: string; tip?: string }[]
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
      user={
        session
          ? {
              name: session.user.name,
              href: "/",
              image: session.user.image ?? undefined,
              tip: session.user.email,
            }
          : undefined
      }
    >
      {children}
    </AppShell>
  )
}
