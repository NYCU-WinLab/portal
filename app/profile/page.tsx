import { FieldList, FieldRow } from "@/components/field-list"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { buttonVariants } from "@/components/ui/button"
import { errorMessage, runAction } from "@/lib/actions/define"
import { getBentoStats } from "@/lib/actions/bento"
import { getProfile } from "@/lib/actions/profile"
import { listMeetingStats } from "@/lib/actions/stats"
import { requireActor } from "@/lib/auth/session"
import { ntd } from "@/lib/bento"
import { accountConsoleUrl } from "@/lib/keycloak"

import { SignOutButton } from "./sign-out-button"

export const dynamic = "force-dynamic"

const fields = [
  ["chineseName", "中文姓名"],
  ["lastName", "英文姓"],
  ["firstName", "英文名"],
  ["username", "帳號"],
  ["email", "信箱"],
  ["studentId", "學號"],
] as const

export default async function ProfilePage() {
  const actor = await requireActor("/profile")
  const [profile, stats, bento] = await Promise.all([
    runAction(getProfile, actor, {}).catch((error: unknown) => ({
      error: errorMessage(error),
    })),
    runAction(listMeetingStats, actor, {}),
    runAction(getBentoStats, actor, {}),
  ])
  const lunch = bento.members.find((row) => row.userId === actor.userId)
  const mine = stats.members.find((row) => row.userId === actor.userId)
  const count = (done: number, next: number) =>
    `${done} 次${next ? `，之後排了 ${next} 次` : ""}`

  return (
    <PortalShell
      page={{ label: "Profile", href: "/profile", tip: "Keycloak 帳號" }}
    >
      <div className="flex flex-col gap-12">
        <PageHeader
          title="我的資料"
          actions={
            <>
              <a
                href={accountConsoleUrl()}
                className={buttonVariants({ variant: "outline" })}
              >
                修改
              </a>
              <SignOutButton />
            </>
          }
        />
        {"error" in profile ? (
          <p className="text-muted-foreground">{profile.error}</p>
        ) : (
          <FieldList>
            {fields.map(([key, label]) => (
              <FieldRow key={key} label={label}>
                {profile[key] || (
                  <span className="text-muted-foreground">未填</span>
                )}
              </FieldRow>
            ))}
          </FieldList>
        )}
        {mine && (
          <section className="flex flex-col gap-6">
            <SectionHeader title="實驗室會議" />
            <FieldList>
              <FieldRow label="報告">
                {count(mine.presented, mine.presentScheduled)}
              </FieldRow>
              <FieldRow label="提問">
                {count(mine.asked, mine.askScheduled)}
              </FieldRow>
              <FieldRow label="請假">
                {count(mine.leaves, mine.leaveScheduled)}
              </FieldRow>
            </FieldList>
          </section>
        )}
        {lunch && (
          <section className="flex flex-col gap-6">
            <SectionHeader title="便當" />
            <FieldList>
              <FieldRow label="點過">
                {lunch.dishes} 份，{lunch.kinds} 種
              </FieldRow>
              <FieldRow label="花了">{ntd(lunch.spent)}</FieldRow>
              {lunch.favorite && (
                <FieldRow label="本命">
                  {lunch.favorite.name} × {lunch.favorite.count}
                </FieldRow>
              )}
            </FieldList>
          </section>
        )}
      </div>
    </PortalShell>
  )
}
