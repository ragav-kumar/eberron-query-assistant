import {
  BoldItalicUnderlineToggles,
  MDXEditor,
  UndoRedo,
  headingsPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  toolbarPlugin
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  askAssistant,
  debugRetrieval,
  getContext,
  getLog,
  getStatus,
  refresh,
  writeContext,
  type ApiLog,
  type ApiStatus
} from "./api.js";
import "./styles.css";

const SAVE_DELAY_MS = 500;
const LOG_POLL_MS = 1_500;

export const App = () => {
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [debugQuery, setDebugQuery] = useState("");
  const [contextMarkdown, setContextMarkdown] = useState("");
  const [lastSavedContext, setLastSavedContext] = useState("");
  const [contextLoaded, setContextLoaded] = useState(false);
  const [log, setLog] = useState<ApiLog>({ filePath: null, markdown: "" });
  const [status, setStatus] = useState<ApiStatus>({ busy: false, operation: null });
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const nextStatus = await getStatus();
    setStatus(nextStatus);
  }, []);

  const refreshStatusAndLog = useCallback(async () => {
    const [nextStatus, nextLog] = await Promise.all([getStatus(), getLog()]);
    setStatus(nextStatus);
    setLog(nextLog);
  }, []);

  useEffect(() => {
    let active = true;

    const loadInitialState = async () => {
      try {
        const [initialContext] = await Promise.all([getContext(), refreshStatusAndLog()]);
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
  }, [refreshStatusAndLog]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshStatusAndLog().catch((requestError: unknown) => {
        setError(formatError(requestError));
      });
    }, LOG_POLL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshStatusAndLog]);

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
    async (operation: () => Promise<{ log: ApiLog }>) => {
      setError(null);
      setStatus({ busy: true, operation: "request" });
      try {
        const result = await operation();
        setLog(result.log);
      } catch (requestError) {
        setError(formatError(requestError));
      } finally {
        await refreshStatus();
      }
    },
    [refreshStatus]
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
    },
    [isBusy, runOperation]
  );

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="Assistant controls">
        <header className="app-header">
          <div>
            <h1>Eberron Query Assistant</h1>
            <p>{status.busy ? `Running ${status.operation ?? "operation"}` : "Ready"}</p>
          </div>
          <div className="actions">
            <button type="button" onClick={() => runRefresh(false)} disabled={isBusy}>
              Refresh
            </button>
            <button type="button" className="danger" onClick={() => runRefresh(true)} disabled={isBusy}>
              Force reingest
            </button>
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}

        <section className="panel" aria-labelledby="assistant-heading">
          <h2 id="assistant-heading">Assistant</h2>
          <textarea
            value={assistantPrompt}
            onChange={(event) => setAssistantPrompt(event.currentTarget.value)}
            placeholder="Ask about Eberron lore, campaign notes, PDFs, or articles."
            disabled={isBusy}
          />
          <button type="button" onClick={submitAssistantPrompt} disabled={isBusy || assistantPrompt.trim().length === 0}>
            Ask
          </button>
        </section>

        <section className="panel compact" aria-labelledby="debug-heading">
          <h2 id="debug-heading">Debug Retrieval</h2>
          <div className="inline-form">
            <input
              value={debugQuery}
              onChange={(event) => setDebugQuery(event.currentTarget.value)}
              placeholder="aerenal deathless"
              disabled={isBusy}
            />
            <button type="button" onClick={submitDebugQuery} disabled={isBusy || debugQuery.trim().length === 0}>
              Run
            </button>
          </div>
        </section>

        <section className="panel context-panel" aria-labelledby="context-heading">
          <div className="panel-heading">
            <h2 id="context-heading">Additional Context</h2>
            <span>{contextSaveState}</span>
          </div>
          {contextLoaded ? (
            <MDXEditor
              markdown={contextMarkdown}
              onChange={setContextMarkdown}
              contentEditableClassName="context-editor"
              plugins={[
                headingsPlugin(),
                listsPlugin(),
                quotePlugin(),
                markdownShortcutPlugin(),
                toolbarPlugin({
                  toolbarContents: () => (
                    <>
                      <UndoRedo />
                      <BoldItalicUnderlineToggles />
                    </>
                  )
                })
              ]}
            />
          ) : (
            <div className="context-loading">Loading context</div>
          )}
        </section>
      </section>

      <aside className="log-view" aria-label="Active log">
        <div className="log-header">
          <h2>Active Log</h2>
          <span>{log.filePath ?? "No log yet"}</span>
        </div>
        <article className="markdown-output">
          {log.markdown.length > 0 ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{log.markdown}</ReactMarkdown>
          ) : (
            <p className="empty-log">Submit a prompt or run an action to start the log.</p>
          )}
        </article>
      </aside>
    </main>
  );
};

const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};
