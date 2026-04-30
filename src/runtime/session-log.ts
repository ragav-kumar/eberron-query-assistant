import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SessionLog {
  append(exchange: SessionLogExchange): Promise<void>;
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

const FALLBACK_TITLE = "Untitled Session";

export const createSessionLog = async (request: SessionLogCreateRequest): Promise<SessionLog> => {
  const startedAt = request.now ?? new Date();
  const title = sanitizeSessionTitle(request.title);
  const filePath = path.join(request.logDir, `${formatTimestamp(startedAt)} ${title}.md`);

  await mkdir(request.logDir, { recursive: true });
  await writeFile(filePath, [`# ${title}`, "", `Started: ${startedAt.toISOString()}`, ""].join("\n"), {
    flag: "wx",
    encoding: "utf8"
  });

  return {
    filePath,
    async append(exchange) {
      await writeFile(filePath, formatExchange(exchange), {
        flag: "a",
        encoding: "utf8"
      });
    }
  };
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

const isUnsafeFilenameCharacter = (character: string): boolean => {
  return '\\/:*?"<>|'.includes(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127;
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
