import { useCallback, useEffect, useMemo, useState } from "react";

import {
  askAssistant,
  debugRetrieval,
  generateNpcs,
  getConsole,
  getContext,
  getLog,
  getNpcs,
  getStatus,
  refresh,
  startNewSession,
  switchSessionMode,
  writeContext,
  type ApiConsole,
  type ApiLog,
  type ApiNpcResponse,
  type ApiOperationResult,
  type ApiSessionMode,
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
const EMPTY_NPCS: ApiNpcResponse = {
  npcs: []
};

/** Coordinates API state and composes the local assistant browser UI. */
export const App = () => {
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [debugQuery, setDebugQuery] = useState("");
  const [nameGeneratorPrompt, setNameGeneratorPrompt] = useState("");
  const [contextMarkdown, setContextMarkdown] = useState("");
  const [lastSavedContext, setLastSavedContext] = useState("");
  const [contextLoaded, setContextLoaded] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<ApiConsole>({ entries: [] });
  const [log, setLog] = useState<ApiLog>(EMPTY_LOG);
  const [npcs, setNpcs] = useState<ApiNpcResponse>(EMPTY_NPCS);
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
    const [nextStatus, nextLog, nextConsole, nextNpcs] = await Promise.all([getStatus(), getLog(), getConsole(), getNpcs()]);
    setStatus(nextStatus);
    setLog(nextLog);
    setConsoleOutput(nextConsole);
    setNpcs(nextNpcs);
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
    async (operation: () => Promise<ApiOperationResult>) => {
      setError(null);
      setStatus({ busy: true, operation: "request" });
      try {
        const result = await operation();
        setLog(result.log);
        setConsoleOutput(result.console);
        setNpcs(result.npcs);
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
    setOutputTab("log");
  }, [assistantPrompt, isBusy, runOperation]);

  const submitNameGeneratorPrompt = useCallback(() => {
    const prompt = nameGeneratorPrompt.trim();
    if (prompt.length === 0 || isBusy) {
      return;
    }
    setNameGeneratorPrompt("");
    void runOperation(() => generateNpcs(prompt));
    setOutputTab("npcs");
  }, [isBusy, nameGeneratorPrompt, runOperation]);

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

  const changeInputMode = useCallback(
    (mode: InputMode) => {
      if (mode === inputMode) {
        return;
      }
      setInputMode(mode);
      if (isBusy || (mode !== "standard" && mode !== "name-generator")) {
        return;
      }
      const sessionMode: ApiSessionMode = mode === "name-generator" ? "npcs" : "standard";
      setError(null);
      setStatus({ busy: true, operation: "switch-session-mode" });
      void switchSessionMode(sessionMode)
        .then((result) => {
          setLog(result.log);
          setConsoleOutput(result.console);
          setNpcs(result.npcs);
        })
        .catch((requestError: unknown) => {
          setError(formatError(requestError));
        })
        .finally(() => {
          void refreshStatus();
        });
    },
    [inputMode, isBusy, refreshStatus]
  );

  const startSession = useCallback((mode: ApiSessionMode) => {
    if (isBusy) {
      return;
    }
    setError(null);
    setStatus({ busy: true, operation: "new-session" });
    void startNewSession(mode)
      .then((result) => {
        setLog(result.log);
        setConsoleOutput(result.console);
        setNpcs(result.npcs);
      })
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
          nameGeneratorPrompt={nameGeneratorPrompt}
          onAssistantPromptChange={setAssistantPrompt}
          onContextChange={setContextMarkdown}
          onDebugQueryChange={setDebugQuery}
          onInputModeChange={changeInputMode}
          onLeftTabChange={setLeftTab}
          onNameGeneratorPromptChange={setNameGeneratorPrompt}
          onSubmitAssistant={submitAssistantPrompt}
          onSubmitDebugQuery={submitDebugQuery}
          onSubmitNameGenerator={submitNameGeneratorPrompt}
        />
      </section>

      <OutputTabs
        consoleOutput={consoleOutput}
        isBusy={isBusy}
        log={log}
        npcs={npcs}
        onNewSession={startSession}
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
