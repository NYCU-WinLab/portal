import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { listApproveDocuments } from "@/lib/actions/approve"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { NewDocument } from "./new-document"
import { approvePage } from "./nav"

export const dynamic = "force-dynamic"

const statusLabel: Record<string, string> = {
  draft: "草稿",
  pending: "簽核中",
  completed: "已完成",
}

type Doc = Awaited<
  ReturnType<typeof listApproveDocuments.run>
>["documents"][number]

function DocList({ docs }: { docs: Doc[] }) {
  return (
    <ul className="flex stagger-rise flex-col">
      {docs.map((doc) => (
        <li key={doc.id} className="border-b border-border">
          <Link
            prefetch
            href={`/approve/${doc.id}`}
            className="flex min-h-14 items-center gap-4 py-2 transition-colors duration-state hover:text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">{doc.title}</span>
            <span className="shrink-0 text-muted-foreground">
              {doc.creator}
            </span>
            <span className="w-28 shrink-0 text-right text-muted-foreground tabular-nums">
              {doc.status === "pending"
                ? `${doc.signers.filter((s) => s.signedAt).length}/${doc.signers.length} 簽好`
                : statusLabel[doc.status]}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default async function ApprovePage() {
  const actor = await requireActor("/approve")
  const { documents } = await runAction(listApproveDocuments, actor, {})
  const toSign = documents.filter((doc) => doc.toSign)
  const mine = documents.filter((doc) => doc.createdBy === actor.userId)
  const signed = documents.filter(
    (doc) => doc.createdBy !== actor.userId && !doc.toSign
  )

  return (
    <PortalShell page={approvePage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="簽核" actions={<NewDocument />} />
        <Focus>
          <FocusLabel>等你簽</FocusLabel>
          <FocusTitle>
            {toSign.length ? (
              <>
                <FocusHighlight>
                  <NumberTicker value={toSign.length} />
                </FocusHighlight>{" "}
                份文件
              </>
            ) : (
              "沒有"
            )}
          </FocusTitle>
        </Focus>
        {toSign.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="等你簽" />
            <DocList docs={toSign} />
          </section>
        )}
        <section className="flex flex-col gap-2">
          <SectionHeader title="你建立的" />
          {mine.length ? <DocList docs={mine} /> : <EmptyState noun="文件" />}
        </section>
        {signed.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="你簽過的" />
            <DocList docs={signed} />
          </section>
        )}
      </div>
    </PortalShell>
  )
}
