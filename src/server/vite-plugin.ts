import type { ServerResponse } from "node:http";

import type { Plugin } from "vite";

import { formatThrownValue } from "../errors.js";
import { createWebApp, isBusyError, isWebOperationError, type WebApp } from "./v1/app.js";
import { handleV1ApiRequest } from "./v1/api.js";
import { handleV2ApiRequest } from "./v2/api.js";

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

        const url = new URL(request.url, "http://localhost");

        const handler = url.pathname.startsWith("/api/v1/")
          ? () => handleV1ApiRequest(getApp(), request, response)
          : url.pathname.startsWith("/api/v2/")
            ? () => handleV2ApiRequest(request, response)
            : null;

        if (!handler) {
          writeJson(response, 404, { error: "Unknown API route." });
          return;
        }

        void Promise.resolve(handler())
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

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};
