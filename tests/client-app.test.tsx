// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/client/App.js";
import * as api from "../src/client/api.js";

vi.mock("@mdxeditor/editor", () => ({
  BoldItalicUnderlineToggles: () => null,
  MDXEditor: (props: {
    markdown: string;
    onChange(markdown: string): void;
  }) => {
    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
      props.onChange(event.currentTarget.value);
    };

    return <textarea aria-label="Additional Context Editor" value={props.markdown} onChange={handleChange} />;
  },
  UndoRedo: () => null,
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  quotePlugin: () => ({}),
  toolbarPlugin: () => ({})
}));

vi.mock("../src/client/api.js", () => ({
  askAssistant: vi.fn(),
  debugRetrieval: vi.fn(),
  getConsole: vi.fn(),
  getContext: vi.fn(),
  getLog: vi.fn(),
  getStatus: vi.fn(),
  refresh: vi.fn(),
  writeContext: vi.fn()
}));

const initialLog = {
  filePath: "logs/session.md" as string | null,
  markdown: "# GUI Session\n\nReady."
};

const initialConsole = {
  entries: [
    {
      id: "1",
      level: "info" as const,
      message: "Ready",
      timestamp: "2026-05-02T12:00:00.000Z"
    }
  ]
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(api.getContext).mockResolvedValue("");
  vi.mocked(api.getConsole).mockResolvedValue(initialConsole);
  vi.mocked(api.getLog).mockResolvedValue(initialLog);
  vi.mocked(api.getStatus).mockResolvedValue({ busy: false, operation: null });
  vi.mocked(api.askAssistant).mockResolvedValue({
    ok: true,
    console: initialConsole,
    log: { ...initialLog, markdown: "## Assistant\n\nAnswer" }
  });
  vi.mocked(api.debugRetrieval).mockResolvedValue({
    ok: true,
    console: {
      entries: [
        {
          id: "2",
          level: "debug",
          message: "Debug retrieval query: deathless",
          timestamp: "2026-05-02T12:00:01.000Z"
        }
      ]
    },
    log: initialLog
  });
  vi.mocked(api.refresh).mockResolvedValue({
    ok: true,
    console: {
      entries: [
        {
          id: "3",
          level: "info",
          message: "Refresh complete.",
          timestamp: "2026-05-02T12:00:02.000Z"
        }
      ]
    },
    log: initialLog
  });
  vi.mocked(api.writeContext).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App", () => {
  it("renders input and output tabs with their default selections", async () => {
    render(<App />);

    expect((await screen.findByRole("tab", { name: "Input" })).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Additional Context" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Console" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Log" }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches input modes with the radio group", async () => {
    render(<App />);

    expect(await screen.findByRole("radio", { name: "Standard" })).toHaveProperty("checked", true);
    expect(screen.getByPlaceholderText(/Ask about Eberron/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Debug Query" }));
    expect(screen.getByPlaceholderText("aerenal deathless")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Ask about Eberron/i)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Name Generator" }));
    expect(screen.getByText("Name generator mode is not implemented yet.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("aerenal deathless")).toBeNull();
  });

  it("submits assistant prompts and renders the returned log", async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText(/Ask about Eberron/i), {
      target: { value: "What about Aerenal?" }
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ask" })).toHaveProperty("disabled", false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => {
      expect(api.askAssistant).toHaveBeenCalledWith("What about Aerenal?");
    });
    expect(await screen.findByText("Answer")).toBeTruthy();
  });

  it("submits assistant prompts with Enter", async () => {
    render(<App />);

    const prompt = screen.getByPlaceholderText(/Ask about Eberron/i);
    fireEvent.change(prompt, {
      target: { value: "What about Sharn?" }
    });
    fireEvent.keyDown(prompt, { key: "Enter" });

    await waitFor(() => {
      expect(api.askAssistant).toHaveBeenCalledWith("What about Sharn?");
    });
  });

  it("submits debug retrieval queries", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "Debug Query" }));
    fireEvent.change(screen.getByPlaceholderText("aerenal deathless"), {
      target: { value: "deathless" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(api.debugRetrieval).toHaveBeenCalledWith("deathless");
    });
    expect(await screen.findByText("Debug retrieval query: deathless")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Console" }).getAttribute("aria-selected")).toBe("true");
  });

  it("submits debug retrieval queries with Enter", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "Debug Query" }));
    const query = screen.getByPlaceholderText("aerenal deathless");
    fireEvent.change(query, {
      target: { value: "sharn" }
    });
    fireEvent.keyDown(query, { key: "Enter" });

    await waitFor(() => {
      expect(api.debugRetrieval).toHaveBeenCalledWith("sharn");
    });
  });

  it("persists additional context edits", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "Additional Context" }));
    fireEvent.change(await screen.findByLabelText("Additional Context Editor"), {
      target: { value: "Campaign fact" }
    });

    await waitFor(() => {
      expect(api.writeContext).toHaveBeenCalledWith("Campaign fact");
    }, { timeout: 1_500 });
  });

  it("preloads existing additional context into the editor", async () => {
    vi.mocked(api.getContext).mockResolvedValue("Existing campaign context");

    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "Additional Context" }));
    const editor = await screen.findByLabelText("Additional Context Editor");
    expect(editor).toHaveProperty("value", "Existing campaign context");
  });

  it("disables operations while busy", async () => {
    vi.mocked(api.getStatus).mockResolvedValue({ busy: true, operation: "refresh" });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Ask" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("radio", { name: "Debug Query" }));
    expect(screen.getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", true);
  });

  it("renders the active log Markdown", async () => {
    render(<App />);

    expect(await screen.findByText("GUI Session")).toBeTruthy();
    expect(await screen.findByText("Ready.")).toBeTruthy();
  });

  it("renders an empty log state before a log exists", async () => {
    vi.mocked(api.getLog).mockResolvedValue({ filePath: null, markdown: "" });

    render(<App />);

    expect(await screen.findByText("No log yet")).toBeTruthy();
    expect(await screen.findByText("Submit an assistant prompt to start the log.")).toBeTruthy();
  });

  it("renders refresh output as console feed text", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(api.refresh).toHaveBeenCalledWith(false);
    });
    expect(await screen.findByText("Refresh complete.")).toBeTruthy();
    expect(screen.getByTestId("console-feed").querySelector(".console-level")?.textContent).toBe("INFO");
  });

  it("auto-scrolls console and log panes when output changes", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      value: 500
    });

    render(<App />);

    expect(await screen.findByTestId("markdown-output")).toHaveProperty("scrollTop", 500);
    fireEvent.click(screen.getByRole("tab", { name: "Console" }));
    expect(await screen.findByTestId("console-feed")).toHaveProperty("scrollTop", 500);
  });

  it("adds tooltips to key controls", async () => {
    render(<App />);

    expect((await screen.findByRole("button", { name: "Refresh" })).getAttribute("title")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Force reingest" }).getAttribute("title")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Input" }).getAttribute("title")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Console" }).getAttribute("title")).toBeTruthy();
  });

  it("confirms before force reingest", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Force reingest" }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        "Force reingest clears and rebuilds app-owned corpus and retrieval artifacts. Continue?"
      );
      expect(api.refresh).toHaveBeenCalledWith(true);
    });
  });

  it("does not force reingest when confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Force reingest" }));

    await waitFor(() => {
      expect(api.refresh).not.toHaveBeenCalled();
    });
  });
});
