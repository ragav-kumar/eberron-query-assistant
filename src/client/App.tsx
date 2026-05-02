import { useCallback, useEffect, useMemo, useState } from "react";

import {
  askAssistant,
  debugRetrieval,
  getConsole,
  getContext,
  getLog,
  getStatus,
  refresh,
  startNewLogSession,
  writeContext,
  type ApiConsole,
  type ApiLog,
  type ApiStatus
} from "./api.js";
import { AppHeader } from "./components/AppHeader.js";
import { ErrorBanner } from "./components/ErrorBanner.js";
import { LeftInputColumn } from "./components/LeftInputColumn.js";
import { OutputTabs } from "./components/OutputTabs.js";
import type { InputMode, LeftTab, OutputTab } from "./components/ui-types.js";
import "./styles.css";

const SAVE_DELAY_MS = 500;
const OUTPUT_POLL_MS = 1_500;
const EMPTY_LOG: ApiLog = {
  activeFilePath: null,
  files: [],
  filePath: null,
  markdown: "",
  readOnly: false
};

/** Coordinates API state and composes the local assistant browser UI. */
export const App = () => {
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [debugQuery, setDebugQuery] = useState("");
  const [contextMarkdown, setContextMarkdown] = useState("");
  const [lastSavedContext, setLastSavedContext] = useState("");
  const [contextLoaded, setContextLoaded] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<ApiConsole>({ entries: [] });
  const [log, setLog] = useState<ApiLog>(EMPTY_LOG);
  const [status, setStatus] = useState<ApiStatus>({ busy: false, operation: null });
  const [error, setError] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("input");
  const [inputMode, setInputMode] = useState<InputMode>("standard");
  const [outputTab, setOutputTab] = useState<OutputTab>("log");

  const refreshStatus = useCallback(async () => {
    const nextStatus = await getStatus();
    setStatus(nextStatus);
  }, []);

  const refreshStatusAndOutputs = useCallback(async () => {
    const [nextStatus, nextLog, nextConsole] = await Promise.all([getStatus(), getLog(), getConsole()]);
    setStatus(nextStatus);
    setLog(nextLog);
    setConsoleOutput(nextConsole);
  }, []);

  useEffect(() => {
    let active = true;

    const loadInitialState = async () => {
      try {
        const [initialContext] = await Promise.all([getContext(), refreshStatusAndOutputs()]);
        if (!active) {
          return;
        }
        setContextMarkdown(initialContext);
        setLastSavedContext(initialContext);
        setContextLoaded(true);
      } catch (requestError) {
        setError(formatError(requestError));
      }
    };

    void loadInitialState();
    return () => {
      active = false;
    };
  }, [refreshStatusAndOutputs]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshStatusAndOutputs().catch((requestError: unknown) => {
        setError(formatError(requestError));
      });
    }, OUTPUT_POLL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshStatusAndOutputs]);

  useEffect(() => {
    if (contextMarkdown === lastSavedContext) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void writeContext(contextMarkdown)
        .then(() => {
          setLastSavedContext(contextMarkdown);
        })
        .catch((requestError: unknown) => {
          setError(formatError(requestError));
        });
    }, SAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [contextMarkdown, lastSavedContext]);

  const isBusy = status.busy;
  const contextSaveState = useMemo(
    () => (contextMarkdown === lastSavedContext ? "Saved" : "Saving"),
    [contextMarkdown, lastSavedContext]
  );

  const runOperation = useCallback(
    async (operation: () => Promise<{ console: ApiConsole; log: ApiLog }>) => {
      setError(null);
      setStatus({ busy: true, operation: "request" });
      try {
        const result = await operation();
        setLog(result.log);
        setConsoleOutput(result.console);
      } catch (requestError) {
        setError(formatError(requestError));
        await refreshStatusAndOutputs();
      } finally {
        await refreshStatus();
      }
    },
    [refreshStatus, refreshStatusAndOutputs]
  );

  const submitAssistantPrompt = useCallback(() => {
    const prompt = assistantPrompt.trim();
    if (prompt.length === 0 || isBusy) {
      return;
    }
    setAssistantPrompt("");
    void runOperation(() => askAssistant(prompt));
  }, [assistantPrompt, isBusy, runOperation]);

  const submitDebugQuery = useCallback(() => {
    const query = debugQuery.trim();
    if (query.length === 0 || isBusy) {
      return;
    }
    void runOperation(() => debugRetrieval(query));
    setOutputTab("console");
  }, [debugQuery, isBusy, runOperation]);

  const runRefresh = useCallback(
    (forceReingest: boolean) => {
      if (isBusy) {
        return;
      }
      if (
        forceReingest &&
        !window.confirm("Force reingest clears and rebuilds app-owned corpus and retrieval artifacts. Continue?")
      ) {
        return;
      }
      void runOperation(() => refresh(forceReingest));
      setOutputTab("console");
    },
    [isBusy, runOperation]
  );

  const selectLog = useCallback((filePath: string) => {
    setError(null);
    void getLog(filePath)
      .then(setLog)
      .catch((requestError: unknown) => {
        setError(formatError(requestError));
      });
  }, []);

  const startNewSession = useCallback(() => {
    if (isBusy) {
      return;
    }
    setError(null);
    setStatus({ busy: true, operation: "new-session" });
    void startNewLogSession()
      .then(setLog)
      .catch((requestError: unknown) => {
        setError(formatError(requestError));
      })
      .finally(() => {
        void refreshStatus();
      });
  }, [isBusy, refreshStatus]);

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="Assistant controls">
        <AppHeader isBusy={isBusy} operation={status.operation} onRefresh={runRefresh} />
        <ErrorBanner message={error} />
        <LeftInputColumn
          assistantPrompt={assistantPrompt}
          contextLoaded={contextLoaded}
          contextMarkdown={contextMarkdown}
          contextSaveState={contextSaveState}
          debugQuery={debugQuery}
          inputMode={inputMode}
          isBusy={isBusy}
          leftTab={leftTab}
          onAssistantPromptChange={setAssistantPrompt}
          onContextChange={setContextMarkdown}
          onDebugQueryChange={setDebugQuery}
          onInputModeChange={setInputMode}
          onLeftTabChange={setLeftTab}
          onSubmitAssistant={submitAssistantPrompt}
          onSubmitDebugQuery={submitDebugQuery}
        />
      </section>

      <OutputTabs
        consoleOutput={consoleOutput}
        isBusy={isBusy}
        log={log}
        onNewSession={startNewSession}
        onSelectLog={selectLog}
        onTabChange={setOutputTab}
        tab={outputTab}
      />
    </main>
  );
};

const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
