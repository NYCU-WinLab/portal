import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import type { SignJob, SignResult } from "@/lib/pdf-sign/job"

// Runs a SignJob in a child process with a wall-clock limit and a heap
// limit, and kills it past either: member files reach pdf-lib and our own
// reader there, and a hostile one may make either spin for minutes. The
// child gets no environment (no database URL, no secrets), only the job.

/** Long enough for a timestamp authority or two to answer. */
const TIME_LIMIT_MS = 45_000
const HEAP_LIMIT_MB = 512

function command() {
  // The image ships the bundled worker next to server.js; elsewhere (dev,
  // the sandbox) Bun runs the source.
  const bundled = join(process.cwd(), "pdf-worker.mjs")
  if (existsSync(bundled))
    return {
      file: process.execPath,
      args: [`--max-old-space-size=${HEAP_LIMIT_MB}`, bundled],
    }
  return { file: "bun", args: [join(process.cwd(), "scripts/pdf-worker.ts")] }
}

export function signIsolated(job: SignJob): Promise<SignResult> {
  const { file, args } = command()
  return new Promise((resolve) => {
    const child: ChildProcessWithoutNullStreams = spawn(file, args, {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, TIME_LIMIT_MS)
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => {
      if (err.length < 64) err.push(chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      console.error("pdf worker", error.message)
      resolve({ ok: false, error: "檔案處理失敗，請稍後再試" })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (timedOut)
        return resolve({
          ok: false,
          error: "這個檔案處理太久，請另存成 PDF 或改傳照片",
        })
      try {
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")) as SignResult)
      } catch {
        console.error(
          "pdf worker exited",
          code,
          Buffer.concat(err).toString("utf8").slice(0, 500)
        )
        resolve({
          ok: false,
          error: "這個檔案無法處理，請另存成 PDF 或改傳照片",
        })
      }
    })
    child.stdin.on("error", () => {})
    child.stdin.end(JSON.stringify(job))
  })
}
