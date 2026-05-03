import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  askAssistant,
  debugRetrieval,
  generateNpcs,
  getContext,
  getLog,
  isApiRequestError,
  refresh,
  writeContext,
  type ApiConsole,
  type ApiLog,
  type ApiNpcResponse,
  type ApiOperationResult
} from "./api.js";
import type { InputMode, LeftTab, OutputTab } from "./components/ui-types.js";

const SAVE_DELAY_MS = 500;
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

type SessionMode = "npcs" | "standard";

interface BusyState {
  busy: boolean;
  operation: string | null;
}

export interface AppState {
  assistantPrompt: string;
  changeInputMode: (mode: InputMode) => void;
  consoleOutput: ApiConsole;
  contextLoaded: boolean;
  contextMarkdown: string;
  contextSaveState: string;
  debugQuery: string;
  error: string | null;
  inputMode: InputMode;
  isBusy: boolean;
  leftTab: LeftTab;
  log: ApiLog;
  nameGeneratorPrompt: string;
  npcs: ApiNpcResponse;
  outputTab: OutputTab;
  runRefresh: (forceReingest: boolean) => void;
  selectLog: (filePath: string) => void;
  setAssistantPrompt: (prompt: string) => void;
  setContextMarkdown: (markdown: string) => void;
  setDebugQuery: (query: string) => void;
  setLeftTab: (tab: LeftTab) => void;
  setNameGeneratorPrompt: (prompt: string) => void;
  setOutputTab: (tab: OutputTab) => void;
  startSession: (mode: SessionMode) => void;
  status: BusyState;
  submitAssistantPrompt: () => void;
  submitDebugQuery: () => void;
  submitNameGeneratorPrompt: () => void;
}

const AppStateContext = createContext<AppState | null>(null);

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  const state = useCreateAppState();
  return <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider>;
};

export const useAppState = (): AppState => {
  const state = useContext(AppStateContext);
  if (!state) {
    throw new Error("useAppState must be used inside AppStateProvider.");
  }
  return state;
};

const useCreateAppState = (): AppState => {
  const sessionCounter = useRef(1);
  const [standardSessionId, setStandardSessionId] = useState("standard-1");
  const initialStandardSessionId = useRef("standard-1");
  const [npcSessionId, setNpcSessionId] = useState("npcs-1");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [debugQuery, setDebugQuery] = useState("");
  const [nameGeneratorPrompt, setNameGeneratorPrompt] = useState("");
  const [contextMarkdown, setContextMarkdown] = useState("");
  const [lastSavedContext, setLastSavedContext] = useState("");
  const [contextLoaded, setContextLoaded] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<ApiConsole>({ entries: [] });
  const [log, setLog] = useState<ApiLog>(EMPTY_LOG);
  const [npcs, setNpcs] = useState<ApiNpcResponse>(EMPTY_NPCS);
  const [status, setStatus] = useState<BusyState>({ busy: false, operation: null });
  const [error, setError] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("input");
  const [inputMode, setInputMode] = useState<InputMode>("standard");
  const [outputTab, setOutputTab] = useState<OutputTab>("log");

  const nextSessionId = useCallback((mode: SessionMode): string => {
    sessionCounter.current += 1;
    return `${mode}-${sessionCounter.current}`;
  }, []);

  const clearLogSelection = useCallback(() => {
    setLog((current) => ({
      ...EMPTY_LOG,
      files: current.files.map((file) => ({ ...file, active: false }))
    }));
  }, []);

  useEffect(() => {
    let active = true;

    const loadInitialState = async () => {
      try {
        const [initialContext, initialLog] = await Promise.all([
          getContext(),
          getLog({ sessionId: initialStandardSessionId.current })
        ]);
        if (!active) {
          return;
        }
        setContextMarkdown(initialContext);
        setLastSavedContext(initialContext);
        setContextLoaded(true);
        setLog(initialLog);
      } catch (requestError) {
        if (active) {
          setError(formatError(requestError));
        }
      }
    };

    void loadInitialState();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!contextLoaded || contextMarkdown === lastSavedContext) {
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
  }, [contextLoaded, contextMarkdown, lastSavedContext]);

  const contextSaveState = useMemo(
    () => (contextMarkdown === lastSavedContext ? "Saved" : "Saving"),
    [contextMarkdown, lastSavedContext]
  );

  const runOperation = useCallback(
    async (
      operationName: string,
      operation: () => Promise<ApiOperationResult>,
      applyResult: (result: ApiOperationResult) => void
    ) => {
      if (status.busy) {
        return;
      }
      setError(null);
      setStatus({ busy: true, operation: operationName });
      try {
        const result = await operation();
        setConsoleOutput(result.console);
        applyResult(result);
      } catch (requestError) {
        if (isApiRequestError(requestError) && requestError.console) {
          setConsoleOutput(requestError.console);
        }
        setError(formatError(requestError));
      } finally {
        setStatus({ busy: false, operation: null });
      }
    },
    [status.busy]
  );

  const submitAssistantPrompt = useCallback(() => {
    const prompt = assistantPrompt.trim();
    if (prompt.length === 0 || status.busy) {
      return;
    }
    setAssistantPrompt("");
    setOutputTab("log");
    void runOperation(
      "assistant",
      () => askAssistant(prompt, standardSessionId),
      (result) => {
        setLog(result.log);
        setNpcs(EMPTY_NPCS);
      }
    );
  }, [assistantPrompt, runOperation, standardSessionId, status.busy]);

  const submitNameGeneratorPrompt = useCallback(() => {
    const prompt = nameGeneratorPrompt.trim();
    if (prompt.length === 0 || status.busy) {
      return;
    }
    setNameGeneratorPrompt("");
    setOutputTab("npcs");
    void runOperation(
      "npcs",
      () => generateNpcs(prompt, npcSessionId),
      (result) => {
        clearLogSelection();
        setNpcs(result.npcs);
      }
    );
  }, [clearLogSelection, nameGeneratorPrompt, npcSessionId, runOperation, status.busy]);

  const submitDebugQuery = useCallback(() => {
    const query = debugQuery.trim();
    if (query.length === 0 || status.busy) {
      return;
    }
    setOutputTab("console");
    void runOperation("debug-retrieval", () => debugRetrieval(query), () => undefined);
  }, [debugQuery, runOperation, status.busy]);

  const runRefresh = useCallback(
    (forceReingest: boolean) => {
      if (status.busy) {
        return;
      }
      if (
        forceReingest &&
        !window.confirm("Force reingest clears and rebuilds app-owned corpus and retrieval artifacts. Continue?")
      ) {
        return;
      }
      setOutputTab("console");
      void runOperation("refresh", () => refresh(forceReingest), () => undefined);
    },
    [runOperation, status.busy]
  );

  const selectLog = useCallback(
    (filePath: string) => {
      setError(null);
      void getLog({ filePath, sessionId: standardSessionId })
        .then(setLog)
        .catch((requestError: unknown) => {
          setError(formatError(requestError));
        });
    },
    [standardSessionId]
  );

  const changeInputMode = useCallback(
    (mode: InputMode) => {
      if (mode === inputMode) {
        return;
      }

      const leavingNpcMode = inputMode === "name-generator" && mode !== "name-generator";
      const enteringNpcMode = mode === "name-generator";
      setInputMode(mode);

      if (enteringNpcMode) {
        setStandardSessionId(nextSessionId("standard"));
        clearLogSelection();
      }
      if (leavingNpcMode) {
        setNpcSessionId(nextSessionId("npcs"));
        setNpcs(EMPTY_NPCS);
      }
    },
    [clearLogSelection, inputMode, nextSessionId]
  );

  const startSession = useCallback(
    (mode: SessionMode) => {
      if (status.busy) {
        return;
      }
      setError(null);
      if (mode === "npcs") {
        setNpcSessionId(nextSessionId("npcs"));
        setNpcs(EMPTY_NPCS);
        return;
      }

      setStandardSessionId(nextSessionId("standard"));
      clearLogSelection();
    },
    [clearLogSelection, nextSessionId, status.busy]
  );

  return {
    assistantPrompt,
    changeInputMode,
    consoleOutput,
    contextLoaded,
    contextMarkdown,
    contextSaveState,
    debugQuery,
    error,
    inputMode,
    isBusy: status.busy,
    leftTab,
    log,
    nameGeneratorPrompt,
    npcs,
    outputTab,
    runRefresh,
    selectLog,
    setAssistantPrompt,
    setContextMarkdown,
    setDebugQuery,
    setLeftTab,
    setNameGeneratorPrompt,
    setOutputTab,
    startSession,
    status,
    submitAssistantPrompt,
    submitDebugQuery,
    submitNameGeneratorPrompt
  };
};

const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
