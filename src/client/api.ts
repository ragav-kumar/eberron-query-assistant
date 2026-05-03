export interface ApiLog {
  activeFilePath: string | null;
  files: ApiLogFile[];
  filePath: string | null;
  markdown: string;
  readOnly: boolean;
}

export interface ApiLogFile {
  active: boolean;
  filePath: string;
  label: string;
}

export interface ApiNpc {
  bio: string;
  createdAt?: string;
  description: string;
  id: number;
  name: string;
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

export interface ApiOperationResult {
  console: ApiConsole;
  log: ApiLog;
  npcs: ApiNpcResponse;
  ok: true;
}

export interface ApiStatus {
  activeOperation: string | null;
  console: ApiConsole;
  log: ApiLog;
  npcs: ApiNpcResponse;
}

export const getLog = async (options: { filePath?: string; sessionId: string }): Promise<ApiLog> => {
  const params = new URLSearchParams({ sessionId: options.sessionId });
  if (options.filePath !== undefined) {
    params.set("filePath", options.filePath);
  }
  const query = `?${params.toString()}`;
  return requestJson<ApiLog>(`/api/log${query}`);
};

export const getContext = async (): Promise<string> => {
  const response = await requestJson<{ markdown: string }>("/api/context");
  return response.markdown;
};

export const getNpcs = async (): Promise<ApiNpcResponse> => {
  return requestJson<ApiNpcResponse>("/api/npcs");
};

export const getStatus = async (options: { sessionId: string }): Promise<ApiStatus> => {
  const params = new URLSearchParams({ sessionId: options.sessionId });
  return requestJson<ApiStatus>(`/api/status?${params.toString()}`);
};

export const writeContext = async (markdown: string): Promise<void> => {
  await requestJson<{ ok: true }>("/api/context", {
    method: "PUT",
    body: JSON.stringify({ markdown })
  });
};

export const askAssistant = async (prompt: string, sessionId: string): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/assistant", {
    method: "POST",
    body: JSON.stringify({ prompt, sessionId })
  });
};

export const generateNpcs = async (prompt: string, sessionId: string): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/npcs", {
    method: "POST",
    body: JSON.stringify({ prompt, sessionId })
  });
};

export const debugRetrieval = async (query: string): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/debug-retrieval", {
    method: "POST",
    body: JSON.stringify({ query })
  });
};

export const refresh = async (forceReingest: boolean): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/refresh", {
    method: "POST",
    body: JSON.stringify({ forceReingest })
  });
};

export const subscribeConsole = (onEntry: (entry: ApiConsoleEntry) => void): (() => void) => {
  if (typeof EventSource === "undefined") {
    return () => undefined;
  }

  const events = new EventSource("/api/console/events");
  events.onmessage = (event) => {
    if (typeof event.data === "string") {
      onEntry(JSON.parse(event.data) as ApiConsoleEntry);
    }
  };
  return () => {
    events.close();
  };
};

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
    throw error;
  }

  return body as T;
};

export interface ApiRequestError extends Error {
  console?: ApiConsole;
}

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
