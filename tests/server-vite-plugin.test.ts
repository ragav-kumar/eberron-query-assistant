import { beforeEach, describe, expect, it, vi } from "vitest";

const handleV1ApiRequest = vi.fn();
const handleV2ApiRequest = vi.fn();
const createWebApp = vi.fn();

vi.mock("../src/server/v1/api.js", () => ({
  handleV1ApiRequest
}));

vi.mock("../src/server/v2/api.js", () => ({
  handleV2ApiRequest
}));

vi.mock("../src/server/v1/app.js", () => ({
  createWebApp,
  isBusyError: () => false,
  isWebOperationError: () => false
}));

describe("vite API plugin", () => {
  const startStartupRefresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createWebApp.mockReturnValue({
      startStartupRefresh
    });
    handleV1ApiRequest.mockResolvedValue(undefined);
    handleV2ApiRequest.mockResolvedValue(undefined);
  });

  it("dispatches /api/v1 requests to the v1 handler and lazily initializes the shared app", async () => {
    const { eberronApiPlugin } = await import("../src/server/vite-plugin.js");
    const middleware = getRegisteredMiddleware(eberronApiPlugin());
    const request = { url: "/api/v1/context", method: "GET" };
    const response = createResponse();

    middleware(request, response, vi.fn());
    await vi.waitFor(() => {
      expect(handleV1ApiRequest).toHaveBeenCalledTimes(1);
    });

    expect(createWebApp).toHaveBeenCalledTimes(1);
    expect(startStartupRefresh).toHaveBeenCalledTimes(1);
    expect(handleV1ApiRequest.mock.calls[0]?.[1]).toBe(request);
    expect(handleV2ApiRequest).not.toHaveBeenCalled();
  });

  it("dispatches /api/v2 requests to the v2 handler without creating the legacy app", async () => {
    const { eberronApiPlugin } = await import("../src/server/vite-plugin.js");
    const middleware = getRegisteredMiddleware(eberronApiPlugin());
    const request = { url: "/api/v2/context", method: "GET" };
    const response = createResponse();

    middleware(request, response, vi.fn());
    await vi.waitFor(() => {
      expect(handleV2ApiRequest).toHaveBeenCalledTimes(1);
    });

    expect(createWebApp).not.toHaveBeenCalled();
    expect(handleV1ApiRequest).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown /api prefixes", async () => {
    const { eberronApiPlugin } = await import("../src/server/vite-plugin.js");
    const middleware = getRegisteredMiddleware(eberronApiPlugin());
    const response = createResponse();

    middleware({ url: "/api/legacy", method: "GET" }, response, vi.fn());

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe(JSON.stringify({ error: "Unknown API route." }));
    expect(handleV1ApiRequest).not.toHaveBeenCalled();
    expect(handleV2ApiRequest).not.toHaveBeenCalled();
  });

  it("passes non-api requests through to the next middleware", async () => {
    const { eberronApiPlugin } = await import("../src/server/vite-plugin.js");
    const middleware = getRegisteredMiddleware(eberronApiPlugin());
    const next = vi.fn();

    middleware({ url: "/v2", method: "GET" }, createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(handleV1ApiRequest).not.toHaveBeenCalled();
    expect(handleV2ApiRequest).not.toHaveBeenCalled();
  });
});

const getRegisteredMiddleware = (
  plugin: { configureServer?: unknown }
): ((request: unknown, response: unknown, next: () => void) => void) => {
  let registered: ((request: unknown, response: unknown, next: () => void) => void) | null = null;
  const configureServer = plugin.configureServer;

  if (typeof configureServer !== "function") {
    throw new Error("Expected configureServer hook.");
  }

  const runConfigureServer = configureServer as (server: {
    middlewares: {
      use(fn: (request: unknown, response: unknown, next: () => void) => void): void;
    };
  }) => void;

  runConfigureServer({
    middlewares: {
      use(fn: (request: unknown, response: unknown, next: () => void) => void) {
        registered = fn;
      }
    }
  });

  const middleware = registered;

  if (!middleware) {
    throw new Error("Expected middleware registration.");
  }

  return middleware;
};

const createResponse = () => {
  const headers: Record<string, string> = {};
  return {
    body: "",
    headers,
    statusCode: 0,
    end(chunk?: string) {
      this.body = chunk ?? "";
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    }
  };
};
