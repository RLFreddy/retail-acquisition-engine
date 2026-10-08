// Alternative: one scraped product in an easier-to-read product page.
// Gallery on the left; on the right the buy box (options, Irons In Set,
// Customize, shipping, price summary, Add to Cart) and, apart, the scraper's data.
// Options can be chosen in any order and nothing gets stuck: the ones no variant
// offers with the other choices are dimmed, and picking one keeps the choices
// that still fit and clears the rest. The store's own rules apply too: some dropdowns
// are sorted A to Z, shafts and grips are grouped, Customize ships in 2-3 weeks
// and some Customize fields turn required. Every value goes into the page as text.
"use strict";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n) => currency.format(n);
const int = (n) => Number(n ?? 0).toLocaleString("en-US");
const round = (n) => Math.round(n * 100) / 100;
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
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : String(kid));
  return node;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

// As the live page words it once a variant is chosen.
function shipsIn(days) {
  if (days == null) return "Shipping time not given";
  const weeks = Math.ceil(days / 7);
  return days === 1 ? "In stock • Ships in 1 business day" : `Typically ships in ${weeks} ${weeks === 1 ? "Week" : "Weeks"}`;
}

// The chosen variant's shipping, or the range of the variants still possible.
// Customize choices make it 3 weeks at least, as the store warns.
function shipLine(rows, customized) {
  const days = rows.map((r) => r[2]).filter((d) => d != null).map((d) => (customized ? Math.max(d, 21) : d));
  if (!days.length) return "Shipping time not given";
  const min = Math.min(...days);
  const max = Math.max(...days);
  const weeks = (d) => Math.ceil(d / 7);
  if (min === max || (min > 1 && weeks(min) === weeks(max))) return shipsIn(max);
  const when = (d) => (d === 1 ? "1 business day" : `${weeks(d)} ${weeks(d) === 1 ? "week" : "weeks"}`);
  return `Ships in ${when(min)} to ${when(max)}, depending on your choices`;
}

// As the store prints a Customize option: "ICON (Black/Blue/White) + $2.50".
const optionText = (o) => (o.price > 0 ? `${o.name} + ${money(o.price)}` : o.name);
const az = (a, b) => (a.toUpperCase() > b.toUpperCase() ? 1 : a.toUpperCase() < b.toUpperCase() ? -1 : 0);

const req = () => h("span", { class: "req", title: "Required" }, "*");
const PILLS_MAX = 16; // a dropdown with more options than this stays a dropdown
const OPT = 3; // a row is [sku, price, days to ship, option index per dropdown…]
const SORTED = new Set(["Club Length", "Shaft Model", "Subcategory", "Club Color"]); // the store sorts these A to Z
const SHAFTS = "Shaft Model"; // grouped into standard and custom shafts, as on the store
// Customize labels the store's grip rule looks for
const LENGTH = /^Lengths? ?(Adjustments?)?$/;
const GRIP_MODEL = /^Grips? ?(Model|Options)? ?(\([^)]*\))?$/;
const GRIP_INSTALL = /^(Extra Wraps|Wraps?|((Grip|Option|W?r?ap)s? ?(Ins?tall?|Size))|(Ins?tall?|Size) ?(Grip|Option|W?r?ap)s?) ?\/? ?(Options?)?$/;

const state = { p: null, rows: [], exists: [], order: [], sel: [], customOn: false, custom: [], clubs: new Set(), media: 0, ready: null, note: "", flag: false };
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
    byId("results").replaceChildren(h("li", { class: "empty" }, "No product or variant SKU matches."));
    byId("results").hidden = false;
  }
}

// ---- Product ----------------------------------------------------------------

async function openProduct(sku, selected) {
  byId("results").hidden = true;
  byId("q").value = "";
  history.replaceState(null, "", `#${slug(sku)}`);
  byId("page").replaceChildren(h("p", { class: "empty" }, `Loading ${sku}…`));
  try {
    show(await getJson(`api/products/${encodeURIComponent(sku)}`), selected);
  } catch (err) {
    byId("page").replaceChildren(h("p", { class: "empty" }, `Could not load ${sku}: ${err.message}`));
  }
}

function show(p, selected) {
  const index = p.dropdowns.map((d) => new Map(d.options.map((option, i) => [option, i])));
  state.p = p;
  state.rows = p.variants.map((v) => [v.sku, v.product_price, v.ships_in_days, ...p.dropdowns.map((d, k) => index[k].get(v.selected[d.label]))]);
  state.order = p.dropdowns.map((d) => {
    const order = d.options.map((_, i) => i);
    return SORTED.has(d.label) ? order.sort((a, b) => az(d.options[a], d.options[b])) : order;
  });
  state.exists = p.dropdowns.map((_, k) => new Set(state.rows.map((r) => r[OPT + k]))); // options some variant has
  resetChoices(selected);
  state.media = 0;
  ui = { groups: [] };
  document.title = `${p.name} · Alternative`;
  linkViews(p);
  byId("page").replaceChildren(crumbs(p), h("div", { class: "pdp" }, gallery(p), buyBox(p)), details(p));
  update();
}

// The bar's view links follow the product on screen.
function linkViews(p) {
  const pages = { explorer: "./", clone: "clone.html", alternative: "alternative.html" };
  for (const a of document.querySelectorAll(".views a[data-view]")) {
    a.href = a.dataset.view === "original" ? p.url : `${pages[a.dataset.view]}#${slug(p.sku)}`;
  }
}

// Home › Golf Clubs › Iron Set › Mizuno Pro S-4 Iron Set, as on the store, linked to it.
function crumbs(p) {
  const url = new URL(p.url);
  const parts = url.pathname.split("/").filter(Boolean); // golf-clubs/iron-sets/<model>/<sku>
  const link = (n, text) => h("a", { href: `${url.origin}/${parts.slice(0, n).join("/")}`, target: "_blank", rel: "noopener" }, text);
  const root = (parts[0] ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return h("p", { class: "crumbs" }, link(0, "Home"), " › ", link(1, root), " › ", link(2, p.category), " › ", link(3, p.name));
}

// A dropdown with a single option starts chosen; a variant SKU search picks all of its options.
function resetChoices(selected) {
  const p = state.p;
  state.sel = p.dropdowns.map((d) => {
    const i = selected ? d.options.indexOf(selected[d.label]) : -1;
    return i >= 0 ? i : d.options.length === 1 ? 0 : null;
  });
  state.customOn = p.customize.required;
  state.custom = p.customize.dropdowns.map(() => null);
  state.clubs = new Set(p.irons_in_set?.checked ?? []);
  state.flag = false;
}

// ---- Gallery ----------------------------------------------------------------

function gallery(p) {
  const items = [
    ...p.images.map((url) => ({ url, thumb: url })),
    ...p.videos.map((url) => {
      const id = new URL(url).searchParams.get("v");
      return { url, id, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` };
    }),
  ];
  ui.stage = h("div", { class: "stage" });
  ui.watch = h("p", { class: "watch", hidden: true });
  ui.thumbs = items.map((m, i) => h("button", {
    class: "thumb", type: "button", "aria-label": m.id ? "Play the video" : `Photo ${i + 1}`,
    onclick: () => { state.media = i; drawStage(items); },
  }, h("img", { src: m.thumb, alt: "", loading: "lazy" }), m.id ? h("span", { class: "play", "aria-hidden": "true" }, "▶") : null));
  drawStage(items);
  return h("section", { class: "gallery", "aria-label": "Photos and videos" }, ui.stage, ui.watch, items.length > 1 ? h("div", { class: "thumbs" }, ui.thumbs) : null);
}

// The store's own player (youtube.com, not youtube-nocookie): it can use the
// viewer's YouTube session, so YouTube asks less often to "confirm you're not
// a bot" (VPNs trigger it). The link below each video always works.
const player = (id, lazy) => h("iframe", {
  src: `https://www.youtube.com/embed/${id}`, title: "Product video", loading: lazy ? "lazy" : null,
  referrerpolicy: "strict-origin-when-cross-origin", allow: "encrypted-media; picture-in-picture", allowfullscreen: true,
});
const watchLink = (url) => h("a", { href: url, target: "_blank", rel: "noopener" }, "Watch on YouTube ↗");

function drawStage(items) {
  const m = items[state.media];
  const content = !m ? h("p", { class: "empty" }, "No photos.")
    : m.id ? player(m.id)
    : h("a", { href: m.url, target: "_blank", rel: "noopener", title: "Open the full-size photo" }, h("img", { src: m.url, alt: state.p.name }));
  ui.stage.replaceChildren(...[state.p.badge && !m?.id ? h("span", { class: "ribbon" }, state.p.badge) : null, content].filter(Boolean)); // the ribbon would cover a video's title
  ui.watch.replaceChildren(...(m?.id ? [watchLink(m.url)] : []));
  ui.watch.hidden = !m?.id;
  ui.thumbs.forEach((t, i) => t.setAttribute("aria-current", String(i === state.media)));
}

// ---- Buy box ----------------------------------------------------------------

function buyBox(p) {
  ui.priceLabel = h("span", { class: "price-label" });
  ui.priceValue = h("span", { class: "price-value" });
  ui.note = h("p", { class: "note", role: "status", hidden: true });
  ui.ship = h("p", { class: "ship" });
  ui.summary = h("dl", {});
  ui.todo = h("p", { class: "todo" });
  ui.cart = h("button", { class: "btn cart", type: "button", onclick: addToCart }, "Add to Cart");
  ui.added = h("p", { class: "added", role: "status", hidden: true });
  ui.data = h("div", { class: "scraper" });
  return h("section", { class: "buy", "aria-label": "Buy box" },
    h("div", { class: "head" },
      h("p", { class: "eyebrow" }, `${p.brand} · ${p.category}`),
      h("h1", { class: "title" }, p.name),
      h("p", { class: "sku mono" }, `SKU ${p.sku}`),
      h("div", { class: "price" }, ui.priceLabel, ui.priceValue, p.per_club ? h("span", { class: "price-unit" }, "Per Club") : null)),
    h("div", { class: "options" },
      p.dropdowns.map(optionGroup),
      ui.note,
      p.irons_in_set ? clubsField(p.irons_in_set) : null,
      p.customize.dropdowns.length ? customizeField(p) : null),
    h("div", { class: "summary" }, ui.ship, ui.summary, ui.todo, ui.cart, ui.added,
      h("p", { class: "links" },
        h("a", { href: p.url, target: "_blank", rel: "noopener" }, "Compare on 2ndswing.com ↗"),
        h("button", { class: "link", type: "button", onclick: clearChoices }, "Clear choices"))),
    ui.data);
}

function clearChoices() {
  resetChoices();
  ui.customSelects?.forEach((s) => { s.value = ""; });
  update();
}

// Nothing is bought: it says what the store would put in the cart. Until every
// required option is chosen it stays enabled and points at what is missing,
// as usability research advises over a disabled button.
function addToCart() {
  const r = state.ready;
  if (!r) {
    state.flag = true;
    update();
    const first = document.querySelector(".missing");
    first?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    first?.querySelector("input:not(:disabled), select")?.focus({ preventScroll: true });
    return;
  }
  ui.added.textContent = `All set. On 2ndswing.com this adds variant ${r.sku}${state.p.irons_in_set ? ` (${r.clubs} clubs)` : ""} to the cart for ${money(r.total)}. Nothing was bought here.`;
  ui.added.hidden = false;
}

// Few options: buttons (radio inputs). Many options, and shafts: a dropdown.
// Options keep the store's order (A to Z for some dropdowns).
function optionGroup(d, k) {
  const g = { chosen: h("span", { class: "chosen" }) };
  ui.groups.push(g);
  const order = state.order[k];
  if (d.options.length > PILLS_MAX || d.label === SHAFTS) {
    g.placeholder = h("option", { value: "" }, `Choose ${d.label}…`);
    g.items = d.options.map((option, i) => h("option", { value: i }, option));
    g.select = h("select", { class: "select", id: `dd-${k}`, onchange: (e) => choose(k, e.target.value === "" ? null : Number(e.target.value)) },
      g.placeholder, order.map((i) => g.items[i]));
    g.hint = d.label === SHAFTS ? h("p", { class: "hint" }, `Custom shafts cost more than the ${money(state.p.starting_at)} starting price.`) : null;
    g.wrap = h("div", { class: "group" }, h("label", { class: "field-label", for: `dd-${k}` }, d.label, " ", req(), g.chosen), g.select, g.hint);
    return g.wrap;
  }
  g.items = d.options.map((option, i) => {
    const input = h("input", { type: "radio", name: `dd-${k}`, value: i, onchange: () => choose(k, i) });
    const extra = h("small", {});
    return { input, extra, pill: h("label", { class: "pill" }, input, h("span", {}, option, extra)) };
  });
  g.wrap = h("fieldset", { class: "group" }, h("legend", {}, d.label, " ", req(), g.chosen), h("div", { class: "pills" }, order.map((i) => g.items[i].pill)));
  return g.wrap;
}

// As the store groups them: a shaft is custom when it costs more than the
// starting price with your other choices; shafts not sold with them go last.
function groupShafts(g, k, prices, highest) {
  const groups = [["Standard shafts", []], ["Custom shafts", []], ["Not sold with your other choices", []]];
  for (const i of state.order[k]) {
    const at = !prices.has(i) ? 2 : round(highest.get(i) - state.p.starting_at) > 0 ? 1 : 0;
    groups[at][1].push(g.items[i]);
  }
  g.select.replaceChildren(g.placeholder, ...groups.filter(([, items]) => items.length).map(([label, items]) => h("optgroup", { label }, items)));
  g.hint.hidden = !groups[1][1].length;
}

// Never stuck: the other choices that still fit with this one stay (top
// first), the ones that don't are cleared and named under the options.
function choose(k, i) {
  const before = state.sel;
  const fits = (r) => state.sel.every((s, j) => s == null || r[OPT + j] === s);
  const cleared = [];
  state.sel = before.map((s, j) => (j === k ? i : null));
  before.forEach((s, j) => {
    if (j === k || s == null) return;
    state.sel[j] = s;
    if (!state.rows.some(fits)) {
      state.sel[j] = null;
      cleared.push(state.p.dropdowns[j].label);
    }
  });
  state.note = cleared.length ? `${cleared.join(", ")} cleared: not sold with ${state.p.dropdowns[k].options[i]}.` : "";
  update();
}

function clubsField(irons) {
  ui.clubsChosen = h("span", { class: "chosen" });
  ui.clubsWrap = h("fieldset", { class: "group" },
    h("legend", {}, "Irons In Set ", req(), ui.clubsChosen),
    h("div", { class: "pills" }, irons.options.map((club) => h("label", { class: "pill check" },
      h("input", { type: "checkbox", checked: state.clubs.has(club), onchange: (e) => { e.target.checked ? state.clubs.add(club) : state.clubs.delete(club); update(); } }),
      h("span", {}, club)))));
  return ui.clubsWrap;
}

function customizeField(p) {
  const { required } = p.customize;
  ui.switchStandard = h("button", { type: "button", disabled: required, onclick: () => setCustomize(false) }, "Standard");
  ui.switchCustomize = h("button", { type: "button", onclick: () => setCustomize(true) }, "Customize");
  ui.customSelects = p.customize.dropdowns.map((d, i) => h("select", {
    class: "select", id: `cu-${i}`, onchange: (e) => { state.custom[i] = e.target.value === "" ? null : Number(e.target.value); update(); },
  }, h("option", { value: "" }, "-- Please Select --"), customizeOptions(d)));
  ui.customReq = p.customize.dropdowns.map(() => req());
  ui.customWraps = p.customize.dropdowns.map((d, i) =>
    h("div", {}, h("label", { class: "field-label", for: `cu-${i}` }, d.label, " ", ui.customReq[i]), ui.customSelects[i]));
  ui.customBox = h("div", { class: "customize" }, ui.customWraps);
  ui.customNotice = h("p", { class: "notice" }, "Customized clubs require at least 2-3 weeks to ship.");
  return h("div", { class: "group" },
    h("div", { class: "switch", role: "group", "aria-label": "Standard or Customize" }, ui.switchStandard, ui.switchCustomize),
    h("p", { class: "hint" }, required
      ? "This product must be customized: the store locks Customize on and every option below is required."
      : "Standard is the factory build. Customize adds the options below, at the prices shown."),
    ui.customNotice,
    ui.customBox);
}

// Grip dropdowns are split into standard grips and premium grips (the ones
// with a price), as on the store.
function customizeOptions(d) {
  const options = d.options.map((o, i) => h("option", { value: i }, optionText(o)));
  if (!/grip/i.test(d.label)) return options;
  const group = (label, premium) => {
    const items = options.filter((_, i) => (d.options[i].price > 0) === premium);
    return items.length ? h("optgroup", { label }, items) : null;
  };
  return [group("Standard grips", false), group("Premium grips", true)];
}

// Customize fields that must be chosen: all of them where the store forces
// Customize; otherwise the store's grip rule (a length, or one grip field,
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

// Like the store: going back to Standard hides and resets the Customize choices.
function setCustomize(on) {
  state.customOn = on;
  if (!on) {
    state.custom = state.custom.map(() => null);
    ui.customSelects.forEach((s) => { s.value = ""; });
  }
  update();
}

// Which options of each dropdown some variant still offers with the other
// choices, with the lowest and highest price of each; plus the variants that
// match them all.
function availability() {
  const K = state.p.dropdowns.length;
  const avail = Array.from({ length: K }, () => new Map());
  const highest = Array.from({ length: K }, () => new Map());
  const keep = (k, i, price) => {
    if (!avail[k].has(i) || price < avail[k].get(i)) avail[k].set(i, price);
    if (!highest[k].has(i) || price > highest[k].get(i)) highest[k].set(i, price);
  };
  const matching = [];
  for (const r of state.rows) {
    let misses = 0;
    let miss = -1;
    for (let k = 0; k < K && misses < 2; k++) {
      if (state.sel[k] != null && r[OPT + k] !== state.sel[k]) { misses++; miss = k; }
    }
    if (misses === 0) {
      matching.push(r);
      for (let k = 0; k < K; k++) keep(k, r[OPT + k], r[1]);
    } else if (misses === 1) keep(miss, r[OPT + miss], r[1]);
  }
  return { avail, highest, matching };
}

function update() {
  const p = state.p;
  const { avail, highest, matching } = availability();
  const chosen = state.sel.every((s) => s != null) && matching.length ? matching[0] : null;

  p.dropdowns.forEach((d, k) => {
    const g = ui.groups[k];
    const prices = avail[k];
    const cheapest = prices.size ? Math.min(...prices.values()) : 0;
    g.chosen.textContent = state.sel[k] == null ? "" : `: ${d.options[state.sel[k]]}`;
    d.options.forEach((option, i) => {
      const ok = prices.has(i);
      const extra = ok && prices.get(i) > cheapest ? `+${money(round(prices.get(i) - cheapest))}` : "";
      const it = g.items[i];
      const sold = state.exists[k].has(i); // some variant has it at all
      if (g.select) {
        it.disabled = !sold;
        it.toggleAttribute("data-off", !ok);
        it.textContent = ok ? `${option}${extra ? `  ${extra}` : ""}` : d.label === SHAFTS ? option : `${option} (not with your other choices)`;
      } else {
        it.input.checked = state.sel[k] === i;
        it.input.disabled = !sold;
        it.pill.classList.toggle("off", sold && !ok);
        it.extra.textContent = extra;
        if (ok) it.pill.removeAttribute("title");
        else it.pill.setAttribute("title", "Not sold with your other choices: picking it clears the ones that don't fit");
      }
    });
    if (d.label === SHAFTS) groupShafts(g, k, prices, highest[k]);
    if (g.select) g.select.value = state.sel[k] == null ? "" : String(state.sel[k]);
  });

  const from = matching.length ? Math.min(...matching.map((r) => r[1])) : p.starting_at;
  ui.priceLabel.textContent = chosen ? "Product Price" : state.sel.some((s) => s != null) ? "From" : "Starting At";
  ui.priceValue.textContent = money(chosen ? chosen[1] : from);

  if (ui.clubsChosen) ui.clubsChosen.textContent = `: ${state.clubs.size} ${state.clubs.size === 1 ? "club" : "clubs"}`;
  const required = state.customOn ? requiredCustom() : [];
  if (ui.customBox) {
    ui.customBox.hidden = !state.customOn;
    ui.customNotice.hidden = !state.customOn;
    ui.switchStandard.setAttribute("aria-pressed", String(!state.customOn));
    ui.switchCustomize.setAttribute("aria-pressed", String(state.customOn));
    ui.customReq.forEach((mark, i) => { mark.hidden = !required.includes(i); });
  }

  const customized = state.customOn && state.custom.some((c) => c != null);
  ui.ship.textContent = shipLine(chosen ? [chosen] : matching, customized);
  ui.ship.className = chosen ? "ship" : "ship pending";

  // Until every option is chosen, the prices are "from" the cheapest variant left.
  const extras = state.customOn
    ? round(p.customize.dropdowns.reduce((sum, d, i) => sum + (state.custom[i] != null ? d.options[state.custom[i]].price : 0), 0))
    : 0;
  const clubs = p.irons_in_set ? state.clubs.size : 1;
  const unit = chosen ? chosen[1] : from;
  const total = round((unit + extras) * clubs);
  const pre = chosen ? "" : "from ";
  const perClub = p.per_club ? " (per club)" : "";
  const line = (term, value, cls) => [h("dt", { class: cls }, term), h("dd", { class: cls }, value)];
  ui.summary.replaceChildren(...[
    line(`Product Price${perClub}`, `${pre}${money(unit)}`),
    state.customOn ? line(`Customize${perClub}`, `+${money(extras)}`) : [],
    p.irons_in_set ? line("Clubs", `× ${clubs}`) : [],
    line("Total", `${pre}${money(total)}`, "total"),
  ].flat());

  const missing = [
    ...p.dropdowns.filter((d, k) => state.sel[k] == null).map((d) => d.label),
    ...(p.irons_in_set && !clubs ? ["at least one club"] : []),
    ...required.filter((i) => state.custom[i] == null).map((i) => p.customize.dropdowns[i].label),
  ];
  ui.todo.textContent = missing.length ? `Still to choose: ${missing.join(", ")}` : "";
  ui.todo.hidden = !missing.length;
  state.ready = !missing.length && chosen ? { sku: chosen[0], clubs, total } : null;
  ui.added.hidden = true;
  const mark = (el, on) => el?.classList.toggle("missing", state.flag && on);
  p.dropdowns.forEach((d, k) => mark(ui.groups[k].wrap, state.sel[k] == null));
  mark(ui.clubsWrap, !clubs);
  ui.customWraps?.forEach((el, i) => mark(el, required.includes(i) && state.custom[i] == null));
  ui.note.textContent = state.note;
  ui.note.hidden = !state.note;
  state.note = ""; // shown once, until the next change

  const possible = p.dropdowns.reduce((n, d) => n * d.options.length, 1);
  ui.data.replaceChildren(...[
    h("h3", {}, "Scraper data"),
    h("p", {}, "Variant SKU: ", h("span", { class: "mono" }, chosen ? chosen[0] : "choose every option")),
    h("p", {}, `${int(state.rows.length)} combinations exist out of ${int(possible)} possible · ${int(matching.length)} match your choices`),
    chosen ? h("p", {}, "ships_in_days: ", h("span", { class: "mono" }, String(chosen[2]))) : null,
    h("p", {},
      h("a", { href: `api/products/${encodeURIComponent(p.sku)}`, target: "_blank", rel: "noopener" }, "This record as JSON ↗"),
      " · ",
      h("a", { href: `./#${slug(p.sku)}` }, "Open in the Explorer"),
      " · ",
      h("a", { href: `clone.html#${slug(p.sku)}` }, "Open the Clone")),
  ].filter(Boolean));

  const shown = matching.slice(0, 200);
  ui.variantsInfo.textContent = `${int(matching.length)} of ${int(state.rows.length)} variants match your choices${matching.length > shown.length ? ` · showing the first ${shown.length}` : ""}.`;
  ui.variantsBody.replaceChildren(...shown.map((r) => h("tr", {},
    h("td", { class: "mono" }, r[0]),
    p.dropdowns.map((d, k) => h("td", {}, d.options[r[OPT + k]])),
    h("td", {}, money(r[1])),
    h("td", {}, shipsIn(r[2])))));
}

// ---- Details --------------------------------------------------------------

// Expanded sections with a sticky contents bar rather than tabs, which 27% of
// shoppers overlook (Baymard). The long technical ones start collapsed.
function details(p) {
  const cols = [...new Set(p.specs.flatMap((row) => Object.keys(row)))];
  ui.variantsInfo = h("p", { class: "muted" });
  ui.variantsBody = h("tbody", {});
  ui.json = h("pre", { class: "json" });
  const sections = [
    ["Description", p.description ? describe(p.description) : h("p", { class: "empty" }, "No description.")],
    ["Specs", p.specs.length
      ? h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
          h("tbody", {}, p.specs.map((row) => h("tr", {}, cols.map((c) => h("td", {}, row[c] ?? "")))))))
      : h("p", { class: "empty" }, "This product has no specs table.")],
    [`Videos (${p.videos.length})`, p.videos.length
      ? h("div", { class: "videos" }, p.videos.map((url) => h("figure", { class: "video" },
          player(new URL(url).searchParams.get("v"), true), h("figcaption", {}, watchLink(url)))))
      : h("p", { class: "empty" }, "No videos.")],
    [`All variants (${int(p.variants.length)})`, [ui.variantsInfo, h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "SKU"), p.dropdowns.map((d) => h("th", {}, d.label)), h("th", {}, "Product Price"), h("th", {}, "Ships"))),
      ui.variantsBody))], "collapsed"],
    ["JSON", [h("p", { class: "muted" }, "The output.json record, with the variants cut to the first 5."), ui.json], "collapsed"],
  ];
  const blocks = sections.map(([title, body, collapsed]) => (collapsed
    ? h("details", { class: "section", ontoggle: (e) => { if (e.target.open && title === "JSON") fillJson(); } }, h("summary", {}, h("h2", {}, title)), body)
    : h("section", { class: "section" }, h("h2", {}, title), body)));
  const go = (block) => { if (block.tagName === "DETAILS") block.open = true; block.scrollIntoView?.({ behavior: "smooth" }); };
  return h("div", { class: "details" },
    h("nav", { class: "toc", "aria-label": "Product details" }, sections.map(([title], i) => h("button", { type: "button", onclick: () => go(blocks[i]) }, title))),
    blocks);
}

function fillJson() {
  if (ui.json.textContent) return;
  const { variants, ...record } = state.p;
  const shown = variants.length > 5 ? [...variants.slice(0, 5), `… ${int(variants.length - 5)} more variants`] : variants;
  ui.json.textContent = JSON.stringify({ ...record, variants: shown }, null, 2);
}

// One line per paragraph; short lines without a final period read as headings.
function describe(text) {
  return h("div", { class: "desc" }, text.split("\n").map((line) => {
    const pair = line.match(/^([^:]{2,40}):\s+(.+)$/);
    if (pair) return h("p", {}, h("b", {}, `${pair[1]}: `), pair[2]);
    return line.length <= 40 && !/[.:]$/.test(line) ? h("h3", {}, line) : h("p", {}, line);
  }));
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
    byId("page").replaceChildren(h("p", { class: "empty" }, `Could not load the data: ${err.message}`));
  }
})();
