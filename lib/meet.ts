// meet.winlab.tw, the lab's own meeting rooms. Portal books a room there
// for each online room booking through meet's service API
// (/api/actions/<name>, Bearer MEET_SERVICE_KEY); the link comes back at
// once. Off when the key is empty, and the GitLab Teams pipeline is used.
const timeout = () => AbortSignal.timeout(10_000)

export const meetConfigured = () => Boolean(process.env.MEET_SERVICE_KEY)

const base = () => process.env.MEET_URL ?? "https://meet.winlab.tw"

/** Runs one of meet's actions as portal; throws meet's message. */
export async function meetAction<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${base()}/api/actions/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.MEET_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: timeout(),
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: string
  } & T
  if (!response.ok) throw new Error(body.error ?? `meet ${response.status}`)
  return body
}

/** The host meet links live on, for checking a join link. */
export const meetHost = () => new URL(base()).host
