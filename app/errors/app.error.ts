import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error with an HTTP status. The error handler turns it into a JSON response. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
