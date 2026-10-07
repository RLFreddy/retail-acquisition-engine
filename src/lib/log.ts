import path from "node:path";
import { styleText } from "node:util";
import apifyLog, { LoggerText, type LogLevel } from "@apify/log";
import colors from "ansi-colors";
import pino from "pino";
import { LOG_STYLE, OUTPUT_DIR } from "../config.js";

export const LOG_FILE = path.join(OUTPUT_DIR, "logs", "run.log");

type Color = "blue" | "green" | "yellow" | "red";
const LEVELS: Record<number, [label: string, color: Color]> = {
  20: ["DEBUG", "blue"],
  30: ["INFO", "green"],
  40: ["WARN", "yellow"],
  50: ["ERROR", "red"],
  60: ["FATAL", "red"],
};
const LABEL_WIDTH = 5;

const style = (format: Parameters<typeof styleText>[0], text: string) =>
  styleText(format, text, { stream: process.stderr });

// Same layout and colors as Crawlee's text logger (@apify/log LoggerText):
//   INFO  Scraper: message {"data":"in gray"}
// styleText already follows the color conventions (TTY, NO_COLOR, FORCE_COLOR).
const consoleStream = {
  write(line: string) {
    const { level, msg, data, err } = JSON.parse(line) as {
      level: number;
      msg: string;
      data?: unknown;
      err?: { stack?: string };
    };
    const [label, color] = LEVELS[level] ?? LEVELS[30]!;
    const dataText = data === undefined ? "" : style("gray", ` ${JSON.stringify(data)}`);
    const stack = (err?.stack?.split("\n").slice(1) ?? [])
      .map((frame) => `\n  ${style("gray", frame.trim())}`)
      .join("");
    process.stderr.write(
      `${style(color, label.padEnd(LABEL_WIDTH))}${style("yellow", " Scraper:")} ${msg}${dataText}${stack}\n`,
    );
  },
};

type LogLine = { level: number; msg: string; data?: Record<string, unknown>; err?: { message?: string; stack?: string } };

// Alternative: Crawlee's real logger, with its two gaps fixed:
// - its colors (ansi-colors) only check FORCE_COLOR=0 → same rules as styleText;
// - it prints INFO on stdout and WARN/ERROR on stderr → everything on stderr.
colors.enabled = process.env.FORCE_COLOR
  ? process.env.FORCE_COLOR !== "0"
  : !process.env.NO_COLOR && process.stderr.isTTY === true;

class StderrLoggerText extends LoggerText {
  override _outputWithConsole(_level: LogLevel, line: string): void {
    process.stderr.write(`${line}\n`);
  }
}

const crawleeLog = apifyLog.child({ prefix: "Scraper", logger: new StderrLoggerText() });
const crawleeStream = {
  write(line: string) {
    const { level, msg, data, err } = JSON.parse(line) as LogLine;
    if (err) crawleeLog.exception(Object.assign(new Error(err.message), { stack: err.stack }), msg, data);
    else if (level >= 50) crawleeLog.error(msg, data);
    else if (level >= 40) crawleeLog.warning(msg, data);
    else crawleeLog.info(msg, data);
  },
};

// Usage: log.info({ event, data }, message). The console shows the message
// plus `data` in gray; run.log gets every field as one JSON line.
export const log = pino(
  { level: "debug" },
  pino.multistream([
    { level: "info", stream: LOG_STYLE === "crawlee" ? crawleeStream : consoleStream },
    { level: "debug", stream: pino.destination({ dest: LOG_FILE, mkdir: true, sync: true }) },
  ]),
);
