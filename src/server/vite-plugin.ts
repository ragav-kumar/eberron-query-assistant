import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { formatThrownValue } from "../errors.js";
import { createWebApp, isBusyError, isWebOperationError, type WebApp } from "./app.js";

export const eberronApiPlugin = (): Plugin => {
  let app: WebApp | null = null;

  const getApp = (): WebApp => {
    if (!app) {
      app = createWebApp();
      app.startStartupRefresh();
    }
    return app;
  };

  return {
    name: "eberron-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/")) {
          next();
          return;
        }

        void handleApiRequest(getApp(), request, response)
          .catch((error: unknown) => {
            writeJson(response, isBusyError(error) ? 409 : 500, {
              error: formatThrownValue(error),
              ...(isBusyError(error) ? { operation: error.operation } : {}),
              ...(isWebOperationError(error) ? {
                console: error.console,
                ...(error.providerDebug ? { providerDebug: error.providerDebug } : {})
              } : {})
            });
          });
      });
    }
  };
};

const handleApiRequest = async (
  app: WebApp,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/console/events") {
    writeConsoleEvents(app, request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/log") {
    const filePath = url.searchParams.get("filePath");
    writeJson(response, 200, await app.getLog({
      ...(filePath === null ? {} : { filePath }),
      sessionId: url.searchParams.get("sessionId") ?? ""
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/context") {
    writeJson(response, 200, { markdown: await app.getContext() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/npcs") {
    writeJson(response, 200, await app.getNpcs());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    writeJson(response, 200, await app.getStatus({
      sessionId: url.searchParams.get("sessionId") ?? ""
    }));
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/context") {
    const body = await readJsonBody(request);
    await app.writeContext(readStringField(body, "markdown"));
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/assistant") {
    const body = await readJsonBody(request);
    writeJson(response, 200, await app.askAssistant(
      readStringField(body, "prompt"),
      readOptionalStringField(body, "sessionId"),
      readOptionalBooleanField(body, "includePartyContext", true),
      readOptionalNumberField(body, "retrievalTurnLimit", 1)
    ));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/npcs") {
    const body = await readJsonBody(request);
    writeJson(response, 200, await app.generateNpcs(
      readStringField(body, "prompt"),
      readOptionalStringField(body, "sessionId"),
      readOptionalBooleanField(body, "includePartyContext", true),
      readOptionalNumberField(body, "retrievalTurnLimit", 1)
    ));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/refresh") {
    const body = await readJsonBody(request);
    writeJson(response, 200, await app.refresh(readBooleanField(body, "forceReingest")));
    return;
  }

  writeJson(response, 404, { error: "Unknown API route." });
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const readStringField = (body: unknown, field: string): string => {
  if (!isRecord(body) || typeof body[field] !== "string") {
    throw new Error(`Expected JSON string field: ${field}.`);
  }

  return body[field];
};

const readOptionalStringField = (body: unknown, field: string): string => {
  if (!isRecord(body) || body[field] === undefined) {
    return "";
  }
  if (typeof body[field] === "string") {
    return body[field];
  }

  throw new Error(`Expected JSON string field: ${field}.`);
};

const readBooleanField = (body: unknown, field: string): boolean => {
  if (!isRecord(body) || typeof body[field] !== "boolean") {
    return false;
  }

  return body[field];
};

const readOptionalBooleanField = (body: unknown, field: string, defaultValue: boolean): boolean => {
  if (!isRecord(body) || body[field] === undefined) {
    return defaultValue;
  }
  if (typeof body[field] === "boolean") {
    return body[field];
  }

  throw new Error(`Expected JSON boolean field: ${field}.`);
};

const readOptionalNumberField = (body: unknown, field: string, defaultValue: number): number => {
  if (!isRecord(body) || body[field] === undefined) {
    return defaultValue;
  }
  if (typeof body[field] === "number" && Number.isFinite(body[field])) {
    return body[field];
  }

  throw new Error(`Expected JSON number field: ${field}.`);
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const writeConsoleEvents = (app: WebApp, request: IncomingMessage, response: ServerResponse): void => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();
  response.write(": connected\n\n");

  const unsubscribe = app.subscribeConsole((entry) => {
    response.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  request.on("close", () => {
    unsubscribe();
    response.end();
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};
