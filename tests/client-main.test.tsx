// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rootRender = vi.fn();

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({
    render: rootRender
  }))
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  rootRender.mockClear();
  vi.resetModules();
});

describe("client entry selection", () => {
  it("selects the current UI at root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const module = await import("../src/client/main.js");
    const { App } = await import("@/client/v1/App.js");

    await expect(module.resolveAppForPath("/")()).resolves.toBe(App);
  });

  it("selects the v2 stub at /v2", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const module = await import("../src/client/main.js");
    const { App } = await import("@/client/v2/App.js");

    await expect(module.resolveAppForPath("/v2")()).resolves.toBe(App);
  });

  it("selects the v2 stub at /v2/", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const module = await import("../src/client/main.js");
    const { App } = await import("@/client/v2/App.js");

    await expect(module.resolveAppForPath("/v2/")()).resolves.toBe(App);
  });

  it("renders into the provided root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const module = await import("../src/client/main.js");

    module.renderApp(document.getElementById("root") as HTMLElement, "/v2");

    await waitFor(() => {
      expect(rootRender).toHaveBeenCalledTimes(2);
    });
  });
});
