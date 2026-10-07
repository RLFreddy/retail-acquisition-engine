import path from "node:path";
import pino from "pino";
import { OUTPUT_DIR } from "../config.js";

export const LOG_FILE = path.join(OUTPUT_DIR, "logs", "run.log");

// Usage: log.info(fields, message). The console shows the message; run.log
// gets one JSON line with the message and the fields.
export const log = pino(
  { level: "debug" },
  pino.transport({
    targets: [
      {
        target: "pino-pretty",
        level: "info",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname", hideObject: true },
      },
      {
        target: "pino/file",
        level: "debug",
        options: { destination: LOG_FILE, mkdir: true },
      },
    ],
  }),
);
