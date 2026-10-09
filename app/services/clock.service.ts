import { singleton } from "tsyringe";

/** The time of now. A test puts its own clock in, so it can move the time. */
@singleton()
export class Clock {
  private last = 0;

  now(): number {
    return Date.now();
  }

  /**
   * The time of now as an ISO string, for a `created_at`.
   * Two calls never give the same value, and a later call gives a later value.
   * So rows that are made in the same millisecond still sort in the order they were made.
   */
  timestamp(): string {
    this.last = Math.max(this.now(), this.last + 1);
    return new Date(this.last).toISOString();
  }
}
