import type { InputMode } from './ui-types.js';

interface InputModeSelectorProps {
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
}

const inputModeOptions: Array<{ label: string; mode: InputMode; title: string }> = [
  {
    label: 'Standard',
    mode: 'standard',
    title: 'Ask the assistant a normal grounded lore or campaign question.'
  },
  {
    label: 'NPC Generator',
    mode: 'name-generator',
    title: 'Generate NPC cards.'
  }
];

/** Lets the user choose which input workflow is rendered in the Input tab. */
export const InputModeSelector = ({ mode, onModeChange }: InputModeSelectorProps) => (
  <fieldset className='mode-selector' aria-label='Input mode'>
    <legend>Input Mode</legend>
    {inputModeOptions.map((option) => (
      <label key={option.mode} title={option.title}>
        <input
            type='radio'
            name='input-mode'
            value={option.mode}
            checked={mode === option.mode}
            onChange={() => onModeChange(option.mode)}
        />
        <span>{option.label}</span>
      </label>
    ))}
  </fieldset>
);
