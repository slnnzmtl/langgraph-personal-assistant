const TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_SOCKET",
]);

const TRANSPORT_ERROR_PATTERNS = [
  /fetch failed/i,
  /socket hang up/i,
  /network error/i,
  /connection (?:was )?closed/i,
  /connection reset/i,
  /broken pipe/i,
  /stream closed/i,
  /transport (?:is )?closed/i,
  /session (?:is )?closed/i,
  /aborted/i,
  /terminated unexpectedly/i,
];

const collectErrors = (error: unknown): unknown[] => {
  const errors: unknown[] = [];
  let current: unknown = error;

  while (current instanceof Error) {
    errors.push(current);
    current = current.cause;
  }

  if (errors.length === 0 && error !== undefined) {
    errors.push(error);
  }

  return errors;
};

const hasTransportErrorCode = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  return TRANSPORT_ERROR_CODES.has(code);
};

const hasTransportErrorMessage = (error: unknown): boolean => {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";

  return TRANSPORT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const isTransportError = (error: unknown): boolean =>
  collectErrors(error).some((entry) => hasTransportErrorCode(entry) || hasTransportErrorMessage(entry));
