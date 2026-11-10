import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell, runningBuild } from "@/components/portal-shell"
import { ReleaseNotes } from "@/components/release-notes"
import { runAction } from "@/lib/actions/define"
import { listReleaseNotes } from "@/lib/actions/releases"
import { requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

const changelogPage = {
  label: "Changelog",
  href: "/changelog",
  tip: "portal 的更新",
}

// Every release note, newest first, the commit beside each change.
export default async function ChangelogPage() {
  const actor = await requireActor("/changelog")
  const { notes } = await runAction(listReleaseNotes, actor, { limit: 200 })
  return (
    <PortalShell page={changelogPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="版本更新" />
        <Focus>
          <FocusLabel>目前版本</FocusLabel>
          <FocusTitle>
            {/* The same commit as the bottom-left build. */}
            <FocusHighlight className="font-mono">
              {runningBuild()?.sha ?? "dev"}
            </FocusHighlight>
          </FocusTitle>
        </Focus>
        {notes.length === 0 ? (
          <EmptyState noun="更新" />
        ) : (
          <ReleaseNotes notes={notes} />
        )}
      </div>
    </PortalShell>
  )
}
