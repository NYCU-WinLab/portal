// Every mail the portal sends is built here, as plain text and as HTML in
// the ui.winlab.tw look: flat, text-title and text-body, the primary color
// only on the one action; other links are outlined buttons beside it. Mail clients read no CSS variables or oklch, so
// this file keeps hex copies of the tokens in app/globals.css.

export type MailBody = {
  title: string
  /** Facts as label and value: 時間, 地點. */
  rows?: [string, string][]
  /** Free text; a single line break stays a line break. */
  paragraphs?: string[]
  /** The one thing to do next, as a button. */
  action?: { label: string; url: string }
  /** Other places to go, as outlined buttons after the action. */
  links?: { label: string; url: string }[]
}

const light = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  muted: "#737373",
  border: "#e5e5e5",
  primary: "#0033a0",
  primaryForeground: "#fafafa",
}
const dark = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  muted: "#a1a1a1",
  border: "#262626",
  primary: "#5e94ff",
  primaryForeground: "#0a0a0a",
}
const font =
  'Inter, "Noto Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** Escapes text, turns URLs into links and line breaks into <br>. */
function inline(text: string) {
  return escape(text)
    .replace(
      /https?:\/\/[^\s<]+[^\s<.,，。)）]/g,
      (url) =>
        `<a class="link" href="${url}" style="color:${light.foreground};text-decoration:underline">${url}</a>`
    )
    .replace(/\n/g, "<br>")
}

export function mailBody(body: MailBody): { text: string; html: string } {
  const rows = body.rows ?? []
  const paragraphs = body.paragraphs?.filter((p) => p.trim()) ?? []
  const text = [
    body.title,
    ...(rows.length ? ["", ...rows.map(([k, v]) => `${k}：${v}`)] : []),
    ...paragraphs.flatMap((p) => ["", p]),
    ...(body.action || body.links?.length ? [""] : []),
    ...[...(body.action ? [body.action] : []), ...(body.links ?? [])].map(
      (link) => `${link.label}：${link.url}`
    ),
  ].join("\n")
  const buttons = [
    ...(body.action
      ? [
          `<a class="action" href="${escape(body.action.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 20px;border:1px solid ${light.primary};border-radius:16px;background:${light.primary};color:${light.primaryForeground};font-weight:500;text-decoration:none">${escape(body.action.label)}</a>`,
        ]
      : []),
    ...(body.links ?? []).map(
      (link) =>
        `<a class="secondary" href="${escape(link.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 20px;border:1px solid ${light.border};border-radius:16px;color:${light.foreground};font-weight:500;text-decoration:none">${escape(link.label)}</a>`
    ),
  ]

  const home = process.env.BETTER_AUTH_URL ?? "https://portal.winlab.tw"
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
@media (prefers-color-scheme: dark) {
  body, .page { background: ${dark.background} !important; color: ${dark.foreground} !important; }
  .muted { color: ${dark.muted} !important; }
  .rule { border-color: ${dark.border} !important; }
  .link { color: ${dark.foreground} !important; }
  .action { background: ${dark.primary} !important; color: ${dark.primaryForeground} !important; }
  .secondary { color: ${dark.foreground} !important; border-color: ${dark.border} !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${light.background};color:${light.foreground}">
<div class="page" style="background:${light.background};color:${light.foreground};font-family:${font};font-size:16px;line-height:1.6">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
<h1 style="margin:0 0 24px;font-size:24px;line-height:1.3;font-weight:600">${inline(body.title)}</h1>
${
  rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 24px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td class="muted rule" style="padding:8px 16px 8px 0;border-top:1px solid ${light.border};color:${light.muted};white-space:nowrap;vertical-align:top;width:1%">${escape(k)}</td><td class="rule" style="padding:8px 0;border-top:1px solid ${light.border};vertical-align:top">${inline(v)}</td></tr>`
  )
  .join("\n")}
</table>`
    : ""
}
${paragraphs.map((p) => `<p style="margin:0 0 16px">${inline(p)}</p>`).join("\n")}
${buttons.length ? `<p style="margin:24px 0 16px">${buttons.join("")}</p>` : ""}
<p class="muted rule" style="margin:40px 0 0;padding-top:16px;border-top:1px solid ${light.border};color:${light.muted}"><a class="muted" href="${escape(home)}" style="color:${light.muted};text-decoration:none">WinLab Portal</a></p>
</div>
</div>
</body>
</html>`
  return { text, html }
}
