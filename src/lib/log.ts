import path from "node:path";
import { styleText } from "node:util";
import pino from "pino";
import { OUTPUT_DIR } from "../config.js";

export const LOG_FILE = path.join(OUTPUT_DIR, "logs", "run.log");

const LEVELS: Record<number, [label: string, color: "green" | "yellow" | "red"]> = {
  30: ["INFO ", "green"],
  40: ["WARN ", "yellow"],
  50: ["ERROR", "red"],
  60: ["FATAL", "red"],
};

// Crawlee-style console line: "INFO  Scraper: message". styleText already
// follows the color conventions: TTY detection, NO_COLOR and FORCE_COLOR.
const consoleStream = {
  write(line: string) {
    const { level, msg } = JSON.parse(line) as { level: number; msg: string };
    const [label, color] = LEVELS[level] ?? LEVELS[30]!;
    const style = (format: Parameters<typeof styleText>[0], text: string) =>
      styleText(format, text, { stream: process.stderr });
    process.stderr.write(`${style(color, label)} ${style("gray", "Scraper:")} ${msg}\n`);
  },
};

// Usage: log.info(fields, message). The console shows the message (on
// stderr); run.log gets one JSON line with the message and the fields.
export const log = pino(
  { level: "debug" },
  pino.multistream([
    { level: "info", stream: consoleStream },
    { level: "debug", stream: pino.destination({ dest: LOG_FILE, mkdir: true, sync: true }) },
  ]),
);
