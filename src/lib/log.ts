import path from "node:path";
import pino from "pino";
import { OUTPUT_DIR } from "../config.js";

export const LOG_FILE = path.join(OUTPUT_DIR, "logs", "run.log");

// Colors only for a person at a terminal (clig.dev, no-color.org):
// FORCE_COLOR wins, then NO_COLOR, then "is stderr a TTY?".
const useColor = process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== "0"
  : !process.env.NO_COLOR && process.stderr.isTTY === true;

// Usage: log.info(fields, message). The console shows the message; run.log
// gets one JSON line with the message and the fields.
export const log = pino(
  { level: "debug" },
  pino.transport({
    targets: [
      {
        target: "pino-pretty",
        level: "info",
        options: {
          destination: 2, // status messages belong on stderr
          colorize: useColor,
          // Only the level is colored, so warnings and errors stand out.
          customColors: "info:green,warn:yellow,error:red,fatal:red,message:reset",
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
          hideObject: true,
        },
      },
      {
        target: "pino/file",
        level: "debug",
        options: { destination: LOG_FILE, mkdir: true },
      },
    ],
  }),
);
