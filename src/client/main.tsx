import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { V1App } from "./v1/V1App.js";
import { V2App } from "./v2/V2App.js";

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
