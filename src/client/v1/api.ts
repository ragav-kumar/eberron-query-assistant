/**
 * Browser-side client for the local Node/Vite runtime exposed under `/api/v1/*`.
 *
 * This module is the intended boundary between React UI code and the non-React
 * runtime. UI code should treat these functions as the contract for reading
 * persisted state, starting server-owned operations, and subscribing to the
 * transient Console stream.
 *
 * Data model notes for UI work:
 * - `ApiLog` is persisted Standard assistant transcript data. It may represent
 *   the active writable session or a read-only historical log selected by path.
 * - `ApiNpcResponse` is persisted generated NPC state, independent of the
 *   current prompt mode or current assistant session.
 * - `ApiConsole` is transient process-local operational output. It is not a
 *   transcript and is not recovered across server restarts.
 * - `ApiStatus` is a snapshot used to recover browser state after reloads or to
 *   discover any server-owned operation that is already in progress.
 *
 * Session id expectations:
 * - `askAssistant`, `getLog`, and `getStatus` use the Standard assistant
 *   session id owned by the browser UI.
 * - `generateNpcs` uses the NPC generation session id owned by the browser UI.
 * - The runtime uses those ids to keep browser-owned session state separate; it
 *   does not derive them from URL state or server-side user identity.
 *
 * Error behavior:
 * - All request helpers throw on non-2xx responses.
 * - When the server includes Console output or provider diagnostics in an error
 *   response, `requestJson` attaches them to the thrown `ApiRequestError`.
 * - `isApiRequestError` is the supported guard when UI code wants to recover
 *   streamed Console state from a failed request without treating every error as
 *   a plain string message.
 */
export interface ApiLog {
  activeFilePath: string | null;
  exchanges: ApiLogEntry[];
  files: ApiLogFile[];
  filePath: string | null;
  readOnly: boolean;
}

export interface ApiLogExchange {
  assistant: string;
  kind: "exchange";
  title: string;
  user: string;
}

export interface ApiLogProgress {
  kind: "progress";
  message: string;
}

export type ApiLogEntry = ApiLogExchange | ApiLogProgress;

export interface ApiLogFile {
  active: boolean;
  filePath: string;
  label: string;
}

export interface ApiNpc {
  age?: string;
  bio: string;
  createdAt?: string;
  description: string;
  ethnicity?: string;
  gender?: string;
  id: number;
  name: string;
  role?: string;
  species?: string;
  updatedAt?: string;
}

export interface ApiNpcResponse {
  npcs: ApiNpc[];
}

export type ApiConsoleLevel = "debug" | "error" | "info" | "warn";

export interface ApiConsoleEntry {
  id: string;
  level: ApiConsoleLevel;
  message: string;
  timestamp: string;
}

export interface ApiConsole {
  entries: ApiConsoleEntry[];
}

export interface ApiProviderDebugEntry {
  assistantContent?: string;
  endpoint: string;
  error?: string;
  ok: boolean;
  operation: string;
  operationId: string;
  purpose: string;
  requestBody: {
    messages: unknown[];
    model: string;
    tools?: unknown[];
  };
  responseBody?: unknown;
  status?: number;
  timestamp: string;
}

export interface ApiOperationResult {
  console: ApiConsole;
  log: ApiLog;
  npcs: ApiNpcResponse;
  ok: true;
  providerDebug?: ApiProviderDebugEntry[];
}

export interface ApiStatus {
  activeOperation: string | null;
  console: ApiConsole;
  log: ApiLog;
  npcs: ApiNpcResponse;
}

/** Reads a Standard assistant transcript snapshot for the given browser-owned session id. */
export const getLog = async (options: { filePath?: string; sessionId: string }): Promise<ApiLog> => {
  const params = new URLSearchParams({ sessionId: options.sessionId });
  if (options.filePath !== undefined) {
    params.set("filePath", options.filePath);
  }
  const query = `?${params.toString()}`;
  return requestJson<ApiLog>(`/api/v1/log${query}`);
};

/** Reads the current contents of `assistant/additional-context.md` as markdown text. */
export const getContext = async (): Promise<string> => {
  const response = await requestJson<{ markdown: string }>("/api/v1/context");
  return response.markdown;
};

/** Reads the currently persisted generated NPC collection. */
export const getNpcs = async (): Promise<ApiNpcResponse> => {
  return requestJson<ApiNpcResponse>("/api/v1/npcs");
};

/** Reads the current process snapshot, including active operation, Console replay, log, and NPC state. */
export const getStatus = async (options: { sessionId: string }): Promise<ApiStatus> => {
  const params = new URLSearchParams({ sessionId: options.sessionId });
  return requestJson<ApiStatus>(`/api/v1/status?${params.toString()}`);
};

/** Persists the browser-edited additional context markdown back to local disk. */
export const writeContext = async (markdown: string): Promise<void> => {
  await requestJson<{ ok: true }>("/api/v1/context", {
    method: "PUT",
    body: JSON.stringify({ markdown })
  });
};

/** Starts one Standard assistant operation and returns updated Console, log, and NPC snapshots when it completes. */
export const askAssistant = async (
  prompt: string,
  sessionId: string,
  includePartyContext: boolean,
  retrievalTurnLimit: number
): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/v1/assistant", {
    method: "POST",
    body: JSON.stringify({ prompt, sessionId, includePartyContext, retrievalTurnLimit })
  });
};

/** Starts one NPC generation operation and returns updated Console, log, and persisted NPC snapshots when it completes. */
export const generateNpcs = async (
  prompt: string,
  sessionId: string,
  includePartyContext: boolean,
  retrievalTurnLimit: number
): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/v1/npcs", {
    method: "POST",
    body: JSON.stringify({ prompt, sessionId, includePartyContext, retrievalTurnLimit })
  });
};

/** Starts a routine refresh or explicit force reingest against the local corpus and retrieval artifacts. */
export const refresh = async (forceReingest: boolean): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/v1/refresh", {
    method: "POST",
    body: JSON.stringify({ forceReingest })
  });
};

/**
 * Subscribes to transient process-local Console events via Server-Sent Events.
 *
 * This stream is operational output, not transcript history. A new browser
 * subscriber can receive replayed in-memory entries from the current server
 * process, but the stream is intentionally lost if that local server process is
 * restarted.
 */
export const subscribeConsole = (onEntry: (entry: ApiConsoleEntry) => void): (() => void) => {
  if (typeof EventSource === "undefined") {
    return () => undefined;
  }

  const events = new EventSource("/api/v1/console/events");
  events.onmessage = (event) => {
    if (typeof event.data === "string") {
      onEntry(JSON.parse(event.data) as ApiConsoleEntry);
    }
  };
  return () => {
    events.close();
  };
};

/** Issues a JSON request and throws an enriched error when the local runtime responds with a failure status. */
const requestJson = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    const error = new Error(readErrorMessage(body)) as ApiRequestError;
    const console = readErrorConsole(body);
    if (console) {
      error.console = console;
    }
    const providerDebug = readProviderDebug(body);
    if (providerDebug) {
      error.providerDebug = providerDebug;
    }
    throw error;
  }

  return body as T;
};

export interface ApiRequestError extends Error {
  console?: ApiConsole;
  providerDebug?: ApiProviderDebugEntry[];
}

/** Narrows an unknown thrown value to the enriched API error shape used by `requestJson`. */
export const isApiRequestError = (error: unknown): error is ApiRequestError => {
  return error instanceof Error && "console" in error;
};

const readErrorMessage = (body: unknown): string => {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }

  return "Request failed.";
};

const readErrorConsole = (body: unknown): ApiConsole | undefined => {
  if (
    typeof body === "object" &&
    body !== null &&
    "console" in body &&
    typeof body.console === "object" &&
    body.console !== null &&
    "entries" in body.console &&
    Array.isArray(body.console.entries)
  ) {
    return body.console as ApiConsole;
  }

  return undefined;
};

const readProviderDebug = (body: unknown): ApiProviderDebugEntry[] | undefined => {
  if (
    typeof body === "object" &&
    body !== null &&
    "providerDebug" in body &&
    Array.isArray(body.providerDebug)
  ) {
    return body.providerDebug as ApiProviderDebugEntry[];
  }

  return undefined;
};
