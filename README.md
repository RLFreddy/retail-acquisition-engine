# retail-acquisition-engine

Scraper HTTP (sin navegador) en TypeScript para adquirir variantes de productos
de e-commerce: axios + cheerio, cookie jar con keep-alive, reintentos con backoff,
rotación de sesión, estado de reanudación en SQLite, log de errores y Docker.

Creado a partir de `template-scraper`.

## Estructura

```
src/
  main.ts                 entrada: init de estado, cliente HTTP, Ctrl+C limpio
  config.ts               variables de entorno + URLs del sitio (TODO)
  types.ts                Item (registro), Session, StepFailure (TODO: campos)
  state.ts                SQLite: páginas done/failed/pending → reanudación
  scrape/
    run.ts                bucle del crawl: intentos por página, renovación
    sessionManager.ts     abrir/renovar sesión con cooldown
    session.ts            PASO 1: abrir sesión y cargar página 1 (TODO)
    page.ts               PASO 2: descargar una página y guardarla (TODO)
  extract/items.ts        parseo del HTML → Items, total de páginas (TODO)
  buildForms/common.ts    helpers para replicar POSTs de formularios
  lib/
    http.ts               cliente axios, withRetry, registro de fallos
    errorLog.ts           errors/events.jsonl + dumps del body
    output.ts             metadata.csv por página (TODO: columnas)
    log.ts, time.ts       consola y sleep
```

## Cómo crear un scraper nuevo

1. `config.ts` → `HOME_URL` / `LIST_URL` del sitio.
2. `types.ts` → campos de `Item`; `lib/output.ts` → columnas del CSV.
3. `extract/items.ts` → selectores para items, total de páginas y token.
4. `scrape/session.ts` → requests para llegar a la primera página de resultados.
5. `scrape/page.ts` → request de la página N (GET con params, o POST con `buildForms/`).
6. `sessionManager.ts` → nombre de la cookie de sesión en `sessionRotated`.

Los puntos a adaptar están marcados con `TODO`.

## Uso

```bash
cp .env.example .env
pnpm install
pnpm dev                 # PAGES=0 → todas las páginas
PAGES=5 pnpm dev         # 5 páginas desde el punto de reanudación
```

Docker:

```bash
docker compose build
docker compose run --rm scraper
```

Todo se guarda bajo `BASE_DIR` (`data/` por defecto): `scraper.db`,
`files/page-N/metadata.csv`, `errors/events.jsonl` y `errors/dumps/`.
Ver `.env.example` para todas las opciones.
