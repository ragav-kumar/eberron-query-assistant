import type { KeyboardEvent, SubmitEvent } from 'react';

interface AssistantPromptPanelProps {
  disabled: boolean;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  prompt: string;
}

/** Renders the standard assistant prompt form. */
export const AssistantPromptPanel = ({ disabled, onPromptChange, onSubmit, prompt }: AssistantPromptPanelProps) => {
  const submitPrompt = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <form className='panel' aria-labelledby='assistant-heading' onSubmit={submitPrompt}>
      <h2 id='assistant-heading'>Assistant</h2>
      <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
          placeholder='Ask about Eberron lore, campaign notes, PDFs, or articles.'
          disabled={disabled}
          title='Ask a grounded assistant question using the configured corpus and additional context.'
      />
      <button type='submit' disabled={disabled || prompt.trim().length === 0} title='Submit this prompt to the assistant.'>
        Ask
      </button>
    </form>
  );
};
