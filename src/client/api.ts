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

export interface ApiStatus {
  busy: boolean;
  operation: string | null;
}

export interface ApiOperationResult {
  console: ApiConsole;
  log: ApiLog;
  ok: true;
}

export const getStatus = async (): Promise<ApiStatus> => {
  return requestJson<ApiStatus>("/api/status");
};

export const getLog = async (filePath?: string): Promise<ApiLog> => {
  const query = filePath === undefined ? "" : `?filePath=${encodeURIComponent(filePath)}`;
  return requestJson<ApiLog>(`/api/log${query}`);
};

export const getConsole = async (): Promise<ApiConsole> => {
  return requestJson<ApiConsole>("/api/console");
};

export const getContext = async (): Promise<string> => {
  const response = await requestJson<{ markdown: string }>("/api/context");
  return response.markdown;
};

export const writeContext = async (markdown: string): Promise<void> => {
  await requestJson<{ ok: true }>("/api/context", {
    method: "PUT",
    body: JSON.stringify({ markdown })
  });
};

export const askAssistant = async (prompt: string): Promise<ApiOperationResult> => {
  return requestJson<ApiOperationResult>("/api/assistant", {
    method: "POST",
    body: JSON.stringify({ prompt })
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

export const startNewLogSession = async (): Promise<ApiLog> => {
  return requestJson<ApiLog>("/api/log/session", {
    method: "POST"
  });
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
    throw new Error(readErrorMessage(body));
  }

  return body as T;
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
