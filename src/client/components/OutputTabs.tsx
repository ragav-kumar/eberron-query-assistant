import type { ApiConsole, ApiLog } from "../api.js";
import { ConsoleFeed } from "./ConsoleFeed.js";
import { MarkdownOutputPane } from "./MarkdownOutputPane.js";
import type { OutputTab } from "./ui-types.js";

interface OutputTabsProps {
  consoleOutput: ApiConsole;
  log: ApiLog;
  onTabChange: (tab: OutputTab) => void;
  tab: OutputTab;
}

/** Renders the right-side output tabs for transient console output and persisted logs. */
export const OutputTabs = ({ consoleOutput, log, onTabChange, tab }: OutputTabsProps) => (
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
      </div>
      {tab === "log" ? <span>{log.filePath ?? "No log yet"}</span> : <span>Local only; not saved to logs</span>}
    </div>
    {tab === "console" ? (
      <ConsoleFeed entries={consoleOutput.entries} />
    ) : (
      <MarkdownOutputPane markdown={log.markdown} emptyMessage="Submit an assistant prompt to start the log." />
    )}
  </aside>
);
