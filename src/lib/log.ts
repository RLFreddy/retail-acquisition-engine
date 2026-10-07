import path from "node:path";
import { styleText } from "node:util";
import pino from "pino";
import { OUTPUT_DIR } from "../config.js";

// One log file per run, named by its start time: logs/run-2026-10-07T04-04-47.log
const runStamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
export const LOG_FILE = path.join(OUTPUT_DIR, "logs", `run-${runStamp}.log`);

type LogLine = { level: number; msg?: string; data?: unknown; err?: { stack?: string } };

const LEVELS: Record<number, [label: string, color: "green" | "yellow" | "red"]> = {
  30: ["INFO", "green"],
  40: ["WARN", "yellow"],
  50: ["ERROR", "red"],
};

// styleText already follows the color conventions (TTY, NO_COLOR, FORCE_COLOR).
const paint = (color: Parameters<typeof styleText>[0], text: string) =>
  styleText(color, text, { stream: process.stderr });

// Same layout and colors as Crawlee's text logger (@apify/log):
//   INFO  Scraper: message {"data":"in gray"}
function formatLine({ level, msg = "", data, err }: LogLine): string {
  const [label, color] = LEVELS[level] ?? LEVELS[30]!;
  const dataText = data === undefined ? "" : paint("gray", ` ${JSON.stringify(data)}`);
  const stackText = (err?.stack?.split("\n").slice(1) ?? [])
    .map((frame) => `\n  ${paint("gray", frame.trim())}`)
    .join("");
  return `${paint(color, label.padEnd(5))}${paint("yellow", " Scraper:")} ${msg}${dataText}${stackText}\n`;
}

// Usage: log.info({ event, data }, message). The console (stderr) shows the
// message plus `data` in gray; the run's log file gets every field as one JSON line.
export const log = pino(
  { level: "debug" },
  pino.multistream([
    { level: "info", stream: { write: (line: string) => process.stderr.write(formatLine(JSON.parse(line))) } },
    { level: "debug", stream: pino.destination({ dest: LOG_FILE, mkdir: true, sync: true }) },
  ]),
);
