import type { ApiConsole, ApiLog, ApiNpcResponse, ApiSessionMode } from "../api.js";
import { ConsoleFeed } from "./ConsoleFeed.js";
import { MarkdownOutputPane } from "./MarkdownOutputPane.js";
import { NpcCardsPane } from "./NpcCardsPane.js";
import type { OutputTab } from "./ui-types.js";

interface OutputTabsProps {
  consoleOutput: ApiConsole;
  isBusy: boolean;
  log: ApiLog;
  npcs: ApiNpcResponse;
  onNewSession: (mode: ApiSessionMode) => void;
  onSelectLog: (filePath: string) => void;
  onTabChange: (tab: OutputTab) => void;
  tab: OutputTab;
}

/** Renders the right-side output tabs for transient console output and persisted logs. */
export const OutputTabs = ({
  consoleOutput,
  isBusy,
  log,
  npcs,
  onNewSession,
  onSelectLog,
  onTabChange,
  tab
}: OutputTabsProps) => (
  <aside className="output-view" aria-label="Application output">
    <div className="output-header">
      <div className="tab-list" role="tablist" aria-label="Output tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "console"}
          className={tab === "console" ? "tab active" : "tab"}
          onClick={() => onTabChange("console")}
          title="Show unsaved local progress, debug, warning, and error messages."
        >
          Console
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "log"}
          className={tab === "log" ? "tab active" : "tab"}
          onClick={() => onTabChange("log")}
          title="Show the persisted assistant transcript for this session."
        >
          Log
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "npcs"}
          className={tab === "npcs" ? "tab active" : "tab"}
          onClick={() => onTabChange("npcs")}
          title="Show generated NPC cards for this session."
        >
          NPCs
        </button>
      </div>
      {tab === "log" ? (
        <LogToolbar
          isBusy={isBusy}
          log={log}
          onNewSession={onNewSession}
          onSelectLog={onSelectLog}
        />
      ) : tab === "npcs" ? (
        <NpcToolbar isBusy={isBusy} npcs={npcs} onNewSession={onNewSession} />
      ) : (
        <span>Local only; not saved to logs</span>
      )}
    </div>
    {tab === "console" ? (
      <ConsoleFeed entries={consoleOutput.entries} />
    ) : tab === "npcs" ? (
      <NpcCardsPane npcs={npcs.npcs} />
    ) : (
      <MarkdownOutputPane markdown={log.markdown} emptyMessage="Submit an assistant prompt to start the log." />
    )}
  </aside>
);

interface LogToolbarProps {
  isBusy: boolean;
  log: ApiLog;
  onNewSession: (mode: ApiSessionMode) => void;
  onSelectLog: (filePath: string) => void;
}

const LogToolbar = ({ isBusy, log, onNewSession, onSelectLog }: LogToolbarProps) => {
  const historicalFiles = log.files.filter((file) => !file.active);
  const currentFile = log.files.find((file) => file.active);
  const selectedFilePath = log.filePath ?? "";
  const status = log.filePath
    ? log.readOnly
      ? "Read only"
      : "Current session"
    : "No log selected";

  return (
    <div className="log-toolbar">
      <div className="log-select-row">
        <label className="sr-only" htmlFor="log-file-select">
          Log file
        </label>
        <select
          id="log-file-select"
          value={selectedFilePath}
          onChange={(event) => onSelectLog(event.currentTarget.value)}
          disabled={log.files.length === 0}
          title="Browse saved Markdown transcript logs."
        >
          {log.files.length === 0 ? (
            <option value="">No saved logs</option>
          ) : (
            <option value="" disabled>
              Select a log
            </option>
          )}
          {currentFile ? <option value={currentFile.filePath}>Current session - {currentFile.label}</option> : null}
          {historicalFiles.map((file) => (
            <option key={file.filePath} value={file.filePath}>
              {file.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onNewSession("standard")}
          disabled={isBusy}
          title="Start a fresh assistant transcript. The file is created after the next answer."
        >
          New session
        </button>
      </div>
      <span>
        {status}
        {log.filePath ? `: ${log.filePath}` : ""}
      </span>
    </div>
  );
};

interface NpcToolbarProps {
  isBusy: boolean;
  npcs: ApiNpcResponse;
  onNewSession: (mode: ApiSessionMode) => void;
}

const NpcToolbar = ({ isBusy, npcs, onNewSession }: NpcToolbarProps) => (
  <div className="log-toolbar">
    <div className="log-select-row">
      <button
        type="button"
        onClick={() => onNewSession("npcs")}
        disabled={isBusy}
        title="Clear generated NPC cards for this session without deleting generated_npcs.md."
      >
        New session
      </button>
    </div>
    <span>{npcs.npcs.length === 1 ? "1 NPC in current session" : `${npcs.npcs.length} NPCs in current session`}</span>
  </div>
);
