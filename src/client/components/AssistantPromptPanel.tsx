interface AssistantPromptPanelProps {
  disabled: boolean;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  prompt: string;
}

/** Renders the standard assistant prompt form. */
export const AssistantPromptPanel = ({ disabled, onPromptChange, onSubmit, prompt }: AssistantPromptPanelProps) => (
  <section className="panel" aria-labelledby="assistant-heading">
    <h2 id="assistant-heading">Assistant</h2>
    <textarea
      value={prompt}
      onChange={(event) => onPromptChange(event.currentTarget.value)}
      placeholder="Ask about Eberron lore, campaign notes, PDFs, or articles."
      disabled={disabled}
      title="Ask a grounded assistant question using the configured corpus and additional context."
    />
    <button
      type="button"
      onClick={onSubmit}
      disabled={disabled || prompt.trim().length === 0}
      title="Submit this prompt to the assistant."
    >
      Ask
    </button>
  </section>
);
