import { AdditionalContextPanel } from "./AdditionalContextPanel.js";
import { AssistantPromptPanel } from "./AssistantPromptPanel.js";
import { InputModeSelector } from "./InputModeSelector.js";
import { NameGeneratorPanel } from "./NameGeneratorPanel.js";
import type { InputMode, LeftTab } from "./ui-types.js";

interface LeftInputColumnProps {
  assistantPrompt: string;
  contextLoaded: boolean;
  contextMarkdown: string;
  contextSaveState: string;
  includePartyContext: boolean;
  inputMode: InputMode;
  isBusy: boolean;
  leftTab: LeftTab;
  nameGeneratorPrompt: string;
  onAssistantPromptChange: (prompt: string) => void;
  onContextChange: (markdown: string) => void;
  onIncludePartyContextChange: (includePartyContext: boolean) => void;
  onInputModeChange: (mode: InputMode) => void;
  onLeftTabChange: (tab: LeftTab) => void;
  onNameGeneratorPromptChange: (prompt: string) => void;
  onRetrievalTurnLimitChange: (retrievalTurnLimit: number) => void;
  onSubmitAssistant: () => void;
  onSubmitNameGenerator: () => void;
  retrievalTurnLimit: number;
}

/** Owns the left-side input tabs and renders the active input or context editor surface. */
export const LeftInputColumn = ({
  assistantPrompt,
  contextLoaded,
  contextMarkdown,
  contextSaveState,
  includePartyContext,
  inputMode,
  isBusy,
  leftTab,
  nameGeneratorPrompt,
  onAssistantPromptChange,
  onContextChange,
  onIncludePartyContextChange,
  onInputModeChange,
  onLeftTabChange,
  onNameGeneratorPromptChange,
  onRetrievalTurnLimitChange,
  onSubmitAssistant,
  onSubmitNameGenerator,
  retrievalTurnLimit
}: LeftInputColumnProps) => (
  <>
    <div className="tab-list" role="tablist" aria-label="Left column tabs">
      <button
        type="button"
        role="tab"
        aria-selected={leftTab === "input"}
        className={leftTab === "input" ? "tab active" : "tab"}
        onClick={() => onLeftTabChange("input")}
        title="Show assistant and generator inputs."
      >
        Input
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={leftTab === "additional-context"}
        className={leftTab === "additional-context" ? "tab active" : "tab"}
        onClick={() => onLeftTabChange("additional-context")}
        title="Edit local assistant-only context."
      >
        Additional Context
      </button>
    </div>

    {leftTab === "input" ? (
      <div className="tab-panel" role="tabpanel">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includePartyContext}
            disabled={isBusy}
            onChange={(event) => onIncludePartyContextChange(event.currentTarget.checked)}
          />
          Include party info
        </label>
        <label className="range-row">
          <span>Extra retrieval turns: {retrievalTurnLimit}</span>
          <input
            type="range"
            min={0}
            max={3}
            step={1}
            value={retrievalTurnLimit}
            disabled={isBusy}
            onChange={(event) => onRetrievalTurnLimitChange(Number(event.currentTarget.value))}
          />
        </label>
        <InputModeSelector mode={inputMode} onModeChange={onInputModeChange} />
        {inputMode === "standard" ? (
          <AssistantPromptPanel
            disabled={isBusy}
            onPromptChange={onAssistantPromptChange}
            onSubmit={onSubmitAssistant}
            prompt={assistantPrompt}
          />
        ) : null}
        {inputMode === "name-generator" ? (
          <NameGeneratorPanel
            disabled={isBusy}
            onPromptChange={onNameGeneratorPromptChange}
            onSubmit={onSubmitNameGenerator}
            prompt={nameGeneratorPrompt}
          />
        ) : null}
      </div>
    ) : (
      <div className="tab-panel" role="tabpanel">
        <AdditionalContextPanel
          isLoaded={contextLoaded}
          markdown={contextMarkdown}
          onChange={onContextChange}
          saveState={contextSaveState}
        />
      </div>
    )}
  </>
);
