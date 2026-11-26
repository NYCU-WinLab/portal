import { z } from "zod"

import {
  applications,
  type Applications,
} from "@/lib/actions/applications/container"
import { defineAction, type Actor } from "@/lib/actions/define"
import { Refusal } from "@/lib/refusal"

// The apply site (apply.winlab.tw) runs these with its service key; an
// applicant has no portal account. Every refusal an applicant may see is an
// ApplicationRefusal code, thrown by the service.

/** Only the apply site's service key may call these. */
function applicant(actor: Actor, get: () => Applications) {
  if (actor.service !== "apply") throw new Refusal("只有申請頁可以呼叫")
  return get().applicant
}

const token = z.string().min(20).max(128)
const email = z.string().max(254)
// Loose here; ApplicantProfile.parse is the real check.
const requestedStatus = z.string().max(32)
const profile = z.record(z.string().max(64), z.unknown())

/** The settings are a member's: a service key's id is no member. */
function adminId(actor: Actor): string {
  if (actor.service) throw new Refusal("服務金鑰不能看或改這個設定")
  return actor.userId
}

export const applicationActions = (get: () => Applications) => ({
  submit: defineAction({
    name: "submit_lab_application",
    title: "送出帳號申請",
    description:
      "Apply site only: starts an account application and mails the applicant a link to verify the email. The answer is the same whether the email is new, already applying or already has an account.",
    kind: "mutation",
    quiet: true,
    input: z.object({ email, requestedStatus, profile }),
    run: async (actor, input) => applicant(actor, get).submit(input),
  }),
  getForConfirm: defineAction({
    name: "get_lab_application_for_confirm",
    title: "查看待確認的申請",
    description:
      "Apply site only: the summary an applicant checks before confirming the email, found by the verify token from the mail.",
    kind: "query",
    input: z.object({ token }),
    run: async (actor, { token }) => applicant(actor, get).getForConfirm(token),
  }),
  confirm: defineAction({
    name: "confirm_lab_application",
    title: "確認申請 email",
    description:
      "Apply site only: confirms the email with the verify token, which submits the application for review and mails the applicant a status link. Returns ok false with code already_applied when the email already has an active application.",
    kind: "mutation",
    idempotent: true,
    input: z.object({ token }),
    run: async (actor, { token }) => applicant(actor, get).confirm(token),
  }),
  getStatus: defineAction({
    name: "get_lab_application_status",
    title: "查看申請狀態",
    description:
      "Apply site only: where an application stands, found by the access token from the status link.",
    kind: "query",
    input: z.object({ token }),
    run: async (actor, { token }) => applicant(actor, get).getStatus(token),
  }),
  sendLink: defineAction({
    name: "send_lab_application_link",
    title: "寄送申請狀態連結",
    description:
      "Apply site only: mails a new status link to an email that has an application. Always answers ok, so it does not reveal whether the email applied.",
    kind: "mutation",
    quiet: true,
    input: z.object({ email }),
    run: async (actor, { email }) => applicant(actor, get).sendLink(email),
  }),
  withdraw: defineAction({
    name: "withdraw_lab_application",
    title: "撤回申請",
    description:
      "Apply site only: withdraws the application behind the access token. Withdrawing twice leaves the same state.",
    kind: "mutation",
    idempotent: true,
    input: z.object({ token }),
    run: async (actor, { token }) => applicant(actor, get).withdraw(token),
  }),
  getForEdit: defineAction({
    name: "get_lab_application_for_edit",
    title: "查看要修改的申請",
    description:
      "Apply site only: the profile an applicant may edit while changes are requested, found by the access token.",
    kind: "query",
    input: z.object({ token }),
    run: async (actor, { token }) => applicant(actor, get).getForEdit(token),
  }),
  resubmit: defineAction({
    name: "resubmit_lab_application",
    title: "重新送出申請",
    description:
      "Apply site only: sends back an application whose changes were requested, with the corrected profile. The email cannot change.",
    kind: "mutation",
    input: z.object({ token, requestedStatus, profile }),
    run: async (actor, { token, ...patch }) =>
      applicant(actor, get).resubmit(token, patch),
  }),
  requestPasswordMail: defineAction({
    name: "send_lab_application_password_mail",
    title: "重寄設定密碼信",
    description:
      "Apply site only: asks for the set-password mail again after an application was accepted; one request an hour.",
    kind: "mutation",
    input: z.object({ token }),
    run: async (actor, { token }) =>
      applicant(actor, get).requestPasswordMail(token),
  }),
})

export type ApplicantActions = ReturnType<typeof applicationActions>

// Settings: signed-in portal admins and accounts admins. The service key is no member, so it is refused there.
export const applicationSettingsActions = (get: () => Applications) => ({
  get: defineAction({
    name: "get_application_settings",
    title: "查看帳號申請設定",
    description:
      "Returns the account-application settings: applySiteUrl (the apply site's address that application mails link to, or null while unset), and who changed it last and when. Only portal admins and accounts admins may read it.",
    kind: "query",
    input: z.object({}),
    run: async (actor) => {
      const site = await get().settings.applySite(adminId(actor))
      return {
        applySiteUrl: site.url,
        updatedAt: site.updatedAt,
        updatedBy: site.updatedBy,
      }
    },
  }),
  setApplySiteUrl: defineAction({
    name: "set_apply_site_url",
    title: "設定申請網站網址",
    description:
      "Sets the address of the apply site, which every account-application mail links to. It must be an https address on winlab.tw or one of its subdomains, with no port, path, query or fragment; it is stored as the bare origin, which is returned. Only portal admins and accounts admins may change it. Setting the same address again changes nothing else.",
    kind: "mutation",
    idempotent: true,
    input: z.object({ url: z.string().max(2048) }),
    run: async (actor, { url }) =>
      get().settings.setApplySite(adminId(actor), url),
  }),
})

// Review: accounts admins, signed in. The service key is no member, and the
// actions are in no API app, so a key never reaches them; the guard is a
// second wall. Permissions are the admin gate here and, for the mail group
// switch, the service's own check of who manages the group.
function processorId(actor: Actor): string {
  if (actor.service) throw new Refusal("服務金鑰不能審核帳號申請")
  return actor.userId
}

const applicationId = z.uuid()
const version = z.number().int().min(1)
const note = z.string().max(2000)
const groupId = z.string().min(1).max(128)
const patch = z.object({
  requestedStatus: z.string().max(32).optional(),
  // ProfileInput.parse is the real check, with the same field names.
  profile: z
    .record(z.string().max(64), z.string().max(2000).nullable())
    .optional(),
})

export const applicationReviewActions = (get: () => Applications) => ({
  list: defineAction({
    name: "list_lab_applications",
    title: "列出帳號申請",
    description:
      "Lists account applications for review, newest first, each with its profile, the defaults a processor would accept (member status, cohort, username, mail groups), whether the username is taken (null when Keycloak could not be asked), history, events and provisioning progress. With closed false (the default) it lists open ones and accepted ones not yet released; with closed true it lists finished ones. Only accounts admins may call it.",
    admin: "accounts",
    kind: "query",
    input: z.object({ closed: z.boolean().optional() }),
    run: async (actor, { closed }) =>
      get().review.list(processorId(actor), { closed: closed ?? false }),
  }),
  update: defineAction({
    name: "update_lab_application",
    title: "修改帳號申請資料",
    description:
      "Corrects an application's profile fields or requested status while it is pending. Pass the application's current version; a stale version is refused. patch.profile holds only the fields to change (null clears an optional one). Refused when the application cannot be edited in its state, the version is stale or a value is invalid. Sending the same values again with the current version changes nothing; a stale version is refused with version_conflict even if the values are the same, so read the application again first.",
    admin: "accounts",
    kind: "mutation",
    idempotent: true,
    input: z.object({ id: applicationId, version, patch }),
    run: async (actor, { id, version, patch }) =>
      get().review.update(processorId(actor), id, version, patch),
  }),
  requestChanges: defineAction({
    name: "request_lab_application_changes",
    title: "請申請人修改",
    description:
      "Asks the applicant to correct their application: mails them a fresh link with the note and a 7-day deadline, and moves the application to changes_requested. Pass the current version; a stale version or a blank note is refused, and an application that is not pending is refused with wrong_state (a new request is allowed again only once the open one has expired). Each call that changes the application mails the applicant.",
    admin: "accounts",
    kind: "mutation",
    input: z.object({ id: applicationId, version, note: note.min(1) }),
    run: async (actor, { id, version, note }) =>
      get().review.requestChanges(processorId(actor), id, version, note),
  }),
  accept: defineAction({
    name: "accept_lab_application",
    title: "核准帳號申請",
    description:
      "Accepts a pending application and starts creating the account: assigns member status, cohort (academic year, e.g. 116) and username, and the mail groups to join. Pass the current version. Refused when the status is not one the member may assign (teacher, assistant and undergrad need a portal admin), the username or email already exists, the cohort's Keycloak group is missing (portal admins are mailed), or a mail group is not one the member manages. Accepting the same application with the same values again changes nothing.",
    admin: "accounts",
    kind: "mutation",
    idempotent: true,
    input: z.object({
      id: applicationId,
      version,
      status: z.string().max(32),
      cohort: z.number().int().min(1).max(9999),
      username: z.string().min(1).max(64),
      mailGroups: z.array(groupId).max(50),
    }),
    run: async (actor, { id, version, ...input }) =>
      get().review.accept(processorId(actor), id, version, input),
  }),
  retryProvisioning: defineAction({
    name: "retry_lab_application_provisioning",
    title: "重試建立帳號",
    description:
      "Retries account creation for an accepted application whose provisioning is waiting or blocked, optionally with a different username or cohort. Refused when the application is not being provisioned or the new values are invalid or taken. Retrying again with the same input leaves the same state.",
    admin: "accounts",
    kind: "mutation",
    idempotent: true,
    input: z.object({
      id: applicationId,
      username: z.string().min(1).max(64).optional(),
      cohort: z.number().int().min(1).max(9999).optional(),
    }),
    run: async (actor, { id, ...change }) =>
      get().review.retryProvisioning(processorId(actor), id, change),
  }),
  reject: defineAction({
    name: "reject_lab_application",
    title: "退回帳號申請",
    description:
      "Rejects an application and mails the applicant, with the note when one is given. An application whose state does not allow rejection (for example one already accepted) is refused with wrong_state. Rejecting an already rejected application changes nothing and sends no second mail.",
    admin: "accounts",
    kind: "mutation",
    idempotent: true,
    input: z.object({ id: applicationId, note: note.optional() }),
    run: async (actor, { id, note }) =>
      get().review.reject(processorId(actor), id, note),
  }),
  resendPasswordMail: defineAction({
    name: "resend_lab_application_password_mail",
    title: "重寄設定密碼信",
    description:
      "Mails an accepted applicant a new set-password link. Shares the applicant's own limit of one mail an hour, so a call inside that hour is refused. Refused when the application has no accepted account to set a password for.",
    admin: "accounts",
    kind: "mutation",
    input: z.object({ id: applicationId }),
    run: async (actor, { id }) =>
      get().review.resendPasswordMail(processorId(actor), id),
  }),
  listSettings: defineAction({
    name: "list_application_settings",
    title: "查看申請通知與群組信設定",
    description:
      "Returns who is notified of new applications (notifiees), the mail groups every accepted applicant joins by default with their addresses, the groups the caller manages (group managers) that could be turned on as defaults (offerableGroups), and warnings when there are no processors (accounts admins) or no notifiees. The apply site's address is read with get_application_settings. Only accounts admins may call it.",
    admin: "accounts",
    kind: "query",
    input: z.object({}),
    run: async (actor) => get().settings.list(processorId(actor)),
  }),
  setNotifiee: defineAction({
    name: "set_application_notifiee",
    title: "設定申請通知對象",
    description:
      "Adds a member to, or removes one from, those mailed about new applications. Setting the same state again changes nothing. Only accounts admins may call it.",
    admin: "accounts",
    kind: "mutation",
    idempotent: true,
    input: z.object({ userId: z.uuid(), notify: z.boolean() }),
    run: async (actor, { userId, notify }) =>
      get().settings.setNotifiee(processorId(actor), userId, notify),
  }),
  setMailGroup: defineAction({
    name: "set_application_mail_group",
    title: "設定預設群組信",
    description:
      "Turns a mail group on or off as a default for accepted applicants. Turning one on is refused unless the portal may manage that group and the member manages it; turning one off is always allowed. Setting the same state again changes nothing. Only accounts admins may call it.",
    admin: "accounts",
    kind: "mutation",
    idempotent: true,
    input: z.object({ groupId, enabled: z.boolean() }),
    run: async (actor, { groupId, enabled }) =>
      get().settings.setMailGroup(processorId(actor), groupId, enabled),
  }),
})

const live = applicationActions(applications)
export const {
  submit: submitLabApplication,
  getForConfirm: getLabApplicationForConfirm,
  confirm: confirmLabApplication,
  getStatus: getLabApplicationStatus,
  sendLink: sendLabApplicationLink,
  withdraw: withdrawLabApplication,
  getForEdit: getLabApplicationForEdit,
  resubmit: resubmitLabApplication,
  requestPasswordMail: sendLabApplicationPasswordMail,
} = live

const settingsLive = applicationSettingsActions(applications)
export const { get: getApplicationSettings, setApplySiteUrl } = settingsLive

const reviewLive = applicationReviewActions(applications)
export const {
  list: listLabApplications,
  update: updateLabApplication,
  requestChanges: requestLabApplicationChanges,
  accept: acceptLabApplication,
  retryProvisioning: retryLabApplicationProvisioning,
  reject: rejectLabApplication,
  resendPasswordMail: resendLabApplicationPasswordMail,
  listSettings: listApplicationSettings,
  setNotifiee: setApplicationNotifiee,
  setMailGroup: setApplicationMailGroup,
} = reviewLive
