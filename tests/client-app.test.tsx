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
  generateNpcs: vi.fn(),
  getContext: vi.fn(),
  getLog: vi.fn(),
  getNpcs: vi.fn(),
  getStatus: vi.fn(),
  refresh: vi.fn(),
  isApiRequestError: vi.fn((error: unknown) => error instanceof Error && "console" in error),
  subscribeConsole: vi.fn(),
  writeContext: vi.fn()
}));

const initialLog = {
  activeFilePath: "logs/session.json" as string | null,
  exchanges: [
    {
      user: "Initial prompt",
      title: "GUI Session",
      assistant: "Ready."
    }
  ],
  files: [
    {
      active: true,
      filePath: "logs/session.json",
      label: "session"
    }
  ],
  filePath: "logs/session.json" as string | null,
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
  vi.mocked(api.getNpcs).mockResolvedValue(emptyNpcs());
  vi.mocked(api.getStatus).mockResolvedValue({
    activeOperation: null,
    console: { entries: [] },
    log: initialLog,
    npcs: emptyNpcs()
  });
  vi.mocked(api.subscribeConsole).mockReturnValue(() => undefined);
  vi.mocked(api.askAssistant).mockResolvedValue(operationResult({
    log: {
      ...initialLog,
      exchanges: [{ user: "What about Aerenal?", title: "Aerenal Overview", assistant: "Answer" }]
    }
  }));
  vi.mocked(api.generateNpcs).mockResolvedValue(operationResult({
    npcs: {
      npcs: [
        {
          id: 1,
          name: "Jala ir'Wynarn",
          species: "Human",
          ethnicity: "Aundairian",
          gender: "woman",
          role: "envoy",
          age: "about 40",
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
    expect(screen.getByRole("checkbox", { name: "Include party info" })).toHaveProperty("checked", true);
  });

  it("uses one shared party info checkbox for standard and NPC submissions", async () => {
    render(<App />);

    const checkbox = await screen.findByRole("checkbox", { name: "Include party info" });
    fireEvent.click(checkbox);
    expect(checkbox).toHaveProperty("checked", false);

    fireEvent.change(screen.getByPlaceholderText(/Ask about Eberron/i), {
      target: { value: "What about Aundair?" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => {
      expect(api.askAssistant).toHaveBeenCalledWith("What about Aundair?", expect.any(String), false);
    });

    fireEvent.click(screen.getByRole("radio", { name: "NPC Generator" }));
    expect(screen.getByRole("checkbox", { name: "Include party info" })).toHaveProperty("checked", false);
    fireEvent.change(screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i), {
      target: { value: "Generate one envoy" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(api.generateNpcs).toHaveBeenCalledWith("Generate one envoy", expect.any(String), false);
    });
  });

  it("switches input modes with the radio group", async () => {
    render(<App />);

    expect(await screen.findByRole("radio", { name: "Standard" })).toHaveProperty("checked", true);
    expect(screen.getByPlaceholderText(/Ask about Eberron/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "NPC Generator" }));
    expect(screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Ask about Eberron/i)).toBeNull();
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
      expect(api.askAssistant).toHaveBeenCalledWith("What about Aerenal?", expect.any(String), true);
    });
    expect(await screen.findByText("Answer")).toBeTruthy();
  });

  it("keeps saved NPC cards after standard assistant prompts and mode switches", async () => {
    vi.mocked(api.getStatus).mockResolvedValue(statusResponse({
      npcs: {
        npcs: [
          {
            id: 1,
            name: "Saved NPC",
            description: "A saved generated NPC.",
            bio: "They persist outside the prompt mode."
          }
        ]
      }
    }));
    vi.mocked(api.askAssistant).mockResolvedValue(operationResult({
      log: {
        ...initialLog,
        exchanges: [{ user: "What about Aerenal?", title: "Aerenal Overview", assistant: "Answer" }]
      },
      npcs: {
        npcs: [
          {
            id: 1,
            name: "Saved NPC",
            description: "A saved generated NPC.",
            bio: "They persist outside the prompt mode."
          }
        ]
      }
    }));

    render(<App />);

    fireEvent.change(await screen.findByPlaceholderText(/Ask about Eberron/i), {
      target: { value: "What about Aerenal?" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => {
      expect(api.askAssistant).toHaveBeenCalledWith("What about Aerenal?", expect.any(String), true);
    });
    fireEvent.click(screen.getByRole("radio", { name: "NPC Generator" }));
    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    fireEvent.click(screen.getByRole("tab", { name: "NPCs" }));

    expect(await screen.findByText("Saved NPC")).toBeTruthy();
  });

  it("submits assistant prompts with Enter", async () => {
    render(<App />);

    const prompt = screen.getByPlaceholderText(/Ask about Eberron/i);
    fireEvent.change(prompt, {
      target: { value: "What about Sharn?" }
    });
    fireEvent.keyDown(prompt, { key: "Enter" });

    await waitFor(() => {
      expect(api.askAssistant).toHaveBeenCalledWith("What about Sharn?", expect.any(String), true);
    });
  });

  it("submits NPC generator prompts and renders NPC cards", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "NPC Generator" }));
    fireEvent.change(screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i), {
      target: { value: "Generate one Aundairian envoy" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(api.generateNpcs).toHaveBeenCalledWith("Generate one Aundairian envoy", expect.any(String), true);
    });
    expect(await screen.findByText("Jala ir'Wynarn")).toBeTruthy();
    expect(screen.getByText("Species")).toBeTruthy();
    expect(screen.getByText("Human")).toBeTruthy();
    expect(screen.getByText("Ethnicity")).toBeTruthy();
    expect(screen.getByText("Aundairian")).toBeTruthy();
    expect(screen.getByText("Gender")).toBeTruthy();
    expect(screen.getByText("woman")).toBeTruthy();
    expect(screen.getByText("Role")).toBeTruthy();
    expect(screen.getByText("envoy")).toBeTruthy();
    expect(screen.getByText("Age")).toBeTruthy();
    expect(screen.getByText("about 40")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "NPCs" }).getAttribute("aria-selected")).toBe("true");
  });

  it("loads saved NPC cards on startup", async () => {
    vi.mocked(api.getStatus).mockResolvedValue(statusResponse({
      npcs: {
        npcs: [
          {
            id: 2,
            name: "Newer NPC",
            description: "A recently updated NPC.",
            bio: "They should render first."
          },
          {
            id: 1,
            name: "Older NPC",
            description: "An older saved NPC.",
            bio: "They should render second."
          }
        ]
      }
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole("tab", { name: "NPCs" }));

    expect(await screen.findByText("Newer NPC")).toBeTruthy();
    expect(await screen.findByText("Older NPC")).toBeTruthy();
    expect(screen.getByText("2 NPCs saved")).toBeTruthy();
    expect(screen.queryByText("Species")).toBeNull();
    expect(screen.queryByText("Unknown")).toBeNull();
  });

  it("submits NPC generator prompts with Enter", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "NPC Generator" }));
    const prompt = screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i);
    fireEvent.change(prompt, {
      target: { value: "Generate one goblin" }
    });
    fireEvent.keyDown(prompt, { key: "Enter" });

    await waitFor(() => {
      expect(api.generateNpcs).toHaveBeenCalledWith("Generate one goblin", expect.any(String), true);
    });
  });

  it("starts a new NPC generation context from the NPCs tab without clearing saved cards", async () => {
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

    fireEvent.click(await screen.findByRole("radio", { name: "NPC Generator" }));
    fireEvent.change(screen.getByPlaceholderText(/Generate three Aundairian goblin NPCs/i), {
      target: { value: "Generate one Aundairian envoy" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("tab", { name: "NPCs" }));
    expect(await screen.findByText("Jala ir'Wynarn")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(await screen.findByText("Jala ir'Wynarn")).toBeTruthy();
    expect(screen.getByText("1 NPC saved")).toBeTruthy();
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
    expect(screen.getByRole("checkbox", { name: "Include party info" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("status", { name: "Loading output" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "NPC Generator" }));
    expect(screen.getByRole("button", { name: "Generate" })).toHaveProperty("disabled", true);
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

  it("clears NPC generator prompts only after success", async () => {
    let resolveGenerate: ((value: api.ApiOperationResult) => void) | undefined;
    vi.mocked(api.generateNpcs).mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      })
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "NPC Generator" }));
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

  it("keeps NPC generator prompts visible when the request fails", async () => {
    vi.mocked(api.generateNpcs).mockRejectedValue(new Error("generation failed"));

    render(<App />);

    fireEvent.click(await screen.findByRole("radio", { name: "NPC Generator" }));
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

  it("restores active operation state and console output on startup", async () => {
    vi.mocked(api.getStatus).mockResolvedValue(statusResponse({
      activeOperation: "force-reingest",
      console: {
        entries: [
          {
            id: "replay-1",
            level: "info",
            message: "Force re-ingest requested; source inventory will schedule all available sources.",
            timestamp: "2026-05-02T12:00:04.000Z"
          }
        ]
      }
    }));

    render(<App />);

    expect(await screen.findByText("Running force-reingest")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Console" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText(/Force re-ingest requested/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", true);
  });

  it("displays startup refresh status and console output", async () => {
    vi.mocked(api.getStatus).mockResolvedValue(statusResponse({
      activeOperation: "startup-refresh",
      console: {
        entries: [
          {
            id: "startup-1",
            level: "info",
            message: "Starting source inventory checks.",
            timestamp: "2026-05-02T12:00:04.000Z"
          }
        ]
      }
    }));

    render(<App />);

    expect(await screen.findByText("Running startup-refresh")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("tab", { name: "Console" }));
    expect(await screen.findByText(/Starting source inventory checks/)).toBeTruthy();
  });

  it("polls recovered operations until final output is available", async () => {
    vi.mocked(api.getStatus)
      .mockResolvedValueOnce(statusResponse({
        activeOperation: "force-reingest",
        console: {
          entries: [
            {
              id: "replay-1",
              level: "info",
              message: "Force re-ingest requested.",
              timestamp: "2026-05-02T12:00:04.000Z"
            }
          ]
        }
      }))
      .mockResolvedValue(statusResponse({
        activeOperation: null,
        console: {
          entries: [
            {
              id: "replay-1",
              level: "info",
              message: "Force re-ingest requested.",
              timestamp: "2026-05-02T12:00:04.000Z"
            },
            {
              id: "replay-2",
              level: "info",
              message: "Refresh complete. Force reingest: true.",
              timestamp: "2026-05-02T12:00:05.000Z"
            }
          ]
        }
      }));

    render(<App />);

    expect(await screen.findByText("Running force-reingest")).toBeTruthy();
    expect(await screen.findByText("Refresh complete. Force reingest: true.")).toBeTruthy();
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(api.getStatus).toHaveBeenCalledTimes(2);
  });

  it("renders the active log Markdown", async () => {
    render(<App />);

    expect(await screen.findByText("Contents")).toBeTruthy();
    expect(await screen.findAllByText("GUI Session")).toHaveLength(2);
    expect(await screen.findByText("Initial prompt")).toBeTruthy();
    expect(await screen.findByText("Ready.")).toBeTruthy();
  });

  it("renders an empty log state before a log exists", async () => {
    vi.mocked(api.getStatus).mockResolvedValue(statusResponse({ log: emptyLog() }));

    render(<App />);

    expect(await screen.findByText("No log selected")).toBeTruthy();
    expect(await screen.findByText("Submit an assistant prompt to start the log.")).toBeTruthy();
  });

  it("browses historical logs as read-only selections", async () => {
    const historicalLog = {
      ...initialLog,
      filePath: "logs/old.json",
      exchanges: [{ user: "Past question", title: "Old Session", assistant: "Past answer." }],
      readOnly: true
    };
    vi.mocked(api.getStatus).mockResolvedValue(statusResponse({ log: {
      ...initialLog,
      files: [
        ...(initialLog.files ?? []),
        {
          active: false,
          filePath: "logs/old.json",
          label: "old"
        }
      ]
    } }));
    vi.mocked(api.getLog).mockResolvedValueOnce(historicalLog);

    render(<App />);

    const select = await screen.findByLabelText("Log file");
    expect(screen.getByRole("option", { name: "old" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "logs/old.json" } });

    await waitFor(() => {
      expect(
        vi.mocked(api.getLog).mock.calls.some(([options]) => (
          options.filePath === "logs/old.json" && typeof options.sessionId === "string"
        ))
      ).toBe(true);
    });
    expect(await screen.findByText("Read only: logs/old.json")).toBeTruthy();
    expect(await screen.findAllByText("Old Session")).toHaveLength(2);
    expect(await screen.findByText("Past question")).toBeTruthy();
    expect(await screen.findByText("Past answer.")).toBeTruthy();
  });

  it("starts a new lazy log session", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "New session" }));

    expect(await screen.findByText("No log selected")).toBeTruthy();
    expect(await screen.findByText("Submit an assistant prompt to start the log.")).toBeTruthy();
  });

  it("switches back to the active log after submitting while browsing history", async () => {
    vi.mocked(api.getStatus).mockResolvedValue(statusResponse({ log: {
      ...initialLog,
      files: [
        ...(initialLog.files ?? []),
        {
          active: false,
          filePath: "logs/old.json",
          label: "old"
        }
      ]
    } }));
    vi.mocked(api.getLog).mockResolvedValueOnce({
      ...initialLog,
      filePath: "logs/old.json",
      exchanges: [{ user: "Old prompt", title: "Old Session", assistant: "Old answer." }],
      readOnly: true
    });
    vi.mocked(api.askAssistant).mockResolvedValue(operationResult({
      log: {
        ...initialLog,
        exchanges: [{ user: "Write to active session", title: "New Session Answer", assistant: "New answer." }]
      }
    }));

    render(<App />);

    const select = await screen.findByLabelText("Log file");
    fireEvent.change(select, { target: { value: "logs/old.json" } });
    expect(await screen.findAllByText("Old Session")).toHaveLength(2);

    fireEvent.change(screen.getByPlaceholderText(/Ask about Eberron/i), {
      target: { value: "Write to active session" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => {
      expect(api.askAssistant).toHaveBeenCalledWith("Write to active session", expect.any(String), true);
    });
    expect(await screen.findByText("Current session: logs/session.json")).toBeTruthy();
    expect(await screen.findAllByText("New Session Answer")).toHaveLength(2);
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
  exchanges: [],
  files: [],
  filePath: null,
  readOnly: false
});

const statusResponse = (overrides: Partial<api.ApiStatus> = {}): api.ApiStatus => ({
  activeOperation: null,
  console: { entries: [] },
  log: initialLog,
  npcs: emptyNpcs(),
  ...overrides
});
