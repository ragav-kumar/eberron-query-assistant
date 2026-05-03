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
  generateNpcs: vi.fn(),
  getContext: vi.fn(),
  getLog: vi.fn(),
  refresh: vi.fn(),
  isApiRequestError: vi.fn((error: unknown) => error instanceof Error && "console" in error),
  subscribeConsole: vi.fn(),
  writeContext: vi.fn()
}));

const initialLog = {
  activeFilePath: "logs/session.md" as string | null,
  files: [
    {
      active: true,
      filePath: "logs/session.md",
      label: "session.md"
    }
  ],
  filePath: "logs/session.md" as string | null,
  markdown: "# GUI Session\n\nReady.",
  readOnly: false
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

const emptyNpcs = (): api.ApiNpcResponse => ({
  npcs: []
});

const operationResult = (overrides: Partial<api.ApiOperationResult> = {}): api.ApiOperationResult => ({
  ok: true,
  console: initialConsole,
  log: initialLog,
  npcs: emptyNpcs(),
  ...overrides
});

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(api.getContext).mockResolvedValue("");
  vi.mocked(api.getLog).mockResolvedValue(initialLog);
  vi.mocked(api.subscribeConsole).mockReturnValue(() => undefined);
  vi.mocked(api.askAssistant).mockResolvedValue(operationResult({ log: { ...initialLog, markdown: "## Assistant\n\nAnswer" } }));
  vi.mocked(api.debugRetrieval).mockResolvedValue(operationResult({
    console: {
      entries: [
        {
          id: "2",
          level: "debug",
          message: "Debug retrieval query: deathless",
          timestamp: "2026-05-02T12:00:01.000Z"
        }
      ]
    }
  }));
  vi.mocked(api.generateNpcs).mockResolvedValue(operationResult({
    npcs: {
      npcs: [
        {
          id: 1,
          name: "Jala ir'Wynarn",
          description: "A sharp-eyed Aundairian envoy in travel-stained blue.",
          bio: "She trades favors along the border."
        }
      ]
    }
  }));
  vi.mocked(api.refresh).mockResolvedValue(operationResult({
    console: {
      entries: [
        {
          id: "3",
          level: "info",
          message: "Refresh complete.",
          timestamp: "2026-05-02T12:00:02.000Z"
        }
      ]
    }
  }));
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
    expect(screen.getByRole("tab", { name: "NPCs" }).getAttribute("aria-selected")).toBe("false");
  });

  it("switches input modes with the radio group", async () => {
    render(<App />);

    expect(await screen.findByRole("radio", { name: "Standard" })).toHaveProperty("checked", true);
    expect(screen.getByPlaceholderText(/Ask about Eberron/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Debug Query" }));
    expect(screen.getByPlaceholderText("aerenal deathless")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Ask about Eberron/i)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Name Generator" }));
    expect(screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i)).toBeTruthy();
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
      expect(api.askAssistant).toHaveBeenCalledWith("What about Aerenal?", expect.any(String));
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
      expect(api.askAssistant).toHaveBeenCalledWith("What about Sharn?", expect.any(String));
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

  it("submits name generator prompts and renders NPC cards", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "Name Generator" }));
    fireEvent.change(screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i), {
      target: { value: "Generate one Aundairian envoy" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(api.generateNpcs).toHaveBeenCalledWith("Generate one Aundairian envoy", expect.any(String));
    });
    expect(await screen.findByText("Jala ir'Wynarn")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "NPCs" }).getAttribute("aria-selected")).toBe("true");
  });

  it("submits name generator prompts with Enter", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "Name Generator" }));
    const prompt = screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i);
    fireEvent.change(prompt, {
      target: { value: "Generate one goblin" }
    });
    fireEvent.keyDown(prompt, { key: "Enter" });

    await waitFor(() => {
      expect(api.generateNpcs).toHaveBeenCalledWith("Generate one goblin", expect.any(String));
    });
  });

  it("starts a new NPC session from the NPCs tab", async () => {
    vi.mocked(api.generateNpcs).mockResolvedValue(operationResult({
      npcs: {
        npcs: [
          {
            id: 1,
            name: "Jala ir'Wynarn",
            description: "A sharp-eyed Aundairian envoy.",
            bio: "She trades favors."
          }
        ]
      }
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "Name Generator" }));
    fireEvent.change(screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i), {
      target: { value: "Generate one Aundairian envoy" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("tab", { name: "NPCs" }));
    expect(await screen.findByText("Jala ir'Wynarn")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(await screen.findByText("Generate NPCs to show cards for this session.")).toBeTruthy();
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

  it("disables operations while a client-owned operation is busy", async () => {
    let resolveAsk: ((value: api.ApiOperationResult) => void) | undefined;
    vi.mocked(api.askAssistant).mockReturnValue(
      new Promise((resolve) => {
        resolveAsk = resolve;
      })
    );

    render(<App />);

    fireEvent.change(await screen.findByPlaceholderText(/Ask about Eberron/i), {
      target: { value: "What about Sharn?" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByRole("button", { name: "Ask" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("status", { name: "Loading output" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Debug Query" }));
    expect(screen.getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", true);

    resolveAsk?.(operationResult());
  });

  it("keeps the submitted assistant prompt visible until the request succeeds", async () => {
    let resolveAsk: ((value: api.ApiOperationResult) => void) | undefined;
    vi.mocked(api.askAssistant).mockReturnValue(
      new Promise((resolve) => {
        resolveAsk = resolve;
      })
    );

    render(<App />);

    const prompt = await screen.findByPlaceholderText(/Ask about Eberron/i);
    fireEvent.change(prompt, {
      target: { value: "What about Sharn?" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(prompt).toHaveProperty("value", "What about Sharn?");

    resolveAsk?.(operationResult());

    await waitFor(() => {
      expect(prompt).toHaveProperty("value", "");
    });
  });

  it("keeps the submitted assistant prompt visible when the request fails", async () => {
    vi.mocked(api.askAssistant).mockRejectedValue(new Error("provider failed"));

    render(<App />);

    const prompt = await screen.findByPlaceholderText(/Ask about Eberron/i);
    fireEvent.change(prompt, {
      target: { value: "What about Sharn?" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("provider failed")).toBeTruthy();
    expect(prompt).toHaveProperty("value", "What about Sharn?");
  });

  it("clears name generator prompts only after success", async () => {
    let resolveGenerate: ((value: api.ApiOperationResult) => void) | undefined;
    vi.mocked(api.generateNpcs).mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      })
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "Name Generator" }));
    const prompt = screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i);
    fireEvent.change(prompt, {
      target: { value: "Generate one envoy" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(prompt).toHaveProperty("value", "Generate one envoy");

    resolveGenerate?.(operationResult({
      npcs: {
        npcs: [
          {
            id: 1,
            name: "Jala ir'Wynarn",
            description: "A sharp-eyed Aundairian envoy.",
            bio: "She trades favors."
          }
        ]
      }
    }));

    await waitFor(() => {
      expect(prompt).toHaveProperty("value", "");
    });
  });

  it("keeps name generator prompts visible when the request fails", async () => {
    vi.mocked(api.generateNpcs).mockRejectedValue(new Error("generation failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "Name Generator" }));
    const prompt = screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i);
    fireEvent.change(prompt, {
      target: { value: "Generate one envoy" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText("generation failed")).toBeTruthy();
    expect(prompt).toHaveProperty("value", "Generate one envoy");
  });

  it("renders streamed console entries before an operation result returns", async () => {
    let onConsoleEntry: ((entry: api.ApiConsoleEntry) => void) | undefined;
    vi.mocked(api.subscribeConsole).mockImplementation((listener) => {
      onConsoleEntry = listener;
      return () => undefined;
    });
    vi.mocked(api.askAssistant).mockReturnValue(new Promise(() => undefined));

    render(<App />);

    fireEvent.change(await screen.findByPlaceholderText(/Ask about Eberron/i), {
      target: { value: "What about Sharn?" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    onConsoleEntry?.({
      id: "stream-1",
      level: "info",
      message: "No completed refresh found for this server session; running routine refresh before continuing.",
      timestamp: "2026-05-02T12:00:03.000Z"
    });
    fireEvent.click(screen.getByRole("tab", { name: "Console" }));

    expect(await screen.findByText(/No completed refresh found/)).toBeTruthy();
  });

  it("renders the active log Markdown", async () => {
    render(<App />);

    expect(await screen.findByText("GUI Session")).toBeTruthy();
    expect(await screen.findByText("Ready.")).toBeTruthy();
  });

  it("renders an empty log state before a log exists", async () => {
    vi.mocked(api.getLog).mockResolvedValue(emptyLog());

    render(<App />);

    expect(await screen.findByText("No log selected")).toBeTruthy();
    expect(await screen.findByText("Submit an assistant prompt to start the log.")).toBeTruthy();
  });

  it("browses historical logs as read-only selections", async () => {
    const historicalLog = {
      ...initialLog,
      filePath: "logs/old.md",
      markdown: "# Old Session\n\nPast answer.",
      readOnly: true
    };
    vi.mocked(api.getLog).mockResolvedValueOnce({
      ...initialLog,
      files: [
        ...(initialLog.files ?? []),
        {
          active: false,
          filePath: "logs/old.md",
          label: "old.md"
        }
      ]
    });
    vi.mocked(api.getLog).mockResolvedValueOnce(historicalLog);

    render(<App />);

    const select = await screen.findByLabelText("Log file");
    fireEvent.change(select, { target: { value: "logs/old.md" } });

    await waitFor(() => {
      expect(
        vi.mocked(api.getLog).mock.calls.some(([options]) => (
          options.filePath === "logs/old.md" && typeof options.sessionId === "string"
        ))
      ).toBe(true);
    });
    expect(await screen.findByText("Read only: logs/old.md")).toBeTruthy();
    expect(await screen.findByText("Old Session")).toBeTruthy();
    expect(await screen.findByText("Past answer.")).toBeTruthy();
  });

  it("starts a new lazy log session", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "New session" }));

    expect(await screen.findByText("No log selected")).toBeTruthy();
    expect(await screen.findByText("Submit an assistant prompt to start the log.")).toBeTruthy();
  });

  it("switches back to the active log after submitting while browsing history", async () => {
    vi.mocked(api.getLog).mockResolvedValueOnce({
      ...initialLog,
      files: [
        ...(initialLog.files ?? []),
        {
          active: false,
          filePath: "logs/old.md",
          label: "old.md"
        }
      ]
    });
    vi.mocked(api.getLog).mockResolvedValueOnce({
      ...initialLog,
      filePath: "logs/old.md",
      markdown: "# Old Session",
      readOnly: true
    });
    vi.mocked(api.askAssistant).mockResolvedValue(operationResult({
      log: {
        ...initialLog,
        markdown: "# GUI Session\n\n## Assistant\n\nNew answer."
      }
    }));

    render(<App />);

    const select = await screen.findByLabelText("Log file");
    fireEvent.change(select, { target: { value: "logs/old.md" } });
    expect(await screen.findByText("Old Session")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Ask about Eberron/i), {
      target: { value: "Write to active session" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => {
      expect(api.askAssistant).toHaveBeenCalledWith("Write to active session", expect.any(String));
    });
    expect(await screen.findByText("Current session: logs/session.md")).toBeTruthy();
    expect(await screen.findByText("New answer.")).toBeTruthy();
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

const emptyLog = (): api.ApiLog => ({
  activeFilePath: null,
  files: [],
  filePath: null,
  markdown: "",
  readOnly: false
});
