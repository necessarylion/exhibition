/** The time window of every attempt limit. */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** The limiter knows at most this many keys. When it is full, the oldest keys are dropped. */
export const RATE_LIMIT_MAX_KEYS = 100_000;
