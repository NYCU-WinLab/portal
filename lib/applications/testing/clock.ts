import type { Clock } from "../ports"
import { NOW } from "./fixtures"

export class FixedClock implements Clock {
  private at: Date
  constructor(start: Date = NOW) {
    this.at = new Date(start.getTime())
  }
  now(): Date {
    return new Date(this.at.getTime())
  }
  advance(ms: number): void {
    this.at = new Date(this.at.getTime() + ms)
  }
  set(at: Date): void {
    this.at = new Date(at.getTime())
  }
}
