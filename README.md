# retail-acquisition-engine

Scraper for [2ndswing.com](https://www.2ndswing.com) that takes the products in
`searchresults.csv` and captures, for each one, its details, images, every valid
configuration (hand, shaft, flex, loft…) with its price, and every
customization option (grips, lie, loft…) with its price change. It uses plain
HTTP requests and the JSON that the store (Magento 2) embeds in each product
page: no headless browser, one request per product.

## Results

Full run of the 700 products in the CSV (output in `results/`, a 5-product
sample in [`sample-output/`](sample-output/)):

| Metric                  | Value                                         |
| ----------------------- | --------------------------------------------- |
| Products captured       | **696 / 700** (99.4%)                         |
| Valid configurations    | 280,886 variants, each with its price         |
| Customization options   | 39,703, each with its price change            |
| HTTP requests           | 700 (one per product), 0 retries, 0 blocks    |
| Runtime                 | 8 min 3 s, ~87 products/min, concurrency 4    |
| Time per product        | median 2.4 s · p95 4.4 s · max 20 s           |

Measured from a home connection (WSL) through a US VPN; times vary with the
network. The 4 products not captured are not available on the site (see
[Data that could not be captured](#data-that-could-not-be-captured-reliably)).

## How to run

**Requirements:** Node 24, pnpm 10 (bundled with Node: run `corepack enable`),
and a **US IP address**. The site only serves its catalog to US visitors: from
other countries every product page answers HTTP 406. Outside the US, use a US
VPN; Docker uses the host's network, so the VPN covers it too. `make` is
optional: every target maps to a `pnpm` script.

```bash
make install      # or: pnpm install
make dev          # scrape all products (or: pnpm dev)
make dev LIMIT=10 # quick test with the first 10 products
make test         # typecheck + 21 tests (no network needed)
make              # list every command
```

With Docker (no local Node needed):

```bash
make docker-build
make docker-run            # or: docker compose run --rm scraper
make docker-run LIMIT=10
```

**Output** goes to `data/` (`data_docker/` with Docker). The folder is
git-ignored because `output.json` is ~110 MB. Two copies come with the
submission:

- [`sample-output/`](sample-output/) (in git): 5 products of different types
  (putter, iron set, wedge, driver shaft, hybrid), in exactly the same format as
  the full output, plus the full run's `run-report.json`. No need to run
  anything to see the result.
- `results/` (not in git, delivered separately): the full output of the run
  described above, also as `retail-acquisition-engine-results.zip` (4.4 MB).

**Configuration** is optional: copy `.env.example` to `.env`. It covers the
input CSV, output folder, concurrency, delays, retries and thresholds. One
`.env` works for both `make dev` and Docker.

**Resuming:** progress is saved per product in `data/scraper.db` (SQLite). If a
run is interrupted (Ctrl+C, VPN drop), running it again continues where it
stopped; the output files are rebuilt from that state at the end, so nothing
already scraped is lost. `make reset` deletes all output to start from scratch.

**Exit code:** 0 on success; 1 if nothing was extracted or more than 10% of
products failed, so a scheduler or CI notices a bad run. A run stopped because
the site keeps blocking also exits 1: the products it never reached count as
failures.

## Data model

| File                 | Content                                                         |
| -------------------- | --------------------------------------------------------------- |
| `output.json`        | One record per product (main deliverable)                       |
| `variants.csv`       | One row per valid configuration, for spreadsheets               |
| `customizations.csv` | One row per customization option, for spreadsheets              |
| `run-report.json`    | Run metrics and the list of failed products with the reason     |
| `logs/run.log`       | One JSON line per event (start, product, retry, failure, end)   |

A product record in `output.json`:

```jsonc
{
  "id": "PRO S4 STS",                 // CSV "Parent Item" = the site's SKU
  "name": "Mizuno Pro S-4 Iron Set", "brand": "Mizuno",
  "category": "Iron Set", "model": "Pro S-4",
  "url": "https://www.2ndswing.com/golf-clubs/iron-sets/…/pro-s4-sts",
  "title": "Mizuno Pro S-4 Iron Set",
  "base_price": 215,
  "pricing_unit": "per_club",         // iron sets are priced per club
  "price_range": { "min": 215, "max": 275 },
  "included_clubs": ["4 Iron", "5 Iron", "…", "PW"],
  "media": ["https://www.2ndswing.com/images/standard/PRO%20S4%20STS.jpg", "…"],
  "attributes": [                     // configurable axes, in selection order
    { "code": "g2_dexterity", "label": "Dexterity", "options": ["Right Handed", "Left Handed"] },
    "… Shaft Material, Shaft Flex, Shaft Model"
  ],
  "variants": [                       // every valid configuration
    {
      "sku": "C4605039",
      "options": { "Dexterity": "Left Handed", "Shaft Material": "Graphite",
                   "Shaft Flex": "Stiff", "Shaft Model": "Aerotech SteelFiber i110" },
      "final_price": 275, "regular_price": 275,
      "price_modifier": 60            // final_price − base_price
    }
  ],
  "customizations": [                 // add-ons on top of the configuration
    { "category": "Ferrule", "option_name": "ICON (Black/Blue/White)",
      "price_modifier": 2.5, "final_price": 217.5 }
  ],
  "extraction_time_ms": 2222,
  "scraped_at": "2026-10-07T04:03:47.966Z"
}
```

**Base price.** `base_price` is the price the site shows as "Starting at" for
the product; both kinds of options are priced against it.

**Variants vs customizations.** A variant is a real SKU the store sells (a
combination of the configurable attributes); its price is absolute, so
`price_modifier = final_price − base_price`. A customization is an add-on
chosen on top (grip, wrap, lie, loft, length…); the site gives its extra cost,
so `final_price = base_price + price_modifier`. For iron sets (`per_club`), both
prices are per club.

## Conditional-option discovery

Magento builds the option dropdowns in the browser from JSON embedded in the
page (`<script type="text/x-magento-init">`). The scraper reads that JSON
directly, so it gets every valid combination at once, without clicking through
the UI:

- `spConfig.attributes` (`spConfig` is Magento's configurable-product data):
  each configurable axis and its options.
- `spConfig.index`: **only the combinations that exist**, as
  `simple product id → { attribute → option }`.
- `spConfig.optionPrices` and `spConfig.sku`: each combination's price and SKU.

As the user picks options, the page filters each later dropdown against this
index; that is why options appear or change based on earlier selections. The
scraper enumerates the index directly instead. For example, the OPUS SP wedge has
6 bounces × 5 grinds × 9 lofts × 2 materials × 2 hands × 8 flexes × 81 shafts,
which is ~700,000 theoretical combinations; the index lists the **3,888** the
store actually sells, and the output contains exactly those.

Two details matter for accuracy. Attribute IDs are numeric strings ("626",
"632"), which JavaScript orders numerically rather than as on the page, so
attributes are sorted by their `position` field to keep the selection order. And a combination is only kept if it has a price and a value for every
attribute.

Customization options come from a second block (`ironsetOptions.optionConfig`).
They are not conditional: the JSON exposes no dependency between them, so they
apply to any configuration.

## Runtime and trade-offs

**Approach: HTTP + embedded JSON, no browser.** One GET per product returns
everything, including combinations that a browser would only reveal after
several clicks. A headless browser would add seconds and hundreds of MB of RAM
per page and gain nothing here. The trade-off is that the scraper depends on
Magento's JSON shape. To make that safe, every block is validated with zod (a schema-validation library); if
the site changes a field, the product fails with
`site data changed in spConfig: …` instead of producing silently empty data.
Of the page HTML, only the option-group names ("Grips", "Lie Angle") and their
display order are read, because the site exposes them nowhere else (GraphQL was
checked and returns null for these custom option types).

**Direct product URL instead of the site search.** The CSV's `Parent Item` is
the store SKU, and every product lives at `/<sku-slug>`
(lowercase, `.` → `dot`, spaces → `-`: `LINK 2.2 PUT` → `/link-2dot2-put`). That avoids the search page, which is
disallowed in `robots.txt`, started answering HTTP 406 after ~30 searches in
an early test, and often needs a second request. The parent SKU on the page is
checked against the CSV, so the scraper never records the wrong product.

**Politeness vs speed.** Four requests run in parallel, at most one new product
starts every 500 ms, connections are reused (keep-alive), and requests that get
406, 429 or 5xx are retried with exponential backoff (5 s, 10 s, 20 s, 40 s). If
the site blocks three products in a row, the run stops instead of pressing on.
`robots.txt` asks for `Crawl-delay: 10`; honoring it would make the run ~2 hours
for 700 pages. For a single run of 700 requests, the current pace (8 minutes,
no errors or blocks from the site) was judged considerate enough. A daily
production job should honor it instead (see the pipeline design). Requests use
a browser-like User-Agent; nothing else is done to avoid blocks: no proxies, and
the run stops when blocked.

**How runtime was measured.** `performance.now()` around each product (download
and parse) gives `extraction_time_ms`. The whole run is timed the same way, and
`run-report.json` reports the total, products per minute and p50/p95/max per
product.

**Where it could be faster:**

- **Download size dominates.** Pages with many combinations are large: the OPUS
  wedge page is 2.6 MB (1.1 s to download, 0.5 s to parse), and the largest
  product (26,400 variants) took 20 s. Raising concurrency would cut wall-clock
  time, at the cost of more load on the site.
- **Output is built in memory.** `output.json` is written at the end (~110 MB).
  Streaming it as JSON Lines would keep memory flat for much larger catalogs.

## Data that could not be captured reliably

**4 products**, all unavailable on the site, listed with the reason in
`run-report.json`:

| SKU                    | Reason                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `2026 HL MAX D WGS`    | Out of stock: the site shows $0.00 and no configurations     |
| `2026 HL MAX D FWG`    | Out of stock: same as above                                  |
| `KM2 PUT`              | No product page (404); a manual site search finds nothing    |
| `STAFF MOD TG NEW WGS` | Redirects to a generic model page with no product data       |

**Not captured, or only partially:**

- **Total price of an iron set.** Prices are per club; the number of clubs is a
  separate choice ("Irons In Set"), so the set total is left to the consumer
  (`included_clubs` lists the default set).
- **Dependencies between customization options** (for example, grip size per
  grip model): the site's JSON does not expose them.
- **Stock per configuration:** the stock field in the JSON is empty on the
  pages checked, so availability is only known per product.
- **Used inventory:** the site also sells individual used clubs (separate SKUs
  such as `D-92649563653`). Only the parent products in the CSV were in scope.
- **Media:** the site has one product image per SKU (two renditions,
  `standard` and `representative`); there are no per-configuration images.

## Running it in production

**Run.** The Docker image runs as a one-off job (Cloud Run Jobs, ECS Fargate or
a cron host) in a US region, which provides the US IP without a VPN. All
settings come from environment variables. Output files go to object storage.

**Monitor.**

- Exit code 1 means a bad run (nothing extracted, or >10% failed); the scheduler
  alerts on it.
- `logs/run.log` is structured JSON (one event per line: `product_ok`,
  `product_failed`, `retry`, `run_stopped`…), ready for a log platform.
- `run-report.json` gives the metrics to track over time: success rate,
  products per minute, p95, requests.
- Signals worth an alert: `retry` and `run_stopped` events (the site is
  throttling or blocking), and `site data changed in …` errors (the parser
  needs updating).

**Maintain.**

- zod schemas pinpoint exactly which field changed when the site evolves.
- 21 offline tests cover parsing, pricing, retries, resume and the quality
  check (`make test`). CI runs the typecheck and build on every push; the tests
  run locally.
- Re-check `robots.txt` periodically and keep dependencies up to date.

## Daily CSV pipeline (design)

An outline, not implemented. It builds on what the scraper already has: the
SQLite run state, `scraped_at` on every record, the zod schema checks and the
quality-check exit code.

```
Scheduler (daily, US region)
        │
        ▼
Diff today's CSV against yesterday's ──► new / removed / kept SKUs
        │
        ▼
Scrape new SKUs and refresh kept ones
        │
        ▼
Hash each record and compare it with the current version
        │
        ▼
Store the history in PostgreSQL (versioned, see History)
        │
        ▼
Daily report and alerts (Slack / email)
```

### 1. New and removed products

The CSV is keyed by `Parent Item` (the site SKU). Each day's file is compared
with the previous one:

- **New SKUs** are scraped and inserted.
- **Removed SKUs** are marked inactive, never deleted, so their history stays.
- **Kept SKUs** are refreshed daily, at the pace `robots.txt` asks for
  (`Crawl-delay: 10`, ~2 hours for 700 products), which suits an unattended job:
  `CONCURRENCY=1 DELAY_MS=10000`.

Today's `scraper.db` already skips finished products within a run. The daily
version keys that state by run date, so every SKU is refreshed once per day and
re-running the same day resumes instead of starting over or duplicating rows.

### 2. Detecting changes

Each record gets a **content hash**: SHA-256 of the normalized JSON, with keys
sorted and volatile fields (`extraction_time_ms`, `scraped_at`) removed. If the
hash matches the current version, nothing is written except `last_seen`. If it
differs, the fields are compared to classify the change:

- base price changed;
- variant price changed (by variant SKU);
- variant added or removed (a configuration appeared or disappeared);
- customization option added, removed or re-priced;
- product out of stock, or no longer found on the site.

Out-of-stock and not-found products are recorded as status changes, not as
failures (unlike the current single run, which lists them as failed), so a
wave of stock-outs does not fail the daily run. The failure rate only counts
errors: HTTP errors, blocks and parsing failures.

### 3. History (SCD Type 2)

Changes are stored as versions (Slowly Changing Dimension Type 2, the usual
data-warehouse pattern): a change closes the current row (`valid_to`, `is_current = false`)
and inserts a new one. Any past price can be queried, and the current state is
`is_current = true`.

```
products         (sku PK, name, brand, category, active, first_seen, last_seen)
product_versions (sku, content_hash, data JSONB, valid_from, valid_to, is_current)
variant_prices   (variant_sku, product_sku, options JSONB, final_price,
                  regular_price, valid_from, valid_to, is_current)
customization_prices (product_sku, category, option_name, price_modifier,
                      valid_from, valid_to, is_current)
runs             (run_id, started_at, finished_at, ok, failed, requests, status)
```

An append-only table (one row per variant per day) is simpler, but it would
add ~280,000 mostly identical rows a day (~100 million a year). Versioning only
stores what actually changed.

### 4. Flagging changes and failures

One **daily summary** goes to Slack or email, linking to the run report:

- **Changes:** new products, price changes (old → new price, % change, URL;
  moves above 10% are flagged for review), variants added or removed, products
  out of stock or gone.
- **Failures:**
  - the run exits with code 1 (nothing extracted, or more than 10% failed);
  - coverage drops (share of the CSV scraped);
  - runtime exceeds twice the usual;
  - zod reports `site data changed in …`, meaning the site's JSON changed and
    the parser needs maintenance;
  - repeated HTTP 406, meaning the egress IP is blocked or not in the US.

### 5. Scheduling

Same setup as [Running it in production](#running-it-in-production), triggered
daily by a scheduler (cron, Cloud Scheduler or EventBridge). The history goes to
managed PostgreSQL.
