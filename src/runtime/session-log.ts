import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SessionLog {
  append(exchange: SessionLogExchange): Promise<void>;
  appendMarkdown(markdown: string): Promise<void>;
  readonly filePath: string;
}

export interface SessionLogExchange {
  assistantResponse: string;
  userQuestion: string;
}

export interface SessionLogCreateRequest {
  logDir: string;
  now?: Date;
  title: string;
}

export interface SessionLogFile {
  active: boolean;
  filePath: string;
  label: string;
}

const FALLBACK_TITLE = "Untitled Session";
const NON_TRANSCRIPT_LOG_FILES = new Set(["generated_npcs.md"]);

export const createSessionLog = async (request: SessionLogCreateRequest): Promise<SessionLog> => {
  const startedAt = request.now ?? new Date();
  const title = sanitizeSessionTitle(request.title);

  await mkdir(request.logDir, { recursive: true });
  const filePath = await createUniqueSessionLogFile(request.logDir, startedAt, title);

  return {
    filePath,
    async append(exchange) {
      await writeFile(filePath, formatExchange(exchange), {
        flag: "a",
        encoding: "utf8"
      });
    },
    async appendMarkdown(markdown) {
      await writeFile(filePath, normalizeMarkdownAppend(markdown), {
        flag: "a",
        encoding: "utf8"
      });
    }
  };
};

const createUniqueSessionLogFile = async (logDir: string, startedAt: Date, title: string): Promise<string> => {
  const timestamp = formatTimestamp(startedAt);
  const content = [`# ${title}`, "", `Started: ${startedAt.toISOString()}`, ""].join("\n");

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const suffix = attempt === 1 ? "" : ` ${attempt}`;
    const filePath = path.join(logDir, `${timestamp} ${title}${suffix}.md`);
    try {
      await writeFile(filePath, content, {
        flag: "wx",
        encoding: "utf8"
      });
      return filePath;
    } catch (error) {
      if (!hasNodeErrorCode(error, "EEXIST")) {
        throw error;
      }
    }
  }

  throw new Error("Unable to create a unique session log filename.");
};

export const sanitizeSessionTitle = (title: string): string => {
  const sanitized = title
    .split("")
    .map((character) => (isUnsafeFilenameCharacter(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.()[\]{}_-]+|[\s.()[\]{}_-]+$/g, "");

  return sanitized.length > 0 ? sanitized : FALLBACK_TITLE;
};

export const listSessionLogFiles = async (
  logDir: string,
  activeFilePath: string | null = null
): Promise<SessionLogFile[]> => {
  let entries;
  try {
    entries = await readdir(logDir, { withFileTypes: true });
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const activeResolved = activeFilePath ? path.resolve(activeFilePath) : null;
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === ".md" &&
        !NON_TRANSCRIPT_LOG_FILES.has(entry.name.toLowerCase())
    )
    .map((entry) => {
      const filePath = path.join(logDir, entry.name);
      return {
        active: activeResolved !== null && path.resolve(filePath) === activeResolved,
        filePath,
        label: entry.name
      };
    })
    .sort((left, right) => right.label.localeCompare(left.label));
};

export const readSessionLogFile = async (logDir: string, filePath: string): Promise<string> => {
  const root = path.resolve(logDir);
  const candidate = path.resolve(root, filePath);

  if (path.dirname(candidate) !== root || path.extname(candidate).toLowerCase() !== ".md") {
    throw new Error("Selected log file must be a Markdown file directly inside the log directory.");
  }

  return readFile(candidate, "utf8");
};

const isUnsafeFilenameCharacter = (character: string): boolean => {
  return '\\/:*?"<>|'.includes(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127;
};

const hasNodeErrorCode = (error: unknown, code: string): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  );
};

const formatTimestamp = (date: Date): string => {
  const pad = (value: number): string => value.toString().padStart(2, "0");

  return [
    date.getFullYear().toString(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
};

const formatExchange = (exchange: SessionLogExchange): string => {
  return [
    "## User",
    "",
    exchange.userQuestion.trimEnd(),
    "",
    "## Assistant",
    "",
    exchange.assistantResponse.trimEnd(),
    ""
  ].join("\n");
};

const normalizeMarkdownAppend = (markdown: string): string => {
  const trimmed = markdown.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n\n` : "";
};
