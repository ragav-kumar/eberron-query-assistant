import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

const loadV2App = async (): Promise<ComponentType> => {
  const module = await import('./v2/App.js');
  return module.App;
};

export const resolveAppForPath = (_pathname: string) => loadV2App;

export const renderApp = (root: HTMLElement, pathname: string) => {
  void resolveAppForPath(pathname)().then((ActiveApp) => {
    createRoot(root).render(
      <StrictMode>
        <ErrorBoundary fallback={<h1>Something went wrong!</h1>}>
          <ActiveApp />
        </ErrorBoundary>
      </StrictMode>
    );
  });
};

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element.');
}

renderApp(root, window.location.pathname);
