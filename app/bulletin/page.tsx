import { EmptyState } from "@/components/empty-state"
import { ExpandRow } from "@/components/expand-row"
import { Focus, FocusLabel, FocusMeta, FocusTitle } from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { listAnnouncements } from "@/lib/actions/bulletin"
import { runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

import { bulletinPage } from "./nav"
import { NewPost, PostActions } from "./post-forms"

export const dynamic = "force-dynamic"

type Post = Awaited<
  ReturnType<typeof listAnnouncements.run>
>["announcements"][number]

const day = (date: Date) =>
  date.toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
  })

function mailLabel(mail: Post["mail"]) {
  if (!mail) return null
  if (mail.status === "sent") return `已寄給 ${mail.recipients} 人`
  if (mail.status === "failed") return "寄信失敗"
  return "寄信中"
}

function Meta({ post }: { post: Post }) {
  const mail = mailLabel(post.mail)
  return (
    <>
      <span>{day(post.createdAt)}</span>
      {post.author && <span>{post.author}</span>}
      {mail && (
        <span
          className={
            post.mail?.status === "failed" ? "text-destructive" : undefined
          }
        >
          {mail}
        </span>
      )}
    </>
  )
}

export default async function BulletinPage() {
  const actor = await requireActor("/bulletin")
  const [{ announcements }, admin] = await Promise.all([
    runAction(listAnnouncements, actor, {}),
    isAdmin(actor, "portal"),
  ])
  const [latest, ...older] = announcements

  return (
    <PortalShell page={bulletinPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="公告" actions={admin && <NewPost />} />
        {!latest ? (
          <EmptyState noun="公告" />
        ) : (
          <Focus>
            <FocusLabel>最新</FocusLabel>
            <FocusTitle>{latest.title}</FocusTitle>
            <p className="whitespace-pre-wrap">{latest.content}</p>
            <FocusMeta>
              <Meta post={latest} />
              {admin && (
                <span className="ml-auto flex gap-1">
                  <PostActions post={latest} />
                </span>
              )}
            </FocusMeta>
          </Focus>
        )}
        {older.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader title="過去" />
            <ul className="flex stagger-rise flex-col">
              {older.map((post) => (
                <ExpandRow
                  key={post.id}
                  summary={
                    <span className="flex items-center gap-4">
                      <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                        {day(post.createdAt)}
                      </span>
                      <span className="min-w-0 truncate font-medium">
                        {post.title}
                      </span>
                    </span>
                  }
                  actions={admin && <PostActions post={post} />}
                >
                  <div className="flex flex-col gap-3">
                    <p className="whitespace-pre-wrap">{post.content}</p>
                    <p className="flex flex-wrap gap-x-4 text-muted-foreground">
                      <Meta post={post} />
                    </p>
                  </div>
                </ExpandRow>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PortalShell>
  )
}
