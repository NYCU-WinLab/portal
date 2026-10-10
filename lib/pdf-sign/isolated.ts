import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import type { UploadJob, UploadResult } from "@/lib/pdf-sign/job"

// Runs an UploadJob in a child process with a wall-clock limit and a heap
// limit, and kills it past either: member files reach pdf-lib there, and a
// hostile one can make it spin for minutes. The
// child gets no environment (no database URL, no secrets), only the job.

/** Far more than any honest file needs to convert and stamp. */
const TIME_LIMIT_MS = 30_000
const HEAP_LIMIT_MB = 512
/** Workers running at once; more uploads wait their turn. */
const CONCURRENCY = 3

let running = 0
const waiting: (() => void)[] = []

async function slot() {
  if (running < CONCURRENCY) {
    running += 1
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
}

function release() {
  const next = waiting.shift()
  if (next) next()
  else running -= 1
}

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

export async function processIsolated(job: UploadJob): Promise<UploadResult> {
  await slot()
  try {
    return await runWorker(job)
  } finally {
    release()
  }
}

function runWorker(job: UploadJob): Promise<UploadResult> {
  const { file, args } = command()
  // The answer is the PDF in base64, a third larger than maxBytes.
  // Anything beyond is not an answer.
  const outputLimit = Math.ceil(job.maxBytes * 1.5) + 1024 * 1024
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
    let outputBytes = 0
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > outputLimit) child.kill("SIGKILL")
      else out.push(chunk)
    })
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
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")) as UploadResult)
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
