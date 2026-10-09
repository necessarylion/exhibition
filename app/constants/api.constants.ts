export const API_PREFIX = "/api/v1";
export const OPENAPI_PATH = `${API_PREFIX}/openapi.json`;
export const DOCS_PATH = "/docs";
/** The script of the docs page. The version is fixed, so a new release cannot change what runs. */
export const DOCS_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1";
export const HEALTH_PATH = "/health";
export const BEARER_SCHEME = "Bearer" as const;
export const TOKEN_BYTES = 32;
/** How long an admin can act as a customer with one token. */
export const ACTING_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
/** The biggest JSON body the API reads. The photo upload has its own, bigger limit. */
export const MAX_JSON_BODY_BYTES = 100 * 1024;

export const ErrorCode = {
  ValidationFailed: "validation_failed",
  Unauthorized: "unauthorized",
  InvalidCredentials: "invalid_credentials",
  Forbidden: "forbidden",
  CompanyDisabled: "company_disabled",
  EmailTaken: "email_taken",
  CompanyNameTaken: "company_name_taken",
  GroupNameTaken: "group_name_taken",
  NotACustomer: "not_a_customer",
  AlreadyInGroup: "already_in_group",
  NotApproved: "not_approved",
  NotWhileActing: "not_while_acting",
  NotFound: "not_found",
  CannotRemoveOwner: "cannot_remove_owner",
  SkuTaken: "sku_taken",
  TooManyPhotos: "too_many_photos",
  NotEnoughStock: "not_enough_stock",
  ItemUnavailable: "item_unavailable",
  NothingToSend: "nothing_to_send",
  LineSent: "line_sent",
  ProjectClosed: "project_closed",
  InvalidStatus: "invalid_status",
  ProjectLocked: "project_locked",
  PricesChanged: "prices_changed",
  TooManyItems: "too_many_items",
  BadRequest: "bad_request",
  BodyTooLarge: "body_too_large",
  WrongPassword: "wrong_password",
  SamePassword: "same_password",
  TooManyRequests: "too_many_requests",
  Busy: "busy",
  InvalidFile: "invalid_file",
  FileTooLarge: "file_too_large",
  Internal: "internal_error",
} as const;
