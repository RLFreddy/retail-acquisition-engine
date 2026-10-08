import https from "node:https";
import axios from "axios";
import {
  CONCURRENCY,
  RETRIES,
  RETRY_DELAY_MS,
  TIMEOUT_MS,
  USER_AGENT,
} from "../config.ts";
import { log } from "./log.ts";
import { sleep } from "./time.ts";

const client = axios.create({
  timeout: TIMEOUT_MS,
  responseType: "text",
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY }),
  headers: {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  },
});

// 406/429 = blocked or rate limited by the CDN; 408/5xx = transient.
const RETRYABLE_STATUSES = new Set([406, 408, 429, 500, 502, 503, 504]);

let requestCount = 0;
export const getRequestCount = (): number => requestCount;

// A 406 that survives every retry means this IP is blocked: rate limited,
// or not a US IP (the catalog is US-only).
export class BlockedError extends Error {
  constructor(url: string) {
    super(`blocked by the site (HTTP 406) on ${url}`);
    this.name = "BlockedError";
  }
}

// GET with retries; returns the body as text, or null on 404.
export async function fetchText(url: string): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    requestCount++;
    try {
      return (await client.get<string>(url)).data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 404) return null;
      // No status = network error or timeout.
      const retryable = status === undefined || RETRYABLE_STATUSES.has(status);
      if (status === 406 && attempt >= RETRIES) throw new BlockedError(url);
      if (!retryable || attempt >= RETRIES) throw err;
      const wait = RETRY_DELAY_MS * 2 ** attempt;
      log.warn(
        { event: "retry", status, data: { url, retryCount: attempt + 1, waitSecs: wait / 1000 } },
        `Reclaiming failed request back to the queue. ${status ? `HTTP ${status}` : "Network error"}`,
      );
      await sleep(wait);
    }
  }
}
