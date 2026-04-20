type LogLevel = "debug" | "info" | "warn" | "error";

// Cloud Logging severity mapping:
// https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
const severityMap: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

function emit(level: LogLevel, payload: Record<string, unknown>) {
  const entry = {
    severity: severityMap[level],
    timestamp: new Date().toISOString(),
    ...payload,
  };
  // stdout → Cloud Run → Cloud Logging auto-ingest
  console.log(JSON.stringify(entry));
}

export const logger = {
  debug: (payload: Record<string, unknown>) => emit("debug", payload),
  info: (payload: Record<string, unknown>) => emit("info", payload),
  warn: (payload: Record<string, unknown>) => emit("warn", payload),
  error: (payload: Record<string, unknown>) => emit("error", payload),
};
