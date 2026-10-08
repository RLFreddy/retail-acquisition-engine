// Explorer page: the product list on the left; the selected product, laid out
// like the store's page, on the right. Data comes from the server's API, and
// every value goes into the page as text, never as HTML.
"use strict";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n) => currency.format(n);
const int = (n) => Number(n ?? 0).toLocaleString("en-US");
const round = (n) => Math.round(n * 100) / 100;
const slug = (id) => id.trim().toLowerCase().replace(/\./g, "dot").replace(/\s+/g, "-");
const byId = (id) => document.getElementById(id);

function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : String(kid));
  return node;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

// ---- Product list --------------------------------------------------------------

const items = new Map(); // product SKU → its button in the list
const loaded = new Map(); // product SKU → prepared product
let wanted = null; // the last product picked; a slower earlier load must not replace it

function renderRun(run, failures) {
  if (run) {
    const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(run.started_at));
    const seconds = Math.round(run.total_ms / 1000);
    byId("run").textContent = `2ndswing.com scraper · run of ${date} UTC`;
    // The run at a glance; the products without data are one click away.
    const kpi = (value, label, extra) => h("div", { class: "kpi" }, h("b", {}, value), h("span", {}, label), extra);
    const openFailures = () => { byId("failures").open = true; byId("failures").scrollIntoView?.({ block: "center" }); };
    byId("stats").replaceChildren(
      kpi(`${int(run.ok)} / ${int(run.products)}`, "products scraped",
        failures.length ? h("button", { class: "kpi-alert", type: "button", onclick: openFailures }, `${failures.length} without data`) : null),
      kpi(int(run.variants), "variants, each with its SKU and price"),
      kpi(int(run.customization_options), "Customize options"),
      kpi(`${Math.floor(seconds / 60)} min ${seconds % 60} s`, `${int(run.http_requests)} requests${run.concurrency ? `, ${run.concurrency} at a time` : ""}`));
  }
  if (failures.length) {
    byId("failures").replaceChildren(
      h("summary", {}, `${failures.length} ${failures.length === 1 ? "product" : "products"} without data`),
      h("ul", {}, failures.map((f) => h("li", {}, h("b", {}, f.sku), `: ${f.reason}`))),
    );
    byId("failures").hidden = false;
  }
}

function renderList(products) {
  const categories = [...new Set(products.map((p) => p.category))].sort();
  byId("cat").append(...categories.map((c) => h("option", { value: c }, `${c} (${products.filter((p) => p.category === c).length})`)));
  byId("list").replaceChildren(...products.map((p) => {
    const item = h("button", { class: "item", type: "button", onclick: () => select(p.sku) },
      h("span", { class: "item-row" },
        h("span", { class: "item-title" }, p.name),
        p.starting_at ? h("span", { class: "item-price" }, h("small", {}, "from "), money(p.starting_at)) : null),
      h("span", { class: "item-meta" }, `${p.category} · ${p.brand} · ${p.sku}`),
      h("span", { class: "tags" },
        h("span", { class: "tag" }, `${int(p.variants)} ${p.variants === 1 ? "variant" : "variants"}`),
        p.required ? h("span", { class: "tag warn", title: LOCKED }, "Customize required")
          : p.customizations ? h("span", { class: "tag" }, `${p.customizations} Customize`) : null,
        p.badge ? h("span", { class: "tag hot" }, p.badge) : null));
    item.dataset.text = `${p.sku} ${p.name} ${p.brand} ${p.category}`.toLowerCase();
    item.dataset.category = p.category;
    items.set(p.sku, item);
    return item;
  }));
}

function filterList() {
  const q = byId("q").value.trim().toLowerCase();
  const cat = byId("cat").value;
  const shown = [];
  for (const [sku, item] of items) {
    item.hidden = Boolean((q && !item.dataset.text.includes(q)) || (cat && item.dataset.category !== cat));
    if (!item.hidden) shown.push(sku);
  }
  byId("list-count").textContent = `${int(shown.length)} of ${int(items.size)} products`;
  clearTimeout(variantLookup);
  if (q && shown.length === 1 && shown[0] !== wanted) select(shown[0]);
  if (!shown.length && /^[a-z0-9-]{5,}$/.test(q)) variantLookup = setTimeout(() => findVariant(q), 250);
}

// Enter opens the first product of the list.
function openFirst(e) {
  const first = [...items].find(([, item]) => !item.hidden);
  if (e.key === "Enter" && first) select(first[0]);
}

// Variant SKUs (C4592868) are not in the list: the server finds their product,
// which then opens with that variant's options picked.
let variantLookup = null;
async function findVariant(sku) {
  try {
    const hit = await getJson(`api/variants/${encodeURIComponent(sku)}`);
    if (byId("q").value.trim().toLowerCase() !== sku) return; // the query changed meanwhile
    items.get(hit.product_sku).hidden = false;
    byId("list-count").textContent = `Variant ${hit.sku} of ${hit.product_sku}`;
    await select(hit.product_sku, hit.selected);
  } catch {
    // not a variant SKU either: the list stays empty
  }
}

async function select(sku, choices) {
  wanted = sku;
  for (const [key, item] of items) item.setAttribute("aria-current", String(key === sku));
  history.replaceState(null, "", `#${slug(sku)}`);
  if (!loaded.has(sku)) byId("product").replaceChildren(h("p", { class: "empty" }, `Loading ${sku}…`));
  try {
    if (!loaded.has(sku)) loaded.set(sku, prepare(await getJson(`api/products/${encodeURIComponent(sku)}`)));
    if (wanted === sku) show(loaded.get(sku), choices);
  } catch (err) {
    byId("product").replaceChildren(h("p", { class: "empty" }, `Could not load ${sku}: ${err.message}`));
  }
}

// ---- Product ---------------------------------------------------------------

const state = { product: null, sel: [], custom: {}, clubs: new Set(), tab: "details" };
const ui = {};

// Each variant becomes [sku, price, days to ship, option index per dropdown], what the dropdowns filter on.
const OPT = 3;
const LOCKED = "On the store the Standard | Customize switch is locked: every Customize option must be chosen before Add to Cart";
function prepare(record) {
  const index = record.dropdowns.map((d) => new Map(d.options.map((option, i) => [option, i])));
  return {
    ...record,
    vs: record.variants.map((v) => [v.sku, v.product_price, v.ships_in_days, ...record.dropdowns.map((d, k) => index[k].get(v.selected[d.label]))]),
  };
}

// As the live page words it once a variant is chosen.
function shipsIn(days) {
  if (days == null) return "";
  const weeks = Math.ceil(days / 7);
  return days === 1 ? "In stock • Ships in 1 business day" : `Typically ships in ${weeks} ${weeks === 1 ? "Week" : "Weeks"}`;
}

const matches = (v, upto) => {
  for (let j = 0; j < upto; j++) if (state.sel[j] != null && v[OPT + j] !== state.sel[j]) return false;
  return true;
};

// Like the store: each dropdown only lists what exists with the choices above it.
function optionsFor(k) {
  const seen = new Set();
  for (const v of state.product.vs) if (matches(v, k)) seen.add(v[OPT + k]);
  return state.product.dropdowns[k].options.map((option, i) => [option, i]).filter(([, i]) => seen.has(i));
}

// Like the store: a dropdown left with a single option is chosen for you, which
// opens the next one (X-Stiff and 103 on DIAMANA WB HST).
function autoChoose(from) {
  for (let k = from; k < state.sel.length && state.sel[k] == null; k++) {
    if (state.sel.slice(0, k).some((s) => s == null)) return;
    const options = optionsFor(k);
    if (options.length !== 1) return;
    state.sel[k] = options[0][1];
  }
}

// choices: a variant's selected options ({ Dexterity: "Right Handed", … }), or none.
function show(p, choices) {
  state.product = p;
  state.sel = p.dropdowns.map((d) => {
    const i = choices ? d.options.indexOf(choices[d.label]) : -1;
    return i < 0 ? null : i;
  });
  autoChoose(0);
  state.custom = {};
  state.clubs = new Set(p.irons_in_set?.checked ?? []);
  byId("product").replaceChildren(head(p), h("div", { class: "cols" }, buyBox(p), tabsPanel(p)));
  update();
  selectTab(state.tab);
}

// Besides this explorer, each product opens as the live page, as a clone of
// it built from the data, or as an easier-to-read alternative.
function head(p) {
  const views = [
    ["Original ↗", "live on 2ndswing.com", p.url, true],
    ["Clone", "the store page, rebuilt from the data", `clone.html#${slug(p.sku)}`],
    ["Alternative", "the same data, easier to read", `alternative.html#${slug(p.sku)}`],
  ];
  return h("div", { class: "p-head" },
    h("div", { class: "p-title" },
      h("p", { class: "eyebrow" }, `${p.category} · ${p.brand} · SKU ${p.sku}`, p.badge ? h("span", { class: "badge" }, p.badge) : null),
      h("h2", {}, p.name),
      facts(p)),
    h("div", { class: "p-actions" },
      h("p", { class: "label" }, "Open this product as"),
      h("div", { class: "views" }, views.map(([name, what, href, live]) => h("a", {
        class: live ? "view live" : "view", href, target: live ? "_blank" : null, rel: live ? "noopener" : null,
      }, h("b", {}, name), h("small", {}, what)))),
      h("p", { class: "source" }, h("a", { href: `api/products/${encodeURIComponent(p.sku)}`, target: "_blank", rel: "noopener" }, "Full JSON ↗"), ` · ${p.url}`)));
}

// The product at a glance: prices, variants, shipping, Customize and clubs.
function facts(p) {
  const prices = p.variants.map((v) => v.product_price);
  const days = p.variants.map((v) => v.ships_in_days).filter((d) => d != null);
  const when = (d) => (d === 1 ? "1 business day" : `${Math.ceil(d / 7)} ${Math.ceil(d / 7) === 1 ? "week" : "weeks"}`);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const fast = Math.min(...days);
  const slow = Math.max(...days);
  const fact = (label, value, tone, title) => h("span", { class: tone ? `fact ${tone}` : "fact", title }, h("small", {}, label), value);
  const nCustom = p.customize.dropdowns.length;
  return h("div", { class: "facts" },
    prices.length ? fact("Price", `${low === high ? money(low) : `${money(low)} – ${money(high)}`}${p.per_club ? " per club" : ""}`) : null,
    fact("Variants", int(prices.length)),
    days.length ? fact("Ships in", when(fast) === when(slow) ? when(fast) : `${when(fast)} – ${when(slow)}`, fast === 1 ? "good" : null) : null,
    p.customize.required ? fact("Customize", "required", "warn", LOCKED)
      : fact("Customize", nCustom ? `${nCustom} optional` : "none"),
    p.irons_in_set ? fact("Irons in set", `${p.irons_in_set.checked.length} of ${p.irons_in_set.options.length} checked`) : null);
}

function buyBox(p) {
  ui.priceLabel = h("span", { class: "price-label" });
  ui.priceValue = h("span", { class: "price-value" });
  ui.priceUnit = h("span", { class: "price-unit" }, "Per Club");
  ui.priceDetail = h("p", { class: "price-detail" });
  ui.count = h("p", { class: "count" });
  ui.ships = h("p", { class: "ships" });
  ui.total = h("div", { class: "total", "aria-live": "polite" });
  ui.selects = p.dropdowns.map((d, k) => h("select", {
    id: `attr-${k}`,
    onchange: (e) => {
      state.sel[k] = e.target.value === "" ? null : Number(e.target.value);
      for (let j = k + 1; j < state.sel.length; j++) state.sel[j] = null;
      autoChoose(k + 1);
      update();
    },
  }));

  const customize = p.customize.dropdowns.map((d, di) => h("div", { class: "field" },
    h("label", { for: `cust-${di}` }, p.customize.required ? `${d.label} *` : d.label),
    h("select", { id: `cust-${di}`, onchange: (e) => { state.custom[di] = e.target.value === "" ? null : Number(e.target.value); update(); } },
      h("option", { value: "" }, "-- Please Select --"),
      d.options.map((o, oi) => h("option", { value: oi }, o.price > 0 ? `${o.name} + ${money(o.price)}` : o.name)))));

  return h("section", { class: "panel" },
    h("p", { class: "label" }, "Buy box · as on the live page"),
    h("div", {}, h("div", { class: "price" }, ui.priceLabel, ui.priceValue, ui.priceUnit), ui.priceDetail),
    h("div", { class: "fields" },
      p.dropdowns.map((d, k) => h("div", { class: "field" }, h("label", { for: `attr-${k}` }, d.label), ui.selects[k])),
      p.irons_in_set ? clubsField(p.irons_in_set) : null),
    ui.ships,
    ui.count,
    h("p", { class: "source" }, "dropdowns, variants ← the page's spConfig JSON (attributes, index, optionPrices, sku, leadtimes)"),
    p.irons_in_set ? h("p", { class: "source" }, "irons_in_set ← the ironsetOptions JSON (Irons In Set)") : null,
    h("details", { class: "customize", open: true },
      h("summary", {}, "Customize"),
      h("div", { class: "cust-body" },
        h("p", { class: "count" }, p.customize.required
          ? "The site keeps Customize on for this product: every dropdown (*) is required."
          : "On the live page these show after clicking Customize; Standard hides and resets them."),
        customize.length ? customize : h("p", { class: "empty" }, "This product has no customizations."),
        h("p", { class: "source" }, "customize ← the ironsetOptions.optionConfig JSON or, when the page lacks it, the HTML <select>; required ← forceRequireOptions"))),
    ui.total);
}

// Irons In Set: checkboxes under the dropdowns, outside Customize, as on the site.
function clubsField(irons) {
  return h("div", { class: "field" },
    h("span", {}, "Irons In Set"),
    h("div", { class: "clubs" }, irons.options.map((club, i) =>
      h("label", { for: `club-${i}` },
        h("input", {
          type: "checkbox", id: `club-${i}`, checked: state.clubs.has(club),
          onchange: (e) => { e.target.checked ? state.clubs.add(club) : state.clubs.delete(club); update(); },
        }),
        club))));
}

const TABS = [
  ["details", "Description"],
  ["specs", "Specs"],
  ["media", "Media"],
  ["variants", "Variants"],
  ["json", "JSON"],
];

function tabsPanel(p) {
  const panels = (ui.panels = {});
  const tablist = h("div", { class: "tabs", role: "tablist" });
  const counts = { specs: p.specs.length, media: p.images.length + p.videos.length, variants: p.variants.length };
  for (const [key, label] of TABS) {
    const n = key in counts ? h("span", { class: counts[key] ? "n" : "n zero" }, int(counts[key])) : null;
    tablist.append(h("button", { class: "tab", role: "tab", type: "button", id: `tab-${key}`, onclick: () => selectTab(key) }, label, n));
    panels[key] = h("div", { class: "tabpanel", role: "tabpanel", "aria-labelledby": `tab-${key}` });
  }

  panels.details.append(
    p.description ? describe(p.description) : h("p", { class: "empty" }, "No description."),
    h("p", { class: "source" }, "description ← the page's Description tab (#details), one paragraph per line"));

  const cols = [...new Set(p.specs.flatMap((row) => Object.keys(row)))];
  panels.specs.append(
    p.specs.length
      ? h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
          h("tbody", {}, p.specs.map((row) => h("tr", {}, cols.map((c) => h("td", {}, row[c] ?? "")))))))
      : h("p", { class: "empty" }, "This product has no specs table."),
    h("p", { class: "source" }, "specs ← the page's Specs tab (#specs table)"));

  const figure = (src, href, alt) => h("figure", {},
    h("a", { href, target: "_blank", rel: "noopener" }, h("img", { src, alt, loading: "lazy" })),
    h("figcaption", {}, h("a", { class: "mono", href, target: "_blank", rel: "noopener" }, href)));
  const { images, videos } = p;
  panels.media.append(
    h("p", { class: "label" }, `Images (${images.length})`),
    h("div", { class: "thumbs" }, images.map((url) => figure(url, url, p.name))),
    h("p", { class: "label" }, `Videos (${videos.length})`),
    videos.length
      ? h("div", { class: "thumbs" }, videos.map((url) =>
          figure(`https://i.ytimg.com/vi/${new URL(url).searchParams.get("v")}/mqdefault.jpg`, url, "YouTube video")))
      : h("p", { class: "empty" }, "No videos."),
    h("p", { class: "source" }, "images ← /gallery/<SKU>.json (the page's main photo if there is none) · videos ← the Videos tab (#video)"));

  ui.variantsInfo = h("p", { class: "count" });
  ui.variantsBody = h("tbody", {});
  panels.variants.append(
    ui.variantsInfo,
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "SKU"), p.dropdowns.map((d) => h("th", {}, d.label)), h("th", {}, "Product Price"), h("th", {}, "Ships"))),
      ui.variantsBody)));

  ui.json = h("pre", { class: "json" });
  panels.json.append(h("p", { class: "count" }, "The output.json record, with variants cut to the first 5. \"Full JSON\", above, opens all of it."), ui.json);

  return h("section", { class: "panel" }, h("p", { class: "label" }, "Page tabs and scraper data"), tablist, Object.values(panels));
}

function describe(text) {
  return h("div", { class: "desc" }, text.split("\n").map((line) => {
    const pair = line.match(/^([^:]{2,40}):\s+(.+)$/);
    if (pair) return h("p", {}, h("b", {}, `${pair[1]}: `), pair[2]);
    return line.length <= 40 && !/[.:]$/.test(line) ? h("h4", {}, line) : h("p", {}, line);
  }));
}

function selectTab(key) {
  state.tab = key;
  for (const [k] of TABS) {
    byId(`tab-${k}`).setAttribute("aria-selected", String(k === key));
    ui.panels[k].hidden = k !== key;
  }
  if (key === "json" && !ui.json.textContent) {
    const { vs, variants, ...record } = state.product;
    const shown = variants.length > 5 ? [...variants.slice(0, 5), `… ${int(variants.length - 5)} more variants`] : variants;
    ui.json.textContent = JSON.stringify({ ...record, variants: shown }, null, 2);
  }
}

function update() {
  const p = state.product;
  ui.selects.forEach((select, k) => {
    const enabled = k === 0 || state.sel[k - 1] != null;
    select.replaceChildren(
      h("option", { value: "" }, "Choose an Option..."),
      ...(enabled ? optionsFor(k) : []).map(([label, i]) => h("option", { value: i }, label)));
    select.disabled = !enabled;
    select.value = state.sel[k] == null ? "" : String(state.sel[k]);
  });

  const matching = p.vs.filter((v) => matches(v, p.dropdowns.length));
  const chosen = state.sel.every((s) => s != null) ? matching[0] : null;
  const unit = chosen ? chosen[1] : p.starting_at;
  const possible = p.dropdowns.reduce((acc, d) => acc * d.options.length, 1);
  const prices = p.vs.map((v) => v[1]);
  ui.priceLabel.textContent = chosen ? "Product Price" : "Starting At";
  ui.priceValue.textContent = money(unit);
  ui.priceUnit.hidden = !p.per_club;
  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  ui.priceDetail.textContent = chosen
    ? `SKU ${chosen[0]}`
    : prices.length === 1 ? `1 variant, ${money(low)}`
    : prices.length ? `${int(p.vs.length)} variants, ${low === high ? money(low) : `from ${money(low)} to ${money(high)}`}` : "";
  ui.ships.textContent = chosen ? shipsIn(chosen[2]) : "";
  const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many}`;
  ui.count.textContent = `${plural(p.vs.length, "valid combination", "valid combinations")} of ${int(possible)} possible · ${plural(matching.length, "matches", "match")} the choices`;

  const mods = round(p.customize.dropdowns.reduce((sum, d, di) => sum + (state.custom[di] != null ? d.options[state.custom[di]].price : 0), 0));
  if (p.per_club) {
    const each = round(unit + mods);
    ui.total.replaceChildren(
      h("span", {}, "Per club: ", h("b", {}, money(unit)), " + ", h("b", {}, money(mods)), " in customizations = ", h("b", {}, money(each))),
      h("span", {}, "Clubs checked: ", h("b", {}, state.clubs.size)),
      h("span", { class: "big" }, `Set total: ${money(round(each * state.clubs.size))}`),
      h("span", { class: "muted" }, "As on the site: (per-club price + customizations) × clubs checked"));
  } else {
    ui.total.replaceChildren(
      h("span", {}, "Price ", h("b", {}, money(unit)), " + customizations ", h("b", {}, money(mods))),
      h("span", { class: "big" }, `Total: ${money(round(unit + mods))}`));
  }

  const shown = matching.slice(0, 200);
  ui.variantsInfo.textContent = `Showing ${int(shown.length)} of ${int(matching.length)} variants that match the choices (${int(p.vs.length)} in total).`;
  ui.variantsBody.replaceChildren(...shown.map((v) => h("tr", {},
    h("td", { class: "sku" }, v[0]),
    p.dropdowns.map((d, k) => h("td", {}, d.options[v[OPT + k]])),
    h("td", { class: "num" }, money(v[1])),
    h("td", {}, shipsIn(v[2])))));
}

// ---- Start -----------------------------------------------------------------

byId("q").addEventListener("input", filterList);
byId("q").addEventListener("keydown", openFirst);
byId("cat").addEventListener("change", filterList);
(async () => {
  try {
    const { products, run, failures } = await getJson("api/summary");
    renderRun(run, failures);
    renderList(products);
    filterList();
    const fromHash = products.find((p) => `#${slug(p.sku)}` === location.hash);
    if (products.length) await select((fromHash ?? products[0]).sku);
  } catch (err) {
    byId("product").replaceChildren(h("p", { class: "empty" }, `Could not load the data: ${err.message}`));
  }
})();
