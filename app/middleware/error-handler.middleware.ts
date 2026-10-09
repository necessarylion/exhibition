import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { singleton } from "tsyringe";
import type { ZodError } from "zod";
import { ErrorCode } from "../constants/api.constants";
import { AppError } from "../errors/app.error";

type ValidationResult = { success: true } | { success: false; error: ZodError };

@singleton()
export class ErrorHandler {
  /** Turns any thrown error into the JSON error shape. */
  handle(error: Error, c: Context): Response {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    console.error(error);
    return c.json({ error: { code: ErrorCode.Internal, message: "Something went wrong." } }, 500);
  }

  /** Runs after each schema check. Answers 422 when the input is not valid. */
  validation(result: ValidationResult, c: Context): Response | undefined {
    if (result.success) {
      return undefined;
    }
    const details = [];
    for (const issue of result.error.issues) {
      details.push({ path: issue.path.join("."), message: issue.message });
    }
    return c.json(
      { error: { code: ErrorCode.ValidationFailed, message: "The input is not valid.", details } },
      422,
    );
  }

  notFound(c: Context): Response {
    return c.json({ error: { code: ErrorCode.NotFound, message: "Not found." } }, 404);
  }
}
