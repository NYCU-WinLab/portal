import { FieldList, FieldRow } from "@/components/field-list"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { buttonVariants } from "@/components/ui/button"
import { errorMessage, runAction } from "@/lib/actions/define"
import { getProfile } from "@/lib/actions/profile"
import { requireActor } from "@/lib/auth/session"
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
  const profile = await runAction(getProfile, actor, {}).catch(
    (error: unknown) => ({ error: errorMessage(error) })
  )

  return (
    <PortalShell
      page={{ label: "我的資料", href: "/profile", tip: "Keycloak 帳號" }}
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
      </div>
    </PortalShell>
  )
}
