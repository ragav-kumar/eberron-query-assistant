import { AdditionalContextPanel } from "./AdditionalContextPanel.js";
import { AssistantPromptPanel } from "./AssistantPromptPanel.js";
import { DebugQueryPanel } from "./DebugQueryPanel.js";
import { InputModeSelector } from "./InputModeSelector.js";
import { NameGeneratorStub } from "./NameGeneratorStub.js";
import type { InputMode, LeftTab } from "./ui-types.js";

interface LeftInputColumnProps {
  assistantPrompt: string;
  contextLoaded: boolean;
  contextMarkdown: string;
  contextSaveState: string;
  debugQuery: string;
  inputMode: InputMode;
  isBusy: boolean;
  leftTab: LeftTab;
  onAssistantPromptChange: (prompt: string) => void;
  onContextChange: (markdown: string) => void;
  onDebugQueryChange: (query: string) => void;
  onInputModeChange: (mode: InputMode) => void;
  onLeftTabChange: (tab: LeftTab) => void;
  onSubmitAssistant: () => void;
  onSubmitDebugQuery: () => void;
}

/** Owns the left-side input tabs and renders the active input or context editor surface. */
export const LeftInputColumn = ({
  assistantPrompt,
  contextLoaded,
  contextMarkdown,
  contextSaveState,
  debugQuery,
  inputMode,
  isBusy,
  leftTab,
  onAssistantPromptChange,
  onContextChange,
  onDebugQueryChange,
  onInputModeChange,
  onLeftTabChange,
  onSubmitAssistant,
  onSubmitDebugQuery
}: LeftInputColumnProps) => (
  <>
    <div className="tab-list" role="tablist" aria-label="Left column tabs">
      <button
        type="button"
        role="tab"
        aria-selected={leftTab === "input"}
        className={leftTab === "input" ? "tab active" : "tab"}
        onClick={() => onLeftTabChange("input")}
        title="Show assistant, debug, and future generator inputs."
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
        <InputModeSelector mode={inputMode} onModeChange={onInputModeChange} />
        {inputMode === "standard" ? (
          <AssistantPromptPanel
            disabled={isBusy}
            onPromptChange={onAssistantPromptChange}
            onSubmit={onSubmitAssistant}
            prompt={assistantPrompt}
          />
        ) : null}
        {inputMode === "debug" ? (
          <DebugQueryPanel
            disabled={isBusy}
            onQueryChange={onDebugQueryChange}
            onSubmit={onSubmitDebugQuery}
            query={debugQuery}
          />
        ) : null}
        {inputMode === "name-generator" ? <NameGeneratorStub /> : null}
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
