# retail-acquisition-engine

A scraper for [2ndswing.com](https://www.2ndswing.com) that turns a CSV of product
SKUs into structured data: details, images, every valid configuration (hand,
shaft, flex, loft…) and every customization option (grips, lie, length…), each
with its price.

It uses plain HTTP requests and reads the JSON that the store (Magento 2) embeds
in each product page. No headless browser, one request per product. It resumes
after interruptions, retries when the site pushes back, and stops on its own if
it keeps getting blocked.

**Full run of 700 products:** 696 captured (the other 4 are not available on the
site), 280,886 configurations and 39,703 customization options with their
prices, in 8 minutes with the default settings and no blocks. The results are
in [`results/`](results/).

## Features

- **Every valid configuration with its price**, including combinations that the
  site only reveals after several clicks
- **Customization options with their price change**, grouped and ordered as the
  site shows them
- **Validated input:** if the site changes its data, the product fails with a
  clear error instead of producing silently empty data
- **Resumable:** progress is saved per product; running it again continues where
  it stopped
- **Polite by default:** limited parallel requests and pace, retries with
  exponential backoff, and an automatic stop after 3 blocks in a row
- **Ready for schedulers:** JSON and CSV output, a run report, one log file per
  run, and exit code 1 when a run goes wrong

## Requirements

> [!IMPORTANT]
> The scraper needs a **US IP address**. From other countries the site answers
> HTTP 406 to every product page, and the run stops after 3 blocked products. Outside the US, use a
> US VPN; Docker uses the host's network, so the VPN covers it too.

- Node.js 24 and pnpm 10 (run `corepack enable` to get pnpm), or Docker
- `make` is optional: every target maps to a `pnpm` script

## Quick start

```bash
make install        # or: pnpm install
make dev LIMIT=10   # scrape the first 10 products of searchresults.csv
```

The console shows each product as it finishes, then a summary:

```text
INFO  Scraper: Starting the scraper. {"input":"searchresults.csv","products":10,"concurrency":4,"state":"data/state/scraper.db"}
INFO  Scraper: [1/10] M CRAFT X S3 PUT {"variants":26,"options":22,"ms":893}
…
INFO  Scraper: Finished! Total 10 products: 10 succeeded, 0 failed (10 requests, 5s).
INFO  Scraper: Output saved: {"files":["data/output.json","data/run-report.json","data/variants.csv","data/customizations.csv","data/logs/run-2026-10-07T05-01-36.log"]}
```

Run `make dev` (no `LIMIT`) to scrape all the products in the CSV.

## Usage

| Command                     | What it does                                       |
| --------------------------- | -------------------------------------------------- |
| `make dev`                  | Scrape every product in the CSV                    |
| `make dev LIMIT=10`         | Scrape only the first 10 (quick test)              |
| `make test`                 | Typecheck and run the tests (no network needed)    |
| `make build` / `make start` | Compile to `dist/` and run the compiled version    |
| `make reset`                | Delete all output and the resume state             |
| `make docker-build`         | Build the Docker image                             |
| `make docker-run LIMIT=10`  | Run in Docker (output goes to `data_docker/`)      |
| `make`                      | List every command                                 |

**Interrupted runs:** press Ctrl+C or lose the VPN, then run the same command
again. Products already scraped are not requested again.

**Exit code:** `0` on success, `1` if nothing was extracted or more than 10% of
the products failed.

## Output

Everything goes to `data/` (`data_docker/` with Docker):

| File                   | Content                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `output.json`          | One record per product: details, media, variants, customizations |
| `variants.csv`         | One row per valid configuration, with its price            |
| `customizations.csv`   | One row per customization option, with its price change    |
| `run-report.json`      | Run metrics and each failed product with the reason        |
| `logs/run-<start>.log` | One file per run, one JSON line per event                  |
| `state/scraper.db`     | Resume state (internal, not part of the results)           |

A row of `variants.csv`:

```csv
"id","name","sku","options","base_price","price_modifier","final_price","pricing_unit"
"M CRAFT X S3 PUT","Mizuno M.Craft X S3 Putter","C4613215","{""Dexterity"":""Left Handed"",""Club Length"":""32.0in""}","399.99","0","399.99","per_item"
```

The full record format is described in the
[documentation](DOCUMENTATION.md#data-model). A 5-product sample is in
[`results/sample/`](results/sample/).

## Configuration

Optional: copy `.env.example` to `.env`. The same file works for `make dev` and
Docker, and any variable can also be set on the command line
(`CONCURRENCY=10 make dev`).

| Variable           | Default             | Description                                              |
| ------------------ | ------------------- | -------------------------------------------------------- |
| `INPUT_CSV`        | `searchresults.csv` | CSV with a `Parent Item` column (the site's SKU)         |
| `OUTPUT_DIR`       | `data`              | Folder for results, logs and resume state                |
| `LIMIT`            | `0`                 | Products to scrape; `0` = all                            |
| `CONCURRENCY`      | `4`                 | Requests in parallel                                     |
| `DELAY_MS`         | `500`               | At most one product starts every `DELAY_MS`              |
| `RETRIES`          | `4`                 | Retries per request on 406, 429, 5xx and network errors  |
| `RETRY_DELAY_MS`   | `5000`              | First retry wait; doubles on each retry                  |
| `TIMEOUT_MS`       | `20000`             | Timeout per request                                      |
| `MAX_ATTEMPTS`     | `5`                 | Runs a product may fail before it is abandoned           |
| `MAX_FAILURE_RATE` | `0.1`               | Above this failure rate the run exits with code 1        |
| `USER_AGENT`       | a desktop Chrome    | User-Agent sent with every request                       |

**Speed:** `DELAY_MS` limits speed more than `CONCURRENCY` does. In a test with
the same 700 products, `CONCURRENCY=20` and `DELAY_MS=0` took 39 s instead of
8 min, without blocks. The defaults stay conservative on purpose; see the
[concurrency test](DOCUMENTATION.md#runtime-and-trade-offs).

## Documentation

[DOCUMENTATION.md](DOCUMENTATION.md) covers the details:

- Data model and pricing rules
- How conditional options are discovered
- Runtime trade-offs and the concurrency test
- Data that could not be captured
- How to run it in production, and a design for a daily CSV pipeline

## License

[MIT](LICENSE)
