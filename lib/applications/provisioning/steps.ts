import type { Application } from "../domain/application"
import type { StepName } from "../domain/constants"
import type { ProvisioningRun } from "../domain/provisioning-run"
import type {
  KeycloakProvisioner,
  MailGroups,
  ProcessorAuthority,
  SettingsStore,
  UnitOfWork,
} from "../ports"
import { StepError } from "./step-error"

export type StepContext = {
  application: Application
  run: ProvisioningRun
  uow: UnitOfWork
  /** The only clock a step may read. */
  now: Date
  signal: AbortSignal
}

/**
 * `restart` sends the run back to the first step (the account vanished);
 * `close_has_account` closes the application because the email already has
 * an account. A step that cannot go on throws a `StepError`.
 */
export type StepResult =
  { kind: "done" } | { kind: "restart" } | { kind: "close_has_account" }

export interface ProvisioningStep {
  readonly name: StepName
  run(ctx: StepContext): Promise<StepResult>
}

const DONE: StepResult = { kind: "done" }
const RESTART: StepResult = { kind: "restart" }

const PROVISIONING_GROUP = "/provisioning"

function assignmentOf(app: Application) {
  const a = app.assignment
  if (!a) throw new Error(`application ${app.id} has no assignment`)
  return a
}

/** Creates the disabled account in /provisioning and joins the lab groups. */
export class CreateAccountStep implements ProvisioningStep {
  readonly name = "create_account" as const

  constructor(private readonly keycloak: KeycloakProvisioner) {}

  async run(ctx: StepContext): Promise<StepResult> {
    const { application: app, uow } = ctx
    const assigned = assignmentOf(app)
    let id = app.keycloakId

    if (id !== null) {
      if ((await this.keycloak.readUser(id)) === null) return RESTART
    } else {
      const found = await this.keycloak.findByApplicationId(app.id)
      if (found !== null) {
        await this.verify(found, app)
        id = found
      } else {
        const created = await this.create(app)
        if (created === "close_has_account") {
          return { kind: "close_has_account" }
        }
        id = created
      }
      await uow.setKeycloakId(app.id, id)
    }

    const groups = [
      {
        path: `/lab-member/${assigned.status}`,
        what: "身分群組",
      },
      {
        path: `/lab-member/${assigned.cohort.value}`,
        what: "學年度群組",
      },
    ]
    for (const group of groups) {
      const joined = await this.keycloak.joinGroup(id, group.path)
      if (joined === "user_gone") return RESTART
      if (joined === "group_missing") {
        throw StepError.blocked(`${group.what} ${group.path} 不存在`)
      }
    }
    return DONE
  }

  private async verify(id: string, app: Application): Promise<void> {
    const user = await this.keycloak.readUser(id)
    // Found a moment ago and gone now: try again from the lookup.
    if (!user) throw StepError.retry("Keycloak 帳號剛被刪除，稍後自動重試")
    const expected = assignmentOf(app).username.value
    const same =
      user.username === expected &&
      user.email.toLowerCase() === app.email?.value.toLowerCase() &&
      user.attributes.portal_application_id?.includes(app.id) === true
    if (!same) {
      throw StepError.blocked(
        `Keycloak 上有一個帳號（${user.username}）標記為這份申請，但與申請的帳號名稱或信箱不符，請人工確認`
      )
    }
  }

  private async create(
    app: Application
  ): Promise<string | "close_has_account"> {
    const profile = app.profile
    if (!profile || !app.email) {
      throw StepError.blocked("申請資料已不完整，無法建立帳號")
    }
    const username = assignmentOf(app).username.value
    const f = profile.fields
    const attributes: Record<string, string[]> = {
      portal_application_id: [app.id],
      birthday: [f.birthday],
      department: [f.department],
    }
    if (f.nycuEmail) attributes.nycu_email = [f.nycuEmail]
    const result = await this.keycloak.createUser({
      username,
      email: app.email.value,
      firstName: f.firstName,
      lastName: f.lastName,
      attributes,
      groups: [PROVISIONING_GROUP],
    })
    if (result.ok) return result.id
    switch (result.reason) {
      case "email_taken":
        return "close_has_account"
      case "username_taken":
        throw StepError.blocked(
          `帳號名稱 ${username} 已被 Keycloak 上的其他帳號使用，請改派帳號名稱`
        )
      case "invalid":
        throw StepError.blocked(
          "Keycloak 拒絕建立帳號，請檢查申請資料與群組設定"
        )
    }
  }
}

/** Adds the applicant to the mail groups that are not yet stamped. */
export class JoinMailGroupsStep implements ProvisioningStep {
  readonly name = "join_mail_groups" as const

  constructor(
    private readonly groups: MailGroups,
    private readonly authority: ProcessorAuthority,
    private readonly settings: SettingsStore
  ) {}

  async run(ctx: StepContext): Promise<StepResult> {
    const { application: app, uow, now } = ctx
    const email = app.email
    if (!email) throw StepError.blocked("申請資料已不完整，無法加入郵件群組")
    const reviewer = app.reviewedBy
    const isManager = async (groupId: string) =>
      reviewer
        ? this.authority.managesGroup(reviewer, groupId)
        : (await this.settings.defaultMailGroups()).includes(groupId)

    for (const group of assignmentOf(app).mailGroups) {
      if (group.addedAt !== null) continue
      const added = await this.groups.add(group.groupId, email, {
        actorId: reviewer,
        isManager,
      })
      switch (added) {
        case "ok":
        case "already":
        case "protected":
          await uow.markMailGroupAdded(app.id, group.groupId, now)
          break
        case "denied":
          throw StepError.blocked(
            `沒有權限把申請人加入郵件群組 ${group.groupId}，請確認審核者是該群組的管理員`
          )
        case "error":
          throw StepError.retry(
            `加入郵件群組 ${group.groupId} 失敗，稍後自動重試`
          )
      }
    }
    return DONE
  }
}
