import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { App } from './App.js';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing root element.');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<h1>Something went wrong!</h1>}>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
