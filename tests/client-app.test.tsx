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

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(api.getContext).mockResolvedValue("");
  vi.mocked(api.getLog).mockResolvedValue(initialLog);
  vi.mocked(api.getStatus).mockResolvedValue({ busy: false, operation: null });
  vi.mocked(api.askAssistant).mockResolvedValue({ ok: true, log: { ...initialLog, markdown: "## Assistant\n\nAnswer" } });
  vi.mocked(api.debugRetrieval).mockResolvedValue({ ok: true, log: { ...initialLog, markdown: "## Debug Retrieval" } });
  vi.mocked(api.refresh).mockResolvedValue({ ok: true, log: { ...initialLog, markdown: "## Refresh Complete" } });
  vi.mocked(api.writeContext).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App", () => {
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

  it("submits debug retrieval queries", async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("aerenal deathless"), {
      target: { value: "deathless" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(api.debugRetrieval).toHaveBeenCalledWith("deathless");
    });
    expect(await screen.findByText("Debug Retrieval")).toBeTruthy();
  });

  it("persists additional context edits", async () => {
    render(<App />);

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

    const editor = await screen.findByLabelText("Additional Context Editor");
    expect(editor).toHaveProperty("value", "Existing campaign context");
  });

  it("disables operations while busy", async () => {
    vi.mocked(api.getStatus).mockResolvedValue({ busy: true, operation: "refresh" });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Ask" })).toHaveProperty("disabled", true);
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
    expect(await screen.findByText("Submit a prompt or run an action to start the log.")).toBeTruthy();
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
