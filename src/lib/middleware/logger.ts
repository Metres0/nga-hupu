export interface LogEntry {
  timestamp: number;
  method: string;
  url: string;
  status: number;
  duration: number;
  error?: string;
}

const logBuffer: LogEntry[] = [];
const MAX_BUFFER = 100;

export function logRequest(entry: Omit<LogEntry, "timestamp">): void {
  const record: LogEntry = { ...entry, timestamp: Date.now() };
  logBuffer.push(record);

  if (logBuffer.length > MAX_BUFFER) {
    logBuffer.shift();
  }

  const level = entry.error ? "ERROR" : entry.status >= 400 ? "WARN" : "INFO";
  console.log(
    `[${level}] ${entry.method} ${entry.url} -> ${entry.status} (${entry.duration}ms)` +
    (entry.error ? ` err=${entry.error}` : "")
  );
}

export function getRecentLogs(limit: number = 20): LogEntry[] {
  return logBuffer.slice(-limit);
}

export function clearLogs(): void {
  logBuffer.length = 0;
}
