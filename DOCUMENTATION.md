# retail-acquisition-engine — Documentation

Answers to the challenge questions. For the quick start and configuration, see
the [README](README.md).

| # | Question                                                        | Section                                                       |
| - | --------------------------------------------------------------- | ------------------------------------------------------------- |
| 1 | Data model                                                      | [Data model](#1-data-model)                                   |
| 2 | Conditional-option discovery                                    | [Conditional options](#2-conditional-option-discovery)        |
| 3 | Runtime: trade-offs, how it was measured, where to improve      | [Runtime](#3-runtime)                                         |
| 4 | Data that could not be captured reliably                        | [Not captured](#4-data-that-could-not-be-captured-reliably)   |
| 5 | Run, monitor and maintain in production                         | [Production](#5-production)                                   |
| 6 | Daily CSV: new products, changes, history, flags                | [Daily pipeline](#6-daily-csv-pipeline-design)                |

## 1. Data model

One record per product in `output.json`. The same data is flattened into
`variants.csv` and `customizations.csv` for spreadsheets.

```mermaid
erDiagram
    PRODUCT ||--o{ OPTION : "dropdowns that pick the variant"
    PRODUCT ||--o{ VARIANT : "valid configurations"
    PRODUCT ||--o{ CUSTOMIZATION : "Customize dropdowns"
    CUSTOMIZATION ||--|{ CUSTOMIZATION_OPTION : "choices"
    PRODUCT {
        string sku "site SKU = CSV Parent Item"
        string name
        string brand
        string category
        number base_price "Starting at price"
        string pricing_unit "per_item or per_club"
        number default_set_price "iron sets: base x default clubs"
        string description "one paragraph per line"
        object_list specs "rows of the Specs table"
        object media "images: every gallery image, videos: YouTube URLs"
    }
    OPTION {
        string name "Dexterity, Shaft Flex..."
        string_list values
    }
    VARIANT {
        string sku "real store SKU"
        object options "option name to value"
        number price
        number upcharge "price - base_price"
    }
    CUSTOMIZATION {
        string name "Grips, Lie Angle..."
    }
    CUSTOMIZATION_OPTION {
        string name
        number upcharge "extra cost"
    }
```

| Concept           | What it is                                         | Price rule                          |
| ----------------- | -------------------------------------------------- | ----------------------------------- |
| **Variant**       | A combination the store sells as its own SKU (hand × shaft × flex…) | Absolute `price`; `upcharge = price − base_price` |
| **Customization** | A dropdown of the Customize section (grip, lie, length…) | Each option has an `upcharge`, added to the chosen variant's price |
| **Iron sets**     | `pricing_unit: "per_club"`                         | Both are per club; the site multiplies them by the clubs checked. `default_set_price` = `base_price` × the default clubs (4–PW) |

**Names follow the site.** The product's `sku` is the site's SKU (the CSV's
`Parent Item`); `options` and their `values` are the dropdowns that pick a
variant; `price` and `upcharge` are the price and the "+ $2.50" the site shows
next to an option; `regular_price` is the price before a sale (the same as
`price` for every variant in this run). Values are kept exactly as the site
writes them. In the CSVs, `product_sku` and
`product_name` say which product each row belongs to.

A trimmed record (full examples in [`results/sample/output.json`](results/sample/output.json)):

```jsonc
{
  "sku": "PRO S4 STS", "name": "Mizuno Pro S-4 Iron Set",
  "brand": "Mizuno", "category": "Iron Set", "model": "Pro S-4",
  "url": "https://www.2ndswing.com/golf-clubs/iron-sets/mizuno-pro-s-4-iron-set/pro-s4-sts",
  "base_price": 215, "price_range": { "min": 215, "max": 275 }, "pricing_unit": "per_club",
  "included_clubs": ["4 Iron", "5 Iron", "6 Iron", "7 Iron", "8 Iron", "9 Iron", "PW"], "default_set_price": 1505,
  "description": "Who’s It For?\nDesigned for accomplished golfers who value the soft, responsive feel…",
  "specs": [{ "Club": "3", "Loft": "21°", "Length": "39.25\"", "Bounce": "3°", "Hand": "RH Only" }],
  "media": {
    "images": ["https://www.2ndswing.com/images/standard/PRO%20S4%20STS.jpg",
               "https://www.2ndswing.com/images/representative/PRO%20S4%20STS.jpg"],
    "videos": ["https://www.youtube.com/watch?v=1LNL-MUEc1Y"]
  },
  "options": [{ "code": "g2_dexterity", "name": "Dexterity", "values": ["Right Handed", "Left Handed"] }],
  "variants": [{ "sku": "C4605039",
                 "options": { "Dexterity": "Left Handed", "Shaft Material": "Graphite",
                              "Shaft Flex": "Stiff", "Shaft Model": "Aerotech SteelFiber i110" },
                 "price": 275, "regular_price": 275, "upcharge": 60 }],
  "customizations": [{ "name": "Ferrule", "options": [{ "name": "Black Standard", "upcharge": 0 },
                                                     { "name": "ICON (Black/Blue/White)", "upcharge": 2.5 }] }],
  "scraped_at": "2026-10-07T22:04:53.766Z", "extraction_time_ms": 2242.7
}
```

## 2. Conditional-option discovery

The site (Magento 2) builds its dropdowns in the browser from JSON embedded in
the page. The scraper reads that JSON directly, so one request returns every
valid combination, with no clicking.

```mermaid
flowchart LR
    A["GET /sku-slug<br/>(1 request)"] --> B["JSON embedded in the page<br/>(x-magento-init)"]
    B --> C["spConfig.index<br/>only combinations that exist"]
    B --> D["spConfig.optionPrices + sku<br/>price and SKU of each"]
    B --> E["ironsetOptions<br/>customization prices"]
    A --> F["HTML form<br/>group names and order,<br/>options when there is no JSON"]
    A --> G["HTML tabs<br/>Description, Specs, Videos"]
    C & D --> V[variants]
    E & F --> K[customizations]
    G --> P[details and videos]
```

| Source in the page             | Gives                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| `spConfig.attributes`          | `options`: each dropdown that picks the variant, and its values |
| `spConfig.index`               | **Only the combinations that exist**: this is the conditional logic the page applies when you pick options |
| `spConfig.optionPrices`, `sku` | Price and SKU of each combination                           |
| `ironsetOptions.optionConfig`  | Customization options and their upcharge                    |
| HTML labels                    | Group names ("Grips") and display order (not in any JSON; GraphQL returns null for them) |
| HTML `<select>` options        | Customization options on pages without `optionConfig` (66 products, mostly putters); each option's `price` attribute holds the same amount as the JSON |
| `ironsetOptions.clubInformation` | The clubs an iron set includes by default (4–PW)          |
| Description, Specs, Videos tabs | `description`, `specs`, `media.videos`                     |
| `<link rel="canonical">`       | `url`: the product page (the JSON's own url leads to the model's listing of new and used clubs for 533 of 696 products) |
| `/gallery/<SKU>.json` (2nd request) | `media.images`: every image of the page's gallery (the JSON in the page only has the first) |

**Example:** the OPUS SP wedge has ~700,000 theoretical combinations
(6 bounces × 5 grinds × 9 lofts × 2 materials × 2 hands × 8 flexes × 81 shafts).
The index lists the **3,888** the store actually sells, and the output contains
exactly those.

**Accuracy checks:**
- Options are sorted by their `position` field, so they keep the page's selection order.
- A combination is kept only if it has a price and a value for every option.
- The SKU on the page must match the CSV, so a wrong product is never recorded.
- Every JSON block is validated with zod: if the site changes a field, the product fails with `site data changed in …` instead of producing empty data.

**Customizations:** which options exist does not depend on other choices;
picking another variant only re-prices them. The site's JavaScript adds two
rules:
- **Iron sets:** the per-club price and every customization are multiplied by
  the clubs checked (4–PW by default, hence `default_set_price`).
- **Required together:** a non-standard length makes grip and grip install
  required, and an upgrade shaft makes tip and length required. These rules are
  not in the output (see [Not captured](#4-data-that-could-not-be-captured-reliably)).

## 3. Runtime

**Result:** the last full run took **1 min 52 s** with `CONCURRENCY=20 DELAY_MS=0`:
696 of 700 captured, 1,396 requests (page + gallery), 0 retries, 0 blocks. With
the defaults, the run before the gallery request took 8 min 2 s.

### Trade-offs

| Decision                              | Why                                                    | Cost                                         |
| ------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| HTTP + embedded JSON, no browser      | One request per product returns every configuration and price, and a second, small JSON the photo gallery; a browser adds seconds and hundreds of MB per page | Depends on the site's JSON shape (mitigated by zod) |
| Direct URL from the SKU (`LINK 2.2 PUT` → `/link-2dot2-put`) | Avoids the site search (see below)                    | Relies on the site's URL convention (SKU checked on the page) |
| 4 in parallel, 1 new product every 500 ms | Considerate pace with no blocks                       | Slower than the site can take (see the test below) |
| Retries with backoff (5 s → 40 s), stop after 3 blocked products | Survives throttling without hammering the site | A blocked run ends early (and resumes later)  |

### Why not the site search

Both routes reach the same page and the same `x-magento-init` JSON; the direct
URL skips the search step. Tested from the same US IP:

| Check                        | Site search (`/catalogsearch/result/?q=…`) | Direct URL (`/link-2dot2-put`) |
| ---------------------------- | ------------------------------------------ | ------------------------------ |
| Requests per product         | 2 (search + redirect); 12 of 40 returned a list to pick from | 1 |
| [robots.txt](https://www.2ndswing.com/robots.txt) | `Disallow: /catalogsearch/`  | Allowed (no rule matches any of the 700 URLs) |
| After ~40 searches           | **406** (blocked)                          | **200**                        |
| 40 + 40 in parallel          | 40 × 406                                   | 40 × 200                       |
| Other headers / User-Agents  | Still 406 (the limit is per IP)            | –                              |

`robots.txt` only asks; the 406 is a separate per-IP limit on the search page.
Proxies would get around it, but the direct URL does not need it.

### How it was measured

`performance.now()` around each product (download + parse) gives
`extraction_time_ms`. The whole run is timed the same way, and
`run-report.json` reports the total, products per minute and p50 / p95 / max
per product.

### Concurrency test

The same 700 products from the same connection. The first three runs requested
only the page and captured identical data; the last row is the latest full run,
which also requests each gallery:

| Setting                          | Time       | Products/min | Per product (p50 · p95) | 406 / retries / blocks |
| -------------------------------- | ---------- | ------------ | ----------------------- | ---------------------- |
| `CONCURRENCY=4`, `DELAY_MS=500`  | 8 min 3 s  | 87           | 2.4 s · 4.4 s           | 0 / 0 / 0              |
| `CONCURRENCY=20`, `DELAY_MS=500` | 6 min 5 s  | 115          | 2.2 s · 4.1 s           | 0 / 0 / 0              |
| `CONCURRENCY=20`, `DELAY_MS=0`   | **39 s**   | **1,074**    | 0.75 s · 2.8 s          | 0 / 0 / 0              |
| `CONCURRENCY=20`, `DELAY_MS=0`, page + gallery | 1 min 52 s | 376 | 2.7 s · 5.6 s     | 0 / 0 / 0              |

The pace (`DELAY_MS`) limits speed, not concurrency: 500 ms caps the run at
120 products per minute. It is a single test (the last two runs overlapped by
~10 s), so the defaults stay conservative. The test ran before description,
specs and videos were extracted; the later run with them kept the same pace
(8 min 2 s, 87 products/min).

### Where to improve

| Improvement                                                  | Expected gain                                    |
| ------------------------------------------------------------ | ------------------------------------------------ |
| Faster pace, e.g. `CONCURRENCY=10`, `DELAY_MS=100`           | ~1.5 min instead of 8 (about 10 requests/s)      |
| Stream `output.json` as JSON Lines                           | Flat memory (today it is built in memory, ~110 MB) |
| Daily runs: skip unchanged records by content hash           | Less storage and processing, not fewer requests  |

Large pages dominate the time: the OPUS wedge page is 2.6 MB (1.1 s to
download, 0.5 s to parse), and the largest product (26,400 variants, 11.9 MB)
takes about 20 s. That is why the request timeout is 60 s: with 20 s it once
needed a retry.

## 4. Data that could not be captured reliably

**4 of 700 products**, listed with the reason in `run-report.json`:

| SKU                    | Reason                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `2026 HL MAX D WGS`    | Out of stock: the site shows $0.00 and no configurations   |
| `2026 HL MAX D FWG`    | Out of stock: same as above                                |
| `KM2 PUT`              | No product page (404); the site search finds nothing       |
| `STAFF MOD TG NEW WGS` | Redirects to a generic model page with no product data     |

**Not captured, or only partially:**

| Data                                   | Why                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Iron set price for other club choices  | `default_set_price` covers the default set; any other selection costs the per-club price × the clubs checked |
| Rules between customizations           | Only in the site's JavaScript (a non-standard length requires a grip; an upgrade shaft requires a tip), so the output lists every option without them |
| Stock per configuration                | The stock field is empty in the JSON; availability is only per product  |
| Media files                            | Captured as URLs, not downloaded: every image of the gallery and the YouTube videos. No per-configuration images exist (colors are plain dropdowns) |
| Add-ons and shipping time              | The "Add On" box (e.g. Bridgestone Tour B XS balls, $19.99) is a separate product, and "Typically ships in 1 to 3 weeks" comes per variant in `spConfig.leadtimes`; neither is in the output |
| Group headers in selects               | "STANDARD GRIPS" / "PREMIUM GRIPS" come in the HTML of every grip select; "STANDARD SHAFTS" / "CUSTOM SHAFTS" are drawn by the site's JavaScript in the Shaft Model dropdown. Both only mark whether an option costs extra (all 16,510 premium grips do, no standard one does), which `upcharge` already says, so they are not stored |
| Specs of 7 products                    | 6 have no Specs tab; `20 AKA OM-5 NEW PUT` writes them as prose instead of a table |
| Labels                                 | Kept as the site writes them, which varies by product (customizations "Grip", "Grips", "GripModel(InstallPriceIncluded)"; spec columns "Length", "LENGTH"); 24 products list the same option twice, as the site does |

## 5. Production

```mermaid
flowchart LR
    S["Scheduler<br/>(cron / Cloud Scheduler)"] --> J["Docker job<br/>US region"]
    J --> O["Object storage<br/>output + run-report"]
    J --> L["Log platform<br/>JSON logs"]
    J -- "exit code 1" --> A["Alert"]
    L -- "retry / run_stopped / site data changed" --> A
```

| Area         | How                                                                         |
| ------------ | --------------------------------------------------------------------------- |
| **Run**      | The Docker image as a one-off job (Cloud Run Jobs, ECS Fargate or cron) in a US region, which provides the US IP without a VPN. Settings via environment variables. |
| **Monitor**  | Exit code 1 = bad run (nothing extracted or >10% failed). One JSON log file per run (`product_ok`, `product_failed`, `retry`, `run_stopped`…). `run-report.json` gives success rate, products/min and p95 to track over time. |
| **Alert on** | `retry` / `run_stopped` events (site throttling or blocking) and `site data changed in …` errors (parser needs updating) |
| **Maintain** | zod schemas pinpoint which field changed. 30 offline tests (`make test`, also run by CI) cover parsing, pricing, retries, resume, the quality check and the explorer. `make explorer` shows any product next to its live page for spot checks. Interrupted runs resume from `state/scraper.db`. |

## 6. Daily CSV pipeline (design)

An outline, not implemented.

```mermaid
flowchart TD
    A["Daily CSV"] --> B{"Diff against<br/>yesterday's CSV"}
    B -- new SKUs --> C["Scrape and insert"]
    B -- kept SKUs --> D["Scrape again"]
    B -- removed SKUs --> E["Mark inactive<br/>(keep history)"]
    C & D --> F{"Content hash<br/>changed?"}
    F -- no --> G["Update last_seen only"]
    F -- yes --> H["Close current version,<br/>insert new one (SCD Type 2)"]
    H --> I["Daily report:<br/>changes + failures"]
    G --> I
```

| Question                         | Answer                                                                 |
| -------------------------------- | ---------------------------------------------------------------------- |
| **Identify new products**        | Compare today's CSV with yesterday's by `Parent Item`: new SKUs are scraped and inserted; removed SKUs are marked inactive, never deleted |
| **Scrape**                       | Every SKU once a day at a gentle pace (e.g. `CONCURRENCY=1 DELAY_MS=10000`, ~2 h, fine for an unattended job). The run state is keyed by date, so a re-run the same day resumes instead of duplicating |
| **Detect changes**               | SHA-256 of the normalized record (sorted keys, without `scraped_at` and `extraction_time_ms`). Same hash: nothing to write. Different: compare fields to classify the change (base price, variant price, variant added/removed, customization added/removed/re-priced, out of stock, gone). Changes are frequent: between two runs 13 h apart, 22,690 variant prices changed in 36 products |
| **Store history**                | SCD Type 2 in PostgreSQL: a change closes the current row (`valid_to`, `is_current = false`) and inserts a new one. Only changes are stored, instead of ~280,000 near-identical rows a day |
| **Flag changes**                 | One daily summary (Slack or email): new products, price changes (old → new, %; moves above 10% flagged for review), variants added or removed, products out of stock or gone. Also products the CSV marks active (`EOL` = No) that the site does not sell: all 4 failures of this run |
| **Flag failures**                | Exit code 1, coverage drop, runtime above twice the usual, `site data changed in …`, repeated 406 (egress IP blocked or not in the US). Out-of-stock and not-found count as status changes, not failures |

Tables:

| Table                  | Columns                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `products`             | `sku` PK, name, brand, category, active, first_seen, last_seen              |
| `product_versions`     | sku, content_hash, data JSONB, valid_from, valid_to, is_current             |
| `variant_prices`       | sku, product_sku, options JSONB, price, regular_price, upcharge, valid_from, valid_to, is_current |
| `customization_prices` | product_sku, customization, option, upcharge, valid_from, valid_to, is_current |
| `runs`                 | run_id, started_at, finished_at, ok, failed, requests, status               |
