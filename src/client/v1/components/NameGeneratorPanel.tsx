import type { KeyboardEvent, SubmitEvent } from 'react';

interface NameGeneratorPanelProps {
  disabled: boolean;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  prompt: string;
}

/** Renders the NPC generator prompt form. */
export const NameGeneratorPanel = ({ disabled, onPromptChange, onSubmit, prompt }: NameGeneratorPanelProps) => {
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
    <form className='panel' aria-labelledby='name-generator-heading' onSubmit={submitPrompt}>
      <h2 id='name-generator-heading'>NPC Generator</h2>
      <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          onKeyDown={submitOnEnter}
          placeholder='Generate three Aundairian goblin NPCs for a border town.'
          disabled={disabled}
          title='Generate Eberron-appropriate NPC names, descriptions, and short bios.'
      />
      <button
          type='submit'
          disabled={disabled || prompt.trim().length === 0}
          title='Generate NPC cards from this prompt.'
      >
        Generate
      </button>
    </form>
  );
};
