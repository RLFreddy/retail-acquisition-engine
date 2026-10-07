import "dotenv/config";

const int = (name: string, fallback: number): number => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
};

export const INPUT_CSV = process.env.INPUT_CSV || "searchresults.csv";
export const OUTPUT_DIR = process.env.OUTPUT_DIR || "data";
export const LIMIT = int("LIMIT", 0); // 0 = all products

export const CONCURRENCY = Math.max(1, int("CONCURRENCY", 4));
export const DELAY_MS = int("DELAY_MS", 500); // at most one product starts every DELAY_MS
export const RETRIES = int("RETRIES", 4);
export const RETRY_DELAY_MS = int("RETRY_DELAY_MS", 5_000); // doubled on each retry
export const TIMEOUT_MS = int("TIMEOUT_MS", 20_000);

export const USER_AGENT =
  process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const BASE_URL = "https://www.2ndswing.com/";
