export const apiKeys = {
  console: () => ["api", "console"] as const,
  context: () => ["api", "context"] as const,
  logPrefix: () => ["api", "log"] as const,
  log: (sessionId: string, filePath?: string) =>
    ["api", "log", sessionId, filePath ?? null] as const,
  npcs: () => ["api", "npcs"] as const,
  status: (sessionId: string) => ["api", "status", sessionId] as const,
  statusPrefix: () => ["api", "status"] as const
};
