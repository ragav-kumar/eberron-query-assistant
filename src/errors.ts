export interface TaggedError {
  kind: string;
  message: string;
  name: string;
}

export interface OperationAbortedError extends TaggedError {
  kind: "operation-aborted";
  name: "operation-aborted";
}

export const createTaggedError = (kind: string, message: string): TaggedError => {
  return {
    kind,
    message,
    name: kind
  };
};

export const formatThrownValue = (value: unknown): string => {
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }

  return String(value);
};

export const throwIfAborted = (signal: AbortSignal | undefined, message = "Operation was canceled."): void => {
  if (signal?.aborted) {
    throw createTaggedError("operation-aborted", message);
  }
};

export const isOperationAbortedError = (value: unknown): value is OperationAbortedError => {
  return isRecord(value) && value.kind === "operation-aborted";
};

export const hasErrorCode = (value: unknown, code: string): boolean => {
  return isRecord(value) && value.code === code;
};

export const hasErrorName = (value: unknown, name: string): boolean => {
  return isRecord(value) && value.name === name;
};

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
