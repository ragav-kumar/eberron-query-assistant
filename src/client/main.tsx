import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";

const loadV1App = async (): Promise<ComponentType> => {
  const module = await import("./v1/App.js");
  return module.App;
};

const loadV2App = async (): Promise<ComponentType> => {
  const module = await import("./v2/App.js");
  return module.App;
};

export const resolveAppForPath = (pathname: string) => {
  return pathname.includes("v2") ? loadV2App : loadV1App;
};

export const renderApp = (root: HTMLElement, pathname: string) => {
  void resolveAppForPath(pathname)().then((ActiveApp) => {
    createRoot(root).render(
      <StrictMode>
        <ActiveApp />
      </StrictMode>
    );
  });
};

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element.");
}

renderApp(root, window.location.pathname);
