import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SessionLog {
  append(exchange: SessionLogExchange): Promise<void>;
  readonly filePath: string;
}

export interface SessionLogExchange {
  assistant: string;
  title: string;
  user: string;
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
const MAX_SESSION_TITLE_LENGTH = 80;
const TIMESTAMPED_LOG_FILENAME_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s+(.+)$/;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const createSessionLog = async (request: SessionLogCreateRequest): Promise<SessionLog> => {
  const startedAt = request.now ?? new Date();
  const title = sanitizeSessionTitle(request.title);

  await mkdir(request.logDir, { recursive: true });
  const filePath = await createUniqueSessionLogFile(request.logDir, startedAt, title);

  return {
    filePath,
    async append(exchange) {
      const exchanges = await readSessionLogFile(path.dirname(filePath), filePath);
      exchanges.push(normalizeExchange(exchange));
      await writeFile(filePath, `${JSON.stringify(exchanges, null, 2)}\n`, "utf8");
    }
  };
};

const createUniqueSessionLogFile = async (logDir: string, startedAt: Date, title: string): Promise<string> => {
  const timestamp = formatTimestamp(startedAt);
  const content = "[]\n";

  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const suffix = attempt === 1 ? "" : ` ${attempt}`;
    const filePath = path.join(logDir, `${timestamp} ${title}${suffix}.json`);
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
  const readableTitle = normalizeReadableTitle(title);
  const sanitized = readableTitle
    .split("")
    .map((character) => (isUnsafeFilenameCharacter(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.()[\]{}_-]+|[\s.()[\]{}_-]+$/g, "");

  const normalizedTitle = sanitized.length > 0 ? sanitized : FALLBACK_TITLE;
  return normalizedTitle.length <= MAX_SESSION_TITLE_LENGTH
    ? normalizedTitle
    : normalizedTitle.slice(0, MAX_SESSION_TITLE_LENGTH).trimEnd();
};

const normalizeReadableTitle = (title: string): string => {
  const trimmed = title.trim();
  const hadSpaces = /\s/.test(trimmed);
  const hadMachineSeparators = /[_-]/.test(trimmed);
  const separated = trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  if (!hadSpaces && (hadMachineSeparators || /^[a-z]/.test(separated))) {
    return titleCaseWords(separated);
  }

  return separated;
};

const titleCaseWords = (title: string): string => {
  return title
    .split(" ")
    .map((word) => {
      if (word.length === 0 || /[a-z][A-Z]/.test(word)) {
        return word;
      }
      if (/^[A-Z]{2,3}$/.test(word)) {
        return word;
      }
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
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
        path.extname(entry.name).toLowerCase() === ".json"
    )
    .map((entry) => {
      const filePath = path.join(logDir, entry.name);
      return {
        active: activeResolved !== null && path.resolve(filePath) === activeResolved,
        filePath,
        label: formatSessionLogFileLabel(entry.name)
      };
    })
    .sort((left, right) => path.basename(right.filePath).localeCompare(path.basename(left.filePath)));
};

export const readSessionLogFile = async (logDir: string, filePath: string): Promise<SessionLogExchange[]> => {
  const root = path.resolve(logDir);
  const candidate = path.resolve(root, filePath);

  if (path.dirname(candidate) !== root || path.extname(candidate).toLowerCase() !== ".json") {
    throw new Error("Selected log file must be a JSON file directly inside the log directory.");
  }

  const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Session log file must contain a JSON array.");
  }

  return parsed.map((exchange): SessionLogExchange => {
    if (isSessionLogExchangeRecord(exchange)) {
      return normalizeExchange({
        assistant: exchange.assistant,
        title: exchange.title,
        user: exchange.user
      });
    }
    throw new Error("Session log file contains an invalid exchange record.");
  });
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

const formatSessionLogFileLabel = (filename: string): string => {
  const basename = path.basename(filename, path.extname(filename));
  const match = TIMESTAMPED_LOG_FILENAME_PATTERN.exec(basename);
  if (!match) {
    return basename;
  }

  const [, year, month, day, hour, minute, , title] = match;
  const monthIndex = Number(month) - 1;
  const hour24 = Number(hour);
  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  const monthLabel = MONTH_LABELS[monthIndex] ?? month;

  return `${monthLabel} ${Number(day)}, ${year} ${hour12}:${minute} ${period} - ${title}`;
};

const normalizeExchange = (exchange: SessionLogExchange): SessionLogExchange => {
  return {
    assistant: exchange.assistant.trim(),
    title: exchange.title.trim() || "Untitled Response",
    user: exchange.user.trim()
  };
};

const isSessionLogExchangeRecord = (value: unknown): value is SessionLogExchange => {
  return (
    typeof value === "object" &&
    value !== null &&
    "user" in value &&
    typeof value.user === "string" &&
    "assistant" in value &&
    typeof value.assistant === "string" &&
    "title" in value &&
    typeof value.title === "string"
  );
};
