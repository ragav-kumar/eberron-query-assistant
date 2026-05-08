interface AppHeaderProps {
  isBusy: boolean;
  onRefresh: (forceReingest: boolean) => void;
  operation: string | null;
}

/** Renders the application title, status, and corpus refresh controls. */
export const AppHeader = ({ isBusy, operation, onRefresh }: AppHeaderProps) => (
  <header className="app-header">
    <div>
      <h1>Eberron Query Assistant</h1>
      <p>{isBusy ? `Running ${operation ?? "operation"}` : "Ready"}</p>
    </div>
    <div className="actions">
      <button
        type="button"
        onClick={() => onRefresh(false)}
        disabled={isBusy}
        title="Check sources and update retrieval artifacts only where needed."
      >
        Refresh
      </button>
      <button
        type="button"
        className="danger"
        onClick={() => onRefresh(true)}
        disabled={isBusy && operation !== "startup-refresh"}
        title={
          isBusy && operation === "startup-refresh"
            ? "Cancel startup refresh and rebuild app-owned corpus and retrieval artifacts."
            : "Clear and rebuild app-owned corpus and retrieval artifacts."
        }
      >
        Force reingest
      </button>
    </div>
  </header>
);
