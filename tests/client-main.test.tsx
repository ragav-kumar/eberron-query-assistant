// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rootRender = vi.fn();

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({
    render: rootRender
  }))
}));

vi.mock("../src/client/App.js", () => ({
  App: () => <div>Current UI</div>
}));

vi.mock("../src/client/v2/V2App.js", () => ({
  V2App: () => <div>V2 UI Stub</div>
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
    const { V1App } = await import("../src/client/v1/V1App.js");

    expect(module.resolveAppForPath("/")).toBe(V1App);
  });

  it("selects the v2 stub at /v2", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const module = await import("../src/client/main.js");
    const { V2App } = await import("../src/client/v2/V2App.js");

    expect(module.resolveAppForPath("/v2")).toBe(V2App);
  });

  it("selects the v2 stub at /v2/", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const module = await import("../src/client/main.js");
    const { V2App } = await import("../src/client/v2/V2App.js");

    expect(module.resolveAppForPath("/v2/")).toBe(V2App);
  });

  it("renders into the provided root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const module = await import("../src/client/main.js");

    module.renderApp(document.getElementById("root") as HTMLElement, "/v2");

    expect(rootRender).toHaveBeenCalledTimes(2);
  });
});
