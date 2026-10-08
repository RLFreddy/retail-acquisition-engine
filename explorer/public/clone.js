// Clone: one scraped product, shown the way its page on 2ndswing.com
// behaves. It follows the page's own scripts (configurable-option-mixin.js,
// ironset-options.js and the lead-time script):
// - a dropdown unlocks once the one above is chosen and lists only the options
//   some variant offers with the choices above; one left with a single option
//   is chosen by the page;
// - Club Length, Shaft Model, Subcategory and Club Color are sorted A to Z, and
//   Shaft Model is split into STANDARD SHAFTS and CUSTOM SHAFTS (dearer);
// - Customize adds its prices (once per club on iron sets) and Add to Cart flags
//   every required field left empty. Nothing is bought.
// Every value goes into the page as text.
"use strict";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n) => currency.format(n);
const signed = (n) => `${n < 0 ? "-" : "+"}${money(Math.abs(n))}`; // "+$15.00", as the page appends it
const cents = (n) => Math.round(n * 100) / 100;
const slug = (sku) => sku.trim().toLowerCase().replace(/\./g, "dot").replace(/\s+/g, "-");
const byId = (id) => document.getElementById(id);

function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : String(kid));
  return node;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

const OPT = 3; // a row is [sku, price, days to ship, option index per dropdown…]
const SORTED = new Set(["Club Length", "Shaft Model", "Subcategory", "Club Color"]); // the page sorts these A to Z
const SHAFTS = "Shaft Model";
const REQUIRED = "This is a required field.";
// Customize labels the page's grip rule looks for (_checkRequiredGripOptions)
const LENGTH = /^Lengths? ?(Adjustments?)?$/;
const GRIP_MODEL = /^Grips? ?(Model|Options)? ?(\([^)]*\))?$/;
const GRIP_INSTALL = /^(Extra Wraps|Wraps?|((Grip|Option|W?r?ap)s? ?(Ins?tall?|Size))|(Ins?tall?|Size) ?(Grip|Option|W?r?ap)s?) ?\/? ?(Options?)?$/;

const state = {
  p: null,
  rows: [],
  sel: [], // option index chosen in each dropdown; null = "Choose an Option..."
  lists: [], // the options each dropdown lists; null while it is locked
  tags: [], // per dropdown: option index → " +$15.00" the page added to its name (it keeps it)
  customOn: false,
  custom: [], // option index chosen in each Customize dropdown, or null
  clubs: new Set(),
  ship: "", // the red shipping line
  weeks: [0, 0], // the weeks behind it, which the page checks before changing it
  errors: new Set(), // fields Add to Cart flagged that are still empty
  added: "",
  media: 0,
};
let ui = {};
let products = []; // one line per product, for the search

// ---- Search -----------------------------------------------------------------

function showResults() {
  const q = byId("q").value.trim().toLowerCase();
  const hits = q ? products.filter((p) => `${p.sku} ${p.name} ${p.brand} ${p.category}`.toLowerCase().includes(q)).slice(0, 8) : [];
  byId("results").replaceChildren(...hits.map((p) => h("li", { role: "option" },
    h("button", { type: "button", onclick: () => openProduct(p.sku) }, p.name, h("small", {}, `${p.sku} · ${p.category} · ${p.brand}`)))));
  byId("results").hidden = !hits.length;
  return hits;
}

// Enter opens the first match; a variant SKU (C4605039) opens its product with that variant chosen.
async function onSearchKey(e) {
  if (e.key === "Escape") byId("results").hidden = true;
  if (e.key !== "Enter") return;
  const q = byId("q").value.trim();
  const [first] = showResults();
  if (first) return openProduct(first.sku);
  try {
    const hit = await getJson(`api/variants/${encodeURIComponent(q)}`);
    await openProduct(hit.product_sku, hit.selected);
  } catch {
    byId("results").replaceChildren(h("li", { class: "muted" }, "No product or variant SKU matches."));
    byId("results").hidden = false;
  }
}

// ---- Product ----------------------------------------------------------------

async function openProduct(sku, selected) {
  byId("results").hidden = true;
  byId("q").value = "";
  history.replaceState(null, "", `#${slug(sku)}`);
  byId("page").replaceChildren(h("p", { class: "muted" }, `Loading ${sku}…`));
  try {
    show(await getJson(`api/products/${encodeURIComponent(sku)}`), selected);
  } catch (err) {
    byId("page").replaceChildren(h("p", { class: "muted" }, `Could not load ${sku}: ${err.message}`));
  }
}

function show(p, selected) {
  const index = p.dropdowns.map((d) => new Map(d.options.map((option, i) => [option, i])));
  Object.assign(state, {
    p,
    rows: p.variants.map((v) => [v.sku, v.product_price, v.ships_in_days, ...p.dropdowns.map((d, k) => index[k].get(v.selected[d.label]))]),
    sel: p.dropdowns.map(() => null),
    lists: p.dropdowns.map(() => null),
    tags: p.dropdowns.map(() => new Map()),
    customOn: p.customize.required,
    custom: p.customize.dropdowns.map(() => null),
    clubs: new Set(p.irons_in_set?.checked ?? []),
    errors: new Set(),
    added: "",
    media: 0,
  });
  ui = {};
  document.title = `${p.name} · Clone`;
  linkViews(p);
  byId("page").replaceChildren(crumbs(p), h("div", { class: "pdp" }, gallery(p), info(p)), details(p));
  load(selected);
  render();
}

// The bar's view links follow the product on screen.
function linkViews(p) {
  const pages = { explorer: "./", clone: "clone.html", alternative: "alternative.html" };
  for (const a of document.querySelectorAll(".views a[data-view]")) {
    a.href = a.dataset.view === "original" ? p.url : `${pages[a.dataset.view]}#${slug(p.sku)}`;
  }
}

// Home › Golf Clubs › Iron Set › Mizuno Pro S-4 Iron Set, linked to the store.
function crumbs(p) {
  const url = new URL(p.url);
  const parts = url.pathname.split("/").filter(Boolean); // golf-clubs/iron-sets/<model>/<sku>
  const link = (n, text) => h("a", { href: `${url.origin}/${parts.slice(0, n).join("/")}`, target: "_blank", rel: "noopener" }, text);
  const root = (parts[0] ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return h("ul", { class: "crumbs", "aria-label": "Breadcrumbs" },
    h("li", {}, link(0, "Home")), h("li", {}, link(1, root)), h("li", {}, link(2, p.category)), h("li", {}, link(3, p.name)));
}

// ---- Photos -----------------------------------------------------------------

function gallery(p) {
  ui.stage = h("div", { class: "stage" });
  ui.thumbs = p.images.map((url, i) => h("button", {
    class: "thumb", type: "button", "aria-label": `Photo ${i + 1}`,
    onclick: () => { state.media = i; drawStage(); },
  }, h("img", { src: url, alt: "", loading: "lazy" })));
  drawStage();
  return h("section", { class: "media", "aria-label": "Photos" }, ui.stage, p.images.length > 1 ? h("div", { class: "thumbs" }, ui.thumbs) : null);
}

// The badge sits in the red corner, one word per line ("NEW" / "ITEM").
function drawStage() {
  const p = state.p;
  const url = p.images[state.media];
  ui.stage.replaceChildren(
    p.badge ? h("span", { class: "corner", role: "img", "aria-label": p.badge }, h("span", {}, p.badge.split(" ").map((word, i) => (i ? [h("br"), word] : word)))) : null,
    url ? h("a", { href: url, target: "_blank", rel: "noopener", title: "Open the full-size photo" }, h("img", { src: url, alt: p.name })) : h("p", { class: "muted" }, "No photos."));
  ui.thumbs.forEach((t, i) => t.setAttribute("aria-current", String(i === state.media)));
}

// ---- Product info -----------------------------------------------------------

const errorLine = () => h("div", { class: "error" }, REQUIRED);
const field = (label, required, id, ...control) =>
  h("div", { class: "field" }, h("label", { class: required ? "label required" : "label", for: id }, label), ...control);

// In the page's order: switch, dropdowns, Irons In Set, Customize, shipping, prices.
// The Add On cards are left out: add-ons are not scraped.
function info(p) {
  ui.dd = p.dropdowns.map((d, k) => ({
    select: h("select", { id: `dd-${k}`, onchange: (e) => choose(k, e.target.value === "" ? null : Number(e.target.value)) }),
    error: errorLine(),
  }));
  ui.ship = h("h3", { class: "ship", "aria-live": "polite" });
  ui.cart = h("button", { class: "btn-cart", type: "button", onclick: addToCart }, "Add to Cart");
  ui.added = h("p", { class: "added", role: "status" });
  return h("section", { class: "info", "aria-label": "Product" },
    h("h1", { class: "title" }, `${p.name} (${p.sku})`),
    h("p", { class: "starting" }, `Starting At ${money(p.starting_at)}${p.per_club ? " Per Club" : ""}`),
    p.customize.dropdowns.length ? customizeSwitch(p) : null,
    p.dropdowns.map((d, k) => field(d.label, true, `dd-${k}`, ui.dd[k].select, ui.dd[k].error)),
    p.irons_in_set ? clubsField(p.irons_in_set) : null,
    p.customize.dropdowns.length ? customizePanel(p) : null,
    ui.ship,
    h("div", { class: "bottom" }, priceTable(), h("div", {}, ui.cart)),
    ui.added);
}

function clubsField(irons) {
  ui.clubs = irons.options.map((club, i) => h("input", {
    type: "checkbox", id: i ? null : "clubs",
    onchange: (e) => { e.target.checked ? state.clubs.add(club) : state.clubs.delete(club); state.added = ""; render(); },
  }));
  ui.clubsError = errorLine();
  return h("div", { class: "field", role: "group", "aria-labelledby": "clubs-label" },
    h("span", { class: "label required", id: "clubs-label" }, "Irons In Set"),
    h("div", { class: "clubs" }, irons.options.map((club, i) => h("label", { class: "club" }, ui.clubs[i], club))),
    ui.clubsError);
}

// Standard | Customize. Where the store forces Customize the switch is faded
// and stays on Customize.
function customizeSwitch(p) {
  const locked = p.customize.required;
  ui.standard = h("button", { type: "button", disabled: locked, onclick: () => setCustomize(false) }, "Standard");
  ui.customize = h("button", { type: "button", disabled: locked, onclick: () => setCustomize(true) }, "Customize");
  ui.notice = h("p", { class: "notice" }, "* Customized clubs require at least 2-3 weeks to ship");
  return h("div", { class: locked ? "toggle locked" : "toggle", title: locked ? "The store requires Customize on this product" : null },
    h("div", { class: "halves", role: "group", "aria-label": "Standard or Customize" }, ui.standard, ui.customize),
    ui.notice);
}

function customizePanel(p) {
  const { required, dropdowns } = p.customize;
  ui.cu = dropdowns.map((d, i) => ({
    select: h("select", { id: `cu-${i}`, onchange: (e) => chooseCustom(i, e.target.value === "" ? null : Number(e.target.value)) },
      h("option", { value: "" }, "-- Please Select --"), customizeOptions(d)),
    error: errorLine(),
  }));
  ui.panel = h("div", { class: "customize" }, dropdowns.map((d, i) => field(d.label, required, `cu-${i}`, ui.cu[i].select, ui.cu[i].error)));
  return ui.panel;
}

// As the page prints them ("ICON (Black/Blue/White) + $2.50"); grip dropdowns
// are split into STANDARD GRIPS and PREMIUM GRIPS (the ones with a price).
const optionText = (o) => (o.price > 0 ? `${o.name} + ${money(o.price)}` : o.name);
function customizeOptions(d) {
  const node = (o, i) => h("option", { value: i }, optionText(o));
  if (!/grip/i.test(d.label)) return d.options.map(node);
  const header = (text) => h("option", { value: "", disabled: true }, text);
  return [
    header("STANDARD GRIPS"), d.options.map((o, i) => (o.price > 0 ? null : node(o, i))),
    header("PREMIUM GRIPS"), d.options.map((o, i) => (o.price > 0 ? node(o, i) : null)),
  ];
}

function priceTable() {
  ui.productPrice = h("td", {});
  ui.customizations = h("td", {});
  ui.total = h("td", {});
  return h("table", { class: "summary" }, h("tbody", {},
    h("tr", {}, h("td", {}, "Product Price"), ui.productPrice),
    h("tr", {}, h("td", {}, "Customizations"), ui.customizations),
    h("tr", {}, h("td", {}, "Add Ons"), h("td", {}, "0.00")),
    h("tr", { class: "grand" }, h("td", {}, "TOTAL"), ui.total)));
}

// ---- The page's dropdowns ---------------------------------------------------

// Variants that match the choices of the first n dropdowns.
const fitting = (n) => state.rows.filter((r) => state.sel.every((s, k) => k >= n || r[OPT + k] === s));
const chosenRow = () => (state.sel.every((s) => s != null) ? fitting(state.sel.length)[0] ?? null : null);

// _fillSelect(): the options some variant offers with the choices above. The
// first dropdown names each option's extra cost over the starting price;
// Shaft Model names it on the dearer shafts and keeps it once shown.
function fill(k) {
  const p = state.p;
  const d = p.dropdowns[k];
  const tags = state.tags[k];
  const own = new Map(); // option index → its variants
  for (const r of fitting(k)) {
    const i = r[OPT + k];
    if (!own.has(i)) own.set(i, []);
    own.get(i).push(r);
  }
  const list = d.options.map((_, i) => i).filter((i) => own.has(i));
  if (SORTED.has(d.label)) {
    const name = (i) => (d.options[i] + (tags.get(i) ?? "")).toUpperCase();
    list.sort((a, b) => (name(a) > name(b) ? 1 : name(a) < name(b) ? -1 : 0));
  }
  const extra = (r) => cents(r[1] - p.starting_at);
  for (const i of list) {
    if (k === 0) {
      const diff = Math.min(...own.get(i).map(extra));
      if (diff) tags.set(i, ` ${signed(diff)}`);
    } else if (d.label === SHAFTS && !tags.has(i)) {
      const dearer = own.get(i).find((r) => extra(r) > 0);
      if (dearer) tags.set(i, ` ${signed(extra(dearer))}`);
    }
  }
  return list;
}

// A dropdown left with one option is chosen by the page, which unlocks the
// next. Returns the last dropdown chosen this way, or -1.
function autoChoose(k) {
  let last = -1;
  while (k < state.sel.length && state.lists[k]?.length === 1) {
    state.sel[k] = state.lists[k][0];
    last = k++;
    if (k < state.sel.length) state.lists[k] = fill(k);
  }
  return last;
}

// On load the page fills the first dropdown and chooses the ones left with a
// single option; the shipping line comes from the last one it chose.
function load(selected) {
  const p = state.p;
  let last = -1;
  if (p.dropdowns.length) {
    state.lists[0] = fill(0);
    last = autoChoose(0);
  }
  if (last >= 0) setShip(...range(fitting(last + 1)));
  else setShip(21, 1);
  // A variant SKU from the search: its options, chosen in order.
  if (selected) p.dropdowns.forEach((d, k) => {
    const i = d.options.indexOf(selected[d.label]);
    if (i >= 0 && state.sel[k] !== i) pick(k, i);
  });
}

// A choice in dropdown k: the dropdowns below reset and lock, the next one unlocks.
function pick(k, i) {
  const K = state.sel.length;
  state.sel[k] = i;
  for (let j = k + 1; j < K; j++) {
    state.sel[j] = null;
    state.lists[j] = null;
  }
  if (i == null) return shipFromChoices();
  if (k + 1 < K) {
    state.lists[k + 1] = fill(k + 1);
    autoChoose(k + 1);
  }
  const [min, max] = range(fitting(k + 1));
  // With any Customize choice the line stays at 3 weeks or more.
  setShip(anyCustom() ? Math.max(21, min) : min, anyCustom() ? Math.max(21, max) : max);
}

function choose(k, i) {
  pick(k, i);
  state.added = "";
  render();
}

function chooseCustom(i, option) {
  state.custom[i] = option;
  if (!anyCustom()) shipFromChoices();
  else if (state.weeks[1] < 3 || state.weeks[0] < 2) setShip(21, 21); // "Typically ships in 2 to 3 Weeks"
  state.added = "";
  render();
}

// Like the store: Standard clears every Customize choice.
function setCustomize(on) {
  state.customOn = on;
  if (!on) {
    state.custom = state.custom.map(() => null);
    shipFromChoices();
  }
  state.added = "";
  render();
}

const anyCustom = () => state.custom.some((c) => c != null);

// ---- Shipping line ----------------------------------------------------------

// Fastest and slowest days to ship, from the page's starting values (21 and 1).
function range(rows) {
  let min = 21;
  let max = 1;
  for (const r of rows) {
    if (r[2] == null) continue;
    min = Math.min(min, r[2]);
    max = Math.max(max, r[2]);
  }
  return [min, max];
}

// The line when no single dropdown choice drives it: every variant while
// Customize is open, else the full variant if one is chosen, else the default.
function shipFromChoices() {
  const K = state.sel.length;
  if (state.customOn) setShip(...range(state.rows));
  else if (K && state.sel[K - 1] != null) setShip(...range(fitting(K)));
  else setShip(21, 1);
}

// updateLeadTimeContainer(): the days, worded in weeks.
function setShip(min, max) {
  let lo = Math.ceil(Math.min(min, max) / 7);
  const hi = Math.ceil(Math.max(min, max) / 7);
  if (lo > 1 && lo === hi) lo -= 1;
  state.weeks = [lo, hi];
  state.ship = min === 1 ? "In stock • Ships in 1 business day"
    : lo !== hi ? `Typically ships in ${lo} to ${hi} Weeks`
    : `Typically Ships In ${lo} ${lo === 1 ? "Week" : "Weeks"}`;
}

// ---- Prices and Add to Cart -------------------------------------------------

// Added up like ironset-options.js: on iron sets each checked club costs the
// per-club price and each Customize price counts once per club, both shown
// under Customizations.
function totals() {
  const p = state.p;
  const v = chosenRow();
  const unit = v ? v[1] : p.starting_at;
  const custom = state.custom.reduce((sum, option, i) => sum + (option == null ? 0 : p.customize.dropdowns[i].options[option].price), 0);
  if (!p.irons_in_set) return { unit, customizations: cents(custom), total: cents(unit + custom) };
  const clubs = state.clubs.size;
  const customizations = cents(clubs * unit + Math.max(clubs, 1) * custom);
  return { unit, customizations, total: customizations };
}

// Customize dropdowns that must be chosen: all of them where the store forces
// Customize; otherwise the page's grip rule (a length, or one grip field,
// makes the grip model and grip install fields required).
function requiredCustom() {
  const { required, dropdowns } = state.p.customize;
  if (required) return dropdowns.map((_, i) => i);
  const find = (re) => dropdowns.findLastIndex((d) => re.test(d.label.trim()));
  const [length, model, install] = [find(LENGTH), find(GRIP_MODEL), find(GRIP_INSTALL)];
  if (length < 0 || model < 0 || install < 0) return [];
  const set = (i, ...unset) => state.custom[i] != null && !unset.includes(optionText(dropdowns[i].options[state.custom[i]]));
  const lengthSet = set(length, "Leave at Current Length");
  return [
    lengthSet || set(install, "Standard Grip Install", "Do Not Install Grips") ? model : -1,
    lengthSet || set(model, "Leave Ungripped", "Current Grip on Club") ? install : -1,
  ].filter((i) => i >= 0);
}

// What Add to Cart flags, in page order: unlocked dropdowns left empty (locked
// ones are skipped, as on the page), no club checked, required Customize.
function missing() {
  const p = state.p;
  const out = [];
  p.dropdowns.forEach((_, k) => { if (state.lists[k] && state.sel[k] == null) out.push(`dd-${k}`); });
  if (p.irons_in_set && !state.clubs.size) out.push("clubs");
  if (state.customOn) for (const i of requiredCustom()) if (state.custom[i] == null) out.push(`cu-${i}`);
  return out;
}

function addToCart() {
  const fields = missing();
  const v = chosenRow();
  state.errors = new Set(fields);
  state.added = fields.length ? ""
    : `All set. On 2ndswing.com this adds ${v ? `variant ${v[0]}` : "this product"}${state.p.irons_in_set ? ` (${state.clubs.size} clubs)` : ""} to the cart for ${money(totals().total)}. Nothing was bought here.`;
  render();
  if (fields.length) byId(fields[0])?.focus();
}

// ---- Render -----------------------------------------------------------------

// The options of dropdown k as the page lists them; Shaft Model is split into
// STANDARD SHAFTS and CUSTOM SHAFTS (the ones that cost more).
function optionNodes(k) {
  const d = state.p.dropdowns[k];
  const tags = state.tags[k];
  const list = state.lists[k];
  const node = (i) => h("option", { value: i }, d.options[i] + (tags.get(i) ?? ""));
  if (d.label !== SHAFTS) return list.map(node);
  const group = (title, items) => (items.length ? [h("option", { value: "", disabled: true }, title), items.map(node)] : []);
  return [group("STANDARD SHAFTS", list.filter((i) => !tags.has(i))), group("CUSTOM SHAFTS", list.filter((i) => tags.has(i)))];
}

function render() {
  const p = state.p;
  const open = new Set(missing());
  for (const f of state.errors) if (!open.has(f)) state.errors.delete(f); // a field loses its error once chosen
  const flag = (select, error, f) => {
    select.classList.toggle("invalid", state.errors.has(f));
    error.hidden = !state.errors.has(f);
  };

  p.dropdowns.forEach((d, k) => {
    const { select, error } = ui.dd[k];
    select.replaceChildren(h("option", { value: "" }, "Choose an Option..."), ...(state.lists[k] ? optionNodes(k).flat(Infinity) : []));
    select.disabled = !state.lists[k];
    select.value = state.sel[k] == null ? "" : String(state.sel[k]);
    flag(select, error, `dd-${k}`);
  });
  if (p.irons_in_set) {
    p.irons_in_set.options.forEach((club, i) => { ui.clubs[i].checked = state.clubs.has(club); });
    ui.clubsError.hidden = !state.errors.has("clubs");
  }
  if (ui.panel) {
    ui.panel.hidden = !state.customOn;
    ui.notice.style.visibility = state.customOn ? "visible" : "hidden";
    ui.standard.className = state.customOn ? "" : "active";
    ui.customize.className = state.customOn ? "active" : "";
    ui.standard.setAttribute("aria-pressed", String(!state.customOn));
    ui.customize.setAttribute("aria-pressed", String(state.customOn));
    ui.cu.forEach(({ select, error }, i) => {
      select.value = state.custom[i] == null ? "" : String(state.custom[i]);
      flag(select, error, `cu-${i}`);
    });
  }

  ui.ship.textContent = state.ship;
  const t = totals();
  ui.productPrice.textContent = t.unit.toFixed(2);
  ui.customizations.textContent = t.customizations.toFixed(2);
  ui.total.textContent = money(t.total);
  ui.added.textContent = state.added;
  ui.added.hidden = !state.added;
}

// ---- Tabs -------------------------------------------------------------------

// The store's tab bar scrolls to each section. Compare, You May Also Like,
// Similar Items and Reviews are not scraped, so they are greyed out.
function details(p) {
  const tabs = [
    p.videos.length ? ["Videos", videos(p)] : null,
    ["Description", describe(p.description)],
    ["Compare", null],
    p.specs.length ? ["Specs", specs(p)] : null,
    ["You May Also Like", null],
    ["Similar Items", null],
    ["Reviews", null],
  ].filter(Boolean);
  const sections = new Map(tabs.filter(([, body]) => body).map(([label, body]) => [label, h("div", { class: "section" }, h("h4", {}, label), body)]));
  return h("div", {},
    h("nav", { class: "tabs", "aria-label": "Product details" },
      h("div", { class: "tab-links" }, tabs.map(([label, body]) => h("button", {
        class: "tab", type: "button", "aria-disabled": body ? null : "true", title: body ? null : "Not captured by the scraper",
        onclick: () => sections.get(label)?.scrollIntoView?.({ behavior: "smooth" }),
      }, label))),
      h("button", { class: "btn-cart", type: "button", onclick: () => { ui.cart.scrollIntoView?.({ behavior: "smooth", block: "center" }); addToCart(); } }, "Add to Cart")),
    [...sections.values()]);
}

function videos(p) {
  return h("div", { class: "videos" }, p.videos.map((url) => h("iframe", {
    src: `https://www.youtube-nocookie.com/embed/${new URL(url).searchParams.get("v")}`, title: "Product video",
    loading: "lazy", allow: "encrypted-media; picture-in-picture", allowfullscreen: true,
  })));
}

// One paragraph per line; short lines without a final period are the store's
// bold headings ("Who’s It For?"), but not "Construction: Forged".
function describe(text) {
  if (!text) return h("p", { class: "muted" }, "No description.");
  const heading = (line) => line.length <= 40 && !/[.:]$/.test(line) && !line.includes(": ");
  return h("div", { class: "desc" }, text.split("\n").map((line) => h("p", {}, heading(line) ? h("strong", {}, line) : line)));
}

function specs(p) {
  const cols = [...new Set(p.specs.flatMap((row) => Object.keys(row)))];
  return h("div", { class: "specs-wrap" }, h("table", { class: "specs" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
    h("tbody", {}, p.specs.map((row) => h("tr", {}, cols.map((c) => h("td", {}, row[c] ?? "")))))));
}

// ---- Start ------------------------------------------------------------------

byId("q").addEventListener("input", showResults);
byId("q").addEventListener("keydown", onSearchKey);
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) byId("results").hidden = true; });
window.addEventListener("hashchange", () => {
  const p = products.find((x) => `#${slug(x.sku)}` === location.hash);
  if (p && p.sku !== state.p?.sku) openProduct(p.sku);
});
(async () => {
  try {
    ({ products } = await getJson("api/summary"));
    const fromHash = products.find((p) => `#${slug(p.sku)}` === location.hash);
    if (products.length) await openProduct((fromHash ?? products[0]).sku);
  } catch (err) {
    byId("page").replaceChildren(h("p", { class: "muted" }, `Could not load the data: ${err.message}`));
  }
})();
