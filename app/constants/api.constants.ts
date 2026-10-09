export const API_PREFIX = "/api/v1";
export const OPENAPI_PATH = `${API_PREFIX}/openapi.json`;
export const BEARER_SCHEME = "Bearer" as const;
export const TOKEN_BYTES = 32;

export const ErrorCode = {
  ValidationFailed: "validation_failed",
  Unauthorized: "unauthorized",
  InvalidCredentials: "invalid_credentials",
  EmailTaken: "email_taken",
  NotFound: "not_found",
  Internal: "internal_error",
} as const;
