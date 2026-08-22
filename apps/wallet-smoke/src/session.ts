import type {
  OpenNoteDeposit,
  SmokeSessionEvent,
  SmokeSessionFile,
} from "./types.ts";

export function createSession(base: Omit<SmokeSessionFile, "events">): {
  file: SmokeSessionFile;
  record: (event: SmokeSessionEvent) => void;
  exportJson: () => string;
} {
  const file: SmokeSessionFile = { ...base, events: [] };
  return {
    file,
    record(event) {
      file.events.push(event);
    },
    exportJson() {
      return `${JSON.stringify(file, null, 2)}\n`;
    },
  };
}

export function redactSecrets(value: string): string {
  if (value.length <= 10) return "[redacted]";
  return `${value.slice(0, 4)}…[redacted]`;
}

export function summarizeDeposits(deposits: OpenNoteDeposit[]): string {
  if (deposits.length === 0) return "empty OpenNoteDeposit span";
  return deposits
    .map((deposit) => `${deposit.amount}@${deposit.token}→${deposit.noteId}`)
    .join(", ");
}
