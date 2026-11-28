import type { StepFailure } from "../domain/provisioning-run"

const RETRY_LATER = "暫時無法完成，稍後自動重試"

/**
 * How a step fails. `blocked` reasons are Chinese text the portal wrote for
 * a processor; any other exception becomes a retry and its own text never
 * reaches the reason.
 */
export class StepError extends Error implements StepFailure {
  readonly blocked: boolean
  readonly reason: string

  private constructor(blocked: boolean, reason: string) {
    super(reason)
    this.name = "StepError"
    this.blocked = blocked
    this.reason = reason
  }

  static retry(reason: string): StepError {
    return new StepError(false, reason)
  }

  static blocked(reason: string): StepError {
    return new StepError(true, reason)
  }

  static from(error: unknown): StepError {
    return error instanceof StepError ? error : StepError.retry(RETRY_LATER)
  }
}
