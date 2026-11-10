import { AppShell } from "@/components/app-shell"
import { LiveRefresh } from "@/components/live-refresh"
import { ReleaseDialog } from "@/components/release-dialog"
import { adminAppsOf, type Gated, visibleTo } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { getUnseenReleaseNotes } from "@/lib/actions/releases"
import { getSession } from "@/lib/auth/session"

// The build in the bottom left. The deploy sets PORTAL_VERSION (sha-<commit>)
// in .env, which web reads; the image carries when and where it was built.
const runningBuild = () => {
  const sha = process.env.PORTAL_VERSION?.match(/^sha-([0-9a-f]{7,})$/)?.[1]
  return sha
    ? { sha, time: process.env.BUILD_TIME, url: process.env.BUILD_URL }
    : undefined
}

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
  nav?: ({
    label: string
    href: string
    tip: string
    also?: string[]
  } & Gated)[]
  layout?: "column" | "spotlight" | "wide"
  children: React.ReactNode
}) {
  const gated = nav?.some((item) => item.admin)
  const session = await getSession()
  const shown =
    nav && gated
      ? visibleTo(
          session
            ? await adminAppsOf({ userId: session.user.id, via: "web" })
            : new Set(),
          nav
        )
      : nav
  // The day's first page shows what changed since the member last looked.
  const unseen = session
    ? await runAction(
        getUnseenReleaseNotes,
        { userId: session.user.id, via: "web" },
        {}
      ).catch(() => ({ notes: [] }))
    : { notes: [] }
  return (
    <AppShell
      layout={layout}
      build={runningBuild()}
      breadcrumb={[
        { label: "WinLab", href: "/", tip: "所有服務" },
        ...(page ? [page] : []),
      ]}
      nav={shown?.map(({ label, href, tip, also }) => ({
        label,
        href,
        tip,
        also,
      }))}
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
      {unseen.notes.length > 0 && <ReleaseDialog notes={unseen.notes} />}
      {children}
    </AppShell>
  )
}
