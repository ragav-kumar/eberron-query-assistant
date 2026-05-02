interface DebugQueryPanelProps {
  disabled: boolean;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  query: string;
}

/** Renders the retrieval debug input that sends results to the local Console tab. */
export const DebugQueryPanel = ({ disabled, onQueryChange, onSubmit, query }: DebugQueryPanelProps) => (
  <section className="panel compact" aria-labelledby="debug-heading">
    <h2 id="debug-heading">Debug Retrieval</h2>
    <div className="inline-form">
      <input
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        placeholder="aerenal deathless"
        disabled={disabled}
        title="Run this text directly against the retrieval layer."
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || query.trim().length === 0}
        title="Run retrieval debugging and write the results to Console."
      >
        Run
      </button>
    </div>
  </section>
);
