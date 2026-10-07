import https from "node:https";
import axios from "axios";
import {
  CONCURRENCY,
  RETRIES,
  RETRY_DELAY_MS,
  TIMEOUT_MS,
  USER_AGENT,
} from "../config.js";
import { log } from "./log.js";
import { sleep } from "./time.js";

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

// Returns null on 404 (product gone).
export async function fetchHtml(url: string): Promise<string | null> {
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
        { event: "retry", url, status, attempt: attempt + 1, wait_ms: wait },
        `Reclaiming failed request (${status ?? "network error"}) · ${url} · retry ${attempt + 1}/${RETRIES} in ${wait / 1000}s`,
      );
      await sleep(wait);
    }
  }
}
