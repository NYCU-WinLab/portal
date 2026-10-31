// The lab's GitLab, three ways and never a write: a read_api token
// (GITLAB_API_TOKEN) reads epics for the booking form; a pipeline trigger
// token (GITLAB_MEETING_TRIGGER_TOKEN) asks teams-meeting-bot (177) to
// create or cancel a booking's Teams meeting, answering on
// /api/rooms/meeting-callback; and one on winlab-helper (165,
// GITLAB_HELPER_TRIGGER_TOKEN) has it open, update or close the record epic
// of a meet booking (`meeting_open`). The helper holds the GitLab
// credentials and writes the epic itself.

import { deliverablesOf, readEpic, type Epic } from "@/lib/rooms/meeting"

const base = () =>
  (process.env.GITLAB_API_URL ?? "https://gitlab.winlab.tw").replace(/\/$/, "")
const timeout = () => AbortSignal.timeout(10_000)

export const meetingPipelineConfigured = () =>
  Boolean(process.env.GITLAB_MEETING_TRIGGER_TOKEN)

/**
 * Starts the meeting pipeline with these variables; returns its id. The
 * variables are not masked in GitLab, so the callback token in them is one
 * per request.
 */
export async function triggerMeetingPipeline(
  variables: Record<string, string>
) {
  const token = process.env.GITLAB_MEETING_TRIGGER_TOKEN
  if (!token) throw new Error("GitLab 會議 pipeline 沒有設定")
  return trigger(
    process.env.GITLAB_MEETING_TRIGGER_URL ??
      `${base()}/api/v4/projects/177/trigger/pipeline`,
    token,
    variables
  )
}

export const helperConfigured = () =>
  Boolean(process.env.GITLAB_HELPER_TRIGGER_TOKEN)

/** Starts winlab-helper's `meeting_open` with these variables; returns the
 * pipeline id. */
export async function triggerHelperPipeline(variables: Record<string, string>) {
  const token = process.env.GITLAB_HELPER_TRIGGER_TOKEN
  if (!token) throw new Error("winlab-helper trigger 沒有設定")
  return trigger(
    process.env.GITLAB_HELPER_TRIGGER_URL ??
      `${base()}/api/v4/projects/165/trigger/pipeline`,
    token,
    variables
  )
}

async function trigger(
  url: string,
  token: string,
  variables: Record<string, string>
) {
  const form = new FormData()
  form.set("token", token)
  form.set("ref", "main")
  for (const [key, value] of Object.entries(variables))
    form.set(`variables[${key}]`, value)
  const response = await fetch(url, {
    method: "POST",
    body: form,
    signal: timeout(),
  })
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200)
    throw new Error(
      `GitLab trigger 回應 ${response.status}${body ? `：${body}` : ""}`
    )
  }
  const { id } = (await response.json().catch(() => ({}))) as { id?: unknown }
  return id === undefined || id === null ? null : String(id)
}

export const epicsConfigured = () => Boolean(process.env.GITLAB_API_TOKEN)

class GitLabError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

async function get(path: string): Promise<unknown> {
  const token = process.env.GITLAB_API_TOKEN
  if (!token) throw new GitLabError("Portal 沒有設定 GitLab token")
  const response = await fetch(`${base()}/api/v4${path}`, {
    headers: { "private-token": token },
    cache: "no-store",
    signal: timeout(),
  }).catch(() => {
    throw new GitLabError("連不上 GitLab")
  })
  if (!response.ok)
    throw new GitLabError(`GitLab 回應 ${response.status}`, response.status)
  return response.json()
}

// Every page of a list, stopping at a short one; 50 pages is past any group.
async function getAll(path: string) {
  const rows: unknown[] = []
  for (let page = 1; page <= 50; page++) {
    const body = await get(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`
    )
    if (!Array.isArray(body)) throw new GitLabError("GitLab 回應不是清單")
    rows.push(...body)
    if (body.length < 100) return rows
  }
  throw new GitLabError("GitLab 清單超過 50 頁")
}

const group = (path: string) => `/groups/${encodeURIComponent(path)}`

/** The group's open epics, most recently updated first. */
export async function listOpenEpics(groupPath: string): Promise<Epic[]> {
  const rows = await getAll(
    `${group(groupPath)}/epics?state=opened&order_by=updated_at&sort=desc`
  )
  return rows.map(readEpic).filter((epic) => epic !== null)
}

/**
 * The open child issues of the epic a booking names (`<group path>&<iid>`),
 * for its agenda. Every epic kind: a meeting covers what is still open
 * under it, whatever it owes.
 */
export async function openEpicIssues(ref: string) {
  const match = /^(.+)&(\d+)$/.exec(ref)
  if (!match) return []
  const rows = await getAll(`${group(match[1])}/epics/${match[2]}/issues`)
  return rows.flatMap((row) => {
    const issue = row as { title?: unknown; web_url?: unknown; state?: unknown }
    if (issue.state !== "opened" || typeof issue.title !== "string") return []
    return [
      {
        title: issue.title.trim(),
        url: typeof issue.web_url === "string" ? issue.web_url : null,
      },
    ]
  })
}

/** One epic, or null when GitLab says it does not exist. */
export async function getEpic(groupPath: string, iid: number) {
  try {
    return readEpic(await get(`${group(groupPath)}/epics/${iid}`))
  } catch (error) {
    if (error instanceof GitLabError && error.status === 404) return null
    throw error
  }
}

export type EpicIssue = {
  title: string
  url: string | null
  deliverables: string[]
}

function readIssues(rows: unknown[], all: boolean): EpicIssue[] {
  return rows.flatMap((row) => {
    const issue = row as {
      title?: unknown
      web_url?: unknown
      labels?: unknown
    }
    const labels = Array.isArray(issue.labels) ? issue.labels : []
    const deliverables = deliverablesOf(labels)
    if (!all && !deliverables.length) return []
    return [
      {
        title: typeof issue.title === "string" ? issue.title.trim() : "",
        url: typeof issue.web_url === "string" ? issue.web_url : null,
        deliverables,
      },
    ]
  })
}

/**
 * What the epic's meeting owes: its child issues' Deliverable labels; for a
 * Report, every issue in its iteration (which must belong to the group or
 * an ancestor). A Sync container owes nothing itself.
 */
export async function epicIssues(groupPath: string, epic: Epic) {
  if (epic.kind === "sync") return []
  if (epic.kind === "meeting")
    return readIssues(
      await getAll(`${group(groupPath)}/epics/${epic.iid}/issues`),
      false
    )
  if (epic.reviewIteration === null)
    throw new Error("Report epic 的 iteration marker 不正確")
  const iterations = await getAll(
    `${group(groupPath)}/iterations?include_ancestors=true&state=all`
  )
  if (
    !iterations.some(
      (row) => Number((row as { id?: unknown }).id) === epic.reviewIteration
    )
  )
    throw new Error(`Iteration #${epic.reviewIteration} 不屬於這個群組`)
  return readIssues(
    await getAll(
      `${group(groupPath)}/issues?iteration_id=${epic.reviewIteration}&scope=all&state=all`
    ),
    true
  )
}
