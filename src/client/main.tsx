import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { V2App } from "./v2/V2App.js";

export const resolveAppForPath = (pathname: string) => {
  return pathname === "/v2" || pathname === "/v2/" ? V2App : App;
};

export const renderApp = (root: HTMLElement, pathname: string) => {
  const ActiveApp = resolveAppForPath(pathname);
  createRoot(root).render(
    <StrictMode>
      <ActiveApp />
    </StrictMode>
  );
};

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element.");
}

renderApp(root, window.location.pathname);
