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

// Settings: signed-in members who process applications (portal admins and
// accounts admins). The service key is no member, so it is refused there.
export const applicationSettingsActions = (get: () => Applications) => ({
  get: defineAction({
    name: "get_application_settings",
    title: "查看帳號申請設定",
    description:
      "Returns the account-application settings: applySiteUrl (the apply site's address that application mails link to, or null while unset), and who changed it last and when. Only people who process applications (portal admins and accounts admins) may read it.",
    kind: "query",
    input: z.object({}),
    run: async (actor) => {
      const site = await get().settings.applySite(actor.userId)
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
      "Sets the address of the apply site, which every account-application mail links to. It must be an https address on winlab.tw or one of its subdomains, with no port, path, query or fragment; it is stored as the bare origin, which is returned. Only people who process applications (portal admins and accounts admins) may change it. Setting the same address again changes nothing else.",
    kind: "mutation",
    idempotent: true,
    input: z.object({ url: z.string().max(2048) }),
    run: async (actor, { url }) =>
      get().settings.setApplySite(actor.userId, url),
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
