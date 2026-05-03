import type { KeyboardEvent, SubmitEvent } from "react";

interface DebugQueryPanelProps {
  disabled: boolean;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  query: string;
}

/** Renders the retrieval debug input that sends results to the local Console tab. */
export const DebugQueryPanel = ({ disabled, onQueryChange, onSubmit, query }: DebugQueryPanelProps) => {
  const submitQuery = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <form className="panel compact" aria-labelledby="debug-heading" onSubmit={submitQuery}>
      <h2 id="debug-heading">Debug Retrieval</h2>
      <div className="inline-form">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
          placeholder="aerenal deathless"
          disabled={disabled}
          title="Run this text directly against the retrieval layer."
        />
        <button
          type="submit"
          disabled={disabled || query.trim().length === 0}
          title="Run retrieval debugging and write the results to Console."
        >
          Run
        </button>
      </div>
    </form>
  );
};
