import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as V1App } from "./v1/App.js";
import { App as V2App } from "./v2/App.js";

export const resolveAppForPath = (pathname: string) => {
  return pathname.includes('v2') ? V2App : V1App;
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
