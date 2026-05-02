import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { formatThrownValue } from "../errors.js";
import { createWebApp, isBusyError, type WebApp } from "./app.js";

export const eberronApiPlugin = (): Plugin => {
  let app: WebApp | null = null;

  const getApp = (): WebApp => {
    app ??= createWebApp();
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
              ...(isBusyError(error) ? { operation: error.operation } : {})
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

  if (request.method === "GET" && url.pathname === "/api/status") {
    writeJson(response, 200, app.getStatus());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/log") {
    writeJson(response, 200, await app.getLog(url.searchParams.get("filePath") ?? undefined));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/log/session") {
    writeJson(response, 200, await app.startNewSession());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/console") {
    writeJson(response, 200, app.getConsole());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/context") {
    writeJson(response, 200, { markdown: await app.getContext() });
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
    writeJson(response, 200, await app.askAssistant(readStringField(body, "prompt")));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/debug-retrieval") {
    const body = await readJsonBody(request);
    writeJson(response, 200, await app.debugRetrieval(readStringField(body, "query")));
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

const readBooleanField = (body: unknown, field: string): boolean => {
  if (!isRecord(body) || typeof body[field] !== "boolean") {
    return false;
  }

  return body[field];
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};
