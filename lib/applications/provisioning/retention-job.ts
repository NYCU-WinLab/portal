import { SYSTEM } from "../domain/application"
import type { RetentionPolicy } from "../domain/policies"
import type {
  ApplicationStore,
  ChangeNotifier,
  Clock,
  ProcessorAuthority,
  Tracer,
  UnitOfWork,
} from "../ports"
import type { MailComposer } from "../services/mail-composer"

/** Rows one item may touch in one tick. */
const BATCH = 100
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Taipei has no daylight saving: always UTC+8. */
const TAIPEI_OFFSET = 8 * HOUR
const DIGEST_HOUR = 9
const DIGEST_ALERT = "digest"
const AUTO_REJECT_NOTE = "逾期未修改"

export type RetentionJobDeps = {
  store: ApplicationStore
  clock: Clock
  retention: RetentionPolicy
  composer: MailComposer
  authority: ProcessorAuthority
  notifier: ChangeNotifier
  tracer: Tracer
}

/** The UTC instant at which `now`'s Taipei calendar day began. */
function taipeiDayStart(now: Date): Date {
  const local = now.getTime() + TAIPEI_OFFSET
  return new Date(local - (((local % DAY) + DAY) % DAY) - TAIPEI_OFFSET)
}

/**
 * The hourly housekeeping. Each item runs in its own transaction on at most
 * `BATCH` rows; one failing never stops the others, and `tick` throws once
 * at the end if any did. Do not call a second tick while one runs.
 */
export class RetentionJob {
  constructor(private readonly d: RetentionJobDeps) {}

  async tick(): Promise<void> {
    const now = this.d.clock.now()
    const items: [string, (uow: UnitOfWork) => Promise<number>][] = [
      ["delete unverified", (uow) => this.deleteUnverified(uow, now)],
      ["delete verify tokens", (uow) => this.deleteVerifyTokens(uow, now)],
      ["auto reject", (uow) => this.autoReject(uow, now)],
      ["purge", (uow) => this.purge(uow, now)],
      ["delete mail log", (uow) => this.deleteMailLog(uow, now)],
      ["digest", (uow) => this.digest(uow, now)],
    ]
    let wrote = false
    const failures: unknown[] = []
    for (const [name, work] of items) {
      try {
        const count = await this.d.tracer.span(`retention ${name}`, {}, () =>
          this.d.store.transaction(work)
        )
        if (count > 0) wrote = true
      } catch (error) {
        failures.push(error)
      }
    }
    // Announce first: what committed is real even when another item failed.
    if (wrote) await this.d.notifier.changed()
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, "retention items failed")
    }
  }

  private async deleteUnverified(uow: UnitOfWork, now: Date) {
    const ids = await uow.staleUnverified(
      this.d.retention.verifyCutoff(now),
      BATCH
    )
    for (const id of ids) await uow.delete(id)
    return ids.length
  }

  private deleteVerifyTokens(uow: UnitOfWork, now: Date) {
    return uow.deleteVerifyTokens(this.d.retention.verifyCutoff(now), BATCH)
  }

  private async autoReject(uow: UnitOfWork, now: Date) {
    const ids = await uow.overdueChangeRequests(
      this.d.retention.autoRejectCutoff(now),
      BATCH
    )
    let done = 0
    for (const id of ids) {
      const application = await uow.lock(id)
      if (!application) continue
      const t = application.reject(AUTO_REJECT_NOTE, SYSTEM, now)
      if (t.kind !== "changed") continue
      if ((await uow.save(t)) !== "ok") {
        throw new Error(`application ${id} could not be saved`)
      }
      await uow.queueMail(
        id,
        this.d.composer.rejected(t.next, AUTO_REJECT_NOTE)
      )
      done += 1
    }
    return done
  }

  private async purge(uow: UnitOfWork, now: Date) {
    const ids = await uow.purgeDue(this.d.retention.purgeCutoff(now), BATCH)
    let done = 0
    for (const id of ids) {
      const application = await uow.lock(id)
      if (!application) continue
      const t = application.purge(now)
      if (t.kind !== "changed") continue
      if ((await uow.save(t)) !== "ok") {
        throw new Error(`application ${id} could not be saved`)
      }
      await uow.purge(id, now)
      done += 1
    }
    return done
  }

  private deleteMailLog(uow: UnitOfWork, now: Date) {
    return uow.deleteMailLog(this.d.retention.mailLogCutoff(now))
  }

  /** At most one digest per Taipei day, from 09:00; names no applicant. */
  private async digest(uow: UnitOfWork, now: Date) {
    const dayStart = taipeiDayStart(now)
    if (now.getTime() - dayStart.getTime() < DIGEST_HOUR * HOUR) return 0
    const waiting = await uow.awaitingReview(this.d.retention.digestCutoff(now))
    if (waiting === 0) return 0
    const to = [...new Set(await this.d.authority.processorEmails())]
    if (to.length === 0) return 0
    if (!(await uow.claimAlert(DIGEST_ALERT, dayStart, now))) return 0
    for (const address of to) {
      await uow.queueMail(null, this.d.composer.digest(address, waiting))
    }
    return to.length
  }
}
