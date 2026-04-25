export interface TaggedError {
  kind: string;
  message: string;
  name: string;
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

export const hasErrorCode = (value: unknown, code: string): boolean => {
  return isRecord(value) && value.code === code;
};

export const hasErrorName = (value: unknown, name: string): boolean => {
  return isRecord(value) && value.name === name;
};

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
