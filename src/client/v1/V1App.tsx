import { AppHeader } from "./components/AppHeader.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { LeftInputColumn } from "./components/LeftInputColumn.js";
import { OutputTabs } from "./components/OutputTabs.js";
import "./styles.css";
import { AppStateProvider, useAppState } from "./useAppState.js";

/** Composes the local assistant browser UI around React-owned application state. */
export const V1App = () => (
  <AppStateProvider>
    <AppContent />
  </AppStateProvider>
);

const AppContent = () => {
  const state = useAppState();

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="Assistant controls">
        <AppHeader isBusy={state.isBusy} operation={state.status.operation} onRefresh={state.runRefresh} />
        <ErrorBanner message={state.error} />
        <LeftInputColumn
          assistantPrompt={state.assistantPrompt}
          contextLoaded={state.contextLoaded}
          contextMarkdown={state.contextMarkdown}
          contextSaveState={state.contextSaveState}
          includePartyContext={state.includePartyContext}
          inputMode={state.inputMode}
          isBusy={state.isBusy}
          leftTab={state.leftTab}
          nameGeneratorPrompt={state.nameGeneratorPrompt}
          onAssistantPromptChange={state.setAssistantPrompt}
          onContextChange={state.setContextMarkdown}
          onIncludePartyContextChange={state.setIncludePartyContext}
          onInputModeChange={state.changeInputMode}
          onLeftTabChange={state.setLeftTab}
          onNameGeneratorPromptChange={state.setNameGeneratorPrompt}
          onRetrievalTurnLimitChange={state.setRetrievalTurnLimit}
          onSubmitAssistant={state.submitAssistantPrompt}
          onSubmitNameGenerator={state.submitNameGeneratorPrompt}
          retrievalTurnLimit={state.retrievalTurnLimit}
        />
      </section>

      <OutputTabs
        consoleOutput={state.consoleOutput}
        isBusy={state.isBusy}
        log={state.log}
        npcs={state.npcs}
        onNewSession={state.startSession}
        onSelectLog={state.selectLog}
        onTabChange={state.setOutputTab}
        tab={state.outputTab}
      />
    </main>
  );
};
