export interface TaggedError {
  kind: string;
  message: string;
  name: string;
}

export function createTaggedError(kind: string, message: string): TaggedError {
  return {
    kind,
    message,
    name: kind
  };
}

export function formatThrownValue(value: unknown): string {
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }

  return String(value);
}

export function hasErrorCode(value: unknown, code: string): boolean {
  return isRecord(value) && value.code === code;
}

export function hasErrorName(value: unknown, name: string): boolean {
  return isRecord(value) && value.name === name;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
