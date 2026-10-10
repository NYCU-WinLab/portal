// The PDF worker: reads one UploadJob as JSON on stdin, writes an UploadResult
// as JSON on stdout, exits. Spawned per upload by lib/pdf-sign/isolated.ts
// (as `node pdf-worker.mjs` in the image), so a file that makes a parser
// spin or balloon costs this process, never the web server.
import { runUploadJob, type UploadJob } from "@/lib/pdf-sign/job"

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const job = JSON.parse(Buffer.concat(chunks).toString("utf8")) as UploadJob
process.stdout.write(JSON.stringify(await runUploadJob(job)), () =>
  process.exit(0)
)
