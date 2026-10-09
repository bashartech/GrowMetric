export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  BAD_REQUEST: 400,
  FILE_TOO_LARGE: 400,
  FILE_TYPE_UNSUPPORTED: 400,
  FILE_EMPTY: 400,
  UPLOAD_INVALID: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  // 402 Payment Required: the caller is authenticated and authorized, but the
  // plan does not cover the resource. 403 implies a permission problem the user
  // cannot fix by changing who they are.
  ENTITLEMENT_REQUIRED: 402,
  NOT_FOUND: 404,
  EMAIL_IN_USE: 409,
  CONFLICT: 409,
  DATA_SOURCE_CONFLICT: 409,
  EXT_DB_CONNECTION_FAILED: 422,
  EXT_DB_NOT_READ_ONLY: 422,
  IMPORT_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "The request contains invalid input.",
  BAD_REQUEST: "The request could not be processed.",
  FILE_TOO_LARGE: "The uploaded file exceeds the size limit.",
  FILE_TYPE_UNSUPPORTED: "The file type is not supported.",
  FILE_EMPTY: "The uploaded file is empty.",
  UPLOAD_INVALID: "The upload could not be processed.",
  UNAUTHENTICATED: "Authentication is required.",
  FORBIDDEN: "You do not have permission to perform this action.",
  ENTITLEMENT_REQUIRED: "Your plan does not include this capability. Upgrade to continue.",
  NOT_FOUND: "The requested resource was not found.",
  EMAIL_IN_USE: "An account with this email already exists.",
  CONFLICT: "The request conflicts with the current state.",
  DATA_SOURCE_CONFLICT: "The data source is not in a valid state for this operation.",
  EXT_DB_CONNECTION_FAILED: "Could not connect to the external database.",
  EXT_DB_NOT_READ_ONLY: "The external database connection must be read-only.",
  IMPORT_FAILED: "The import could not be processed.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export const badRequest = (message?: string, details?: unknown) =>
  new AppError("BAD_REQUEST", message, details);

export const unauthorized = (message?: string) =>
  new AppError("UNAUTHENTICATED", message);

export const forbidden = (message?: string) => new AppError("FORBIDDEN", message);

export const notFound = (message?: string) => new AppError("NOT_FOUND", message);

export const conflict = (code: ErrorCode = "CONFLICT", message?: string) =>
  new AppError(code, message);

export const entitlementRequired = (message?: string, details?: unknown) =>
  new AppError("ENTITLEMENT_REQUIRED", message, details);
