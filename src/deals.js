/*!
 * PriceDrop Hunter for BigBasket
 * Runs in your own browser session as a bookmarklet or userscript.
 */
(function () {
  'use strict';
  if (window.__BBD__) { window.__BBD__.toggle(); return; }
  // The page's own window (a userscript sandbox wraps `window`).
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ───────────────────────── Utils ─────────────────────────
  const $inr = n => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
  const retryDelay = (header, fallback) => {
    if (!header) return fallback;
    if (/^\d+$/.test(header)) return Number(header) * 1000;
    const date = Date.parse(header);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
  };
  const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

  // Prices can arrive wrapped in an object ({value: ...} / {amount: ...} /
  // {text: "₹1,999"}), like the bot's price() already handled: reading such
  // a value as a string gave 0, so the item lost its discount or vanished
  // entirely (selling price 0 returns null from normalise).
  const price = (v, allowTrackedMrp = true) => {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'object') {
      for (const k of ['value', 'amount', 'text', 'defaultValue']) { const p = price(v[k], allowTrackedMrp); if (p > 0) return p; }
      if (v.tracking && typeof v.tracking === 'object') { const p = price(v.tracking.fsp, allowTrackedMrp) || (allowTrackedMrp ? price(v.tracking.mrp) : 0); if (p > 0) return p; }
      return 0;
    }
    const m = String(v).replace(/,/g, '').match(/\d+(\.\d+)?/);
    return m ? +m[0] : 0;
  };
  const guessBrand = t => (String(t).trim().split(/\s+/)[0] || '').replace(/[^\w&'-]/g, '');
  const EXCLUDED = [];
  const allowed = p => { const t = p.title.toLowerCase(); return !EXCLUDED.some(k => t.includes(k)); };
  const KWG = (id, name, kws) => ({ id, name, subs: kws.map(k => [k, k[0].toUpperCase() + k.slice(1)]) });

  // ───────────────────────── Catalogue ─────────────────────────
  const G = (id, name, subs) => ({ id, name, subs });
  const GROUPS = [
    G('fresh', 'Fruits & Vegetables', [['fruits-vegetables', 'Fruits & Vegetables']]),
    G('staples', 'Staples & Oil', [['foodgrains-oil-masala', 'Foodgrains, Oil & Masala'], ['edible-oils-ghee', 'Edible Oils & Ghee'], ['dry-fruits', 'Dry Fruits']]),
    G('dairy', 'Dairy & Bakery', [['dairy', 'Dairy'], ['bakery-cakes-dairy', 'Bakery, Cakes & Dairy']]),
    G('drinks', 'Beverages', [['beverages', 'Beverages']]),
    G('snacks', 'Snacks', [['biscuits-cookies', 'Biscuits & Cookies'], ['snacks-branded-foods', 'Snacks & Branded Foods'], ['chocolates-candies', 'Chocolates & Candies']]),
    G('care', 'Beauty & Baby', [['beauty-hygiene', 'Beauty & Hygiene'], ['baby-care', 'Baby Care'], ['skin-care', 'Skin Care'], ['hair-care', 'Hair Care'], ['bath-hand-wash', 'Bath & Hand Wash'], ['diapers-wipes', 'Diapers & Wipes']]),
    G('home', 'Home', [['cleaning-household', 'Cleaning & Household'], ['kitchen-garden-pets', 'Kitchen, Garden & Pets'], ['detergents-dishwash', 'Detergents & Dishwash']]),
    G('meat', 'Eggs, Meat & Fish', [['eggs-meat-fish', 'Eggs, Meat & Fish']]),
    G('gourmet', 'Gourmet', [['gourmet-world-food', 'Gourmet & World Food']])
  ];
  let blocked = false;
  let trackerVal = null;
  const tracker = () => {
    if (trackerVal) return trackerVal;
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (/tracker/i.test(k)) { const v = sessionStorage.getItem(k); if (v && v.length > 10) return (trackerVal = v); } } } catch (e) { /* ignore */ }
    trackerVal = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'bb-' + Date.now();
    return trackerVal;
  };
  const items0 = j => {
    if (!j) return [];
    if (Array.isArray(j.tabs)) for (const t of j.tabs) { const l = t && t.product_info && t.product_info.products; if (l && l.length) return l; }
    if (j.product_info && j.product_info.products) return j.product_info.products;
    return Array.isArray(j.products) ? j.products : [];
  };
  const BB_IMG_FALLBACK = 'https://www.bigbasket.com/static/images/default.jpg';
  function normalise(p, cat) {
    const pr = p.pricing || {}, dsc = pr.discount || {};
    // MRP can also hide inside prim_price, and the selling price can be a
    // bare prim_price number (no .sp): both used to read as 0, leaving the
    // item with no discount (or, with no MRP at all, priced at its own MRP).
    const prim = dsc.prim_price;
    const mrp0 = price(dsc.mrp) || price(prim && prim.mrp) || price(pr.mrp) || price(p.mrp) || price(prim && prim.tracking && prim.tracking.mrp);
    const sp = price(prim && prim.sp) || price(prim, false) || price(pr.offer_price) || price(pr.sp) || price(p.sp) || mrp0;
    const title0 = p.desc || p.p_desc || p.name || 'Product', pack = String(p.w || p.pack_desc || '').trim();
    if (!sp) return null;
    const mrp = mrp0 < sp ? sp : mrp0;
    const im = p.images && p.images[0];
    const u = p.absolute_url || ('/pd/' + (p.id || ''));
    const av = p.availability || {};
    // BigBasket marks stock with avail_status '001' = in stock; anything else
    // present and not '001' is out of stock. Button state lives under
    // availability (top-level button_state is also accepted).
    const btn = String(av.button || av.button_state || p.button_state || '').toLowerCase();
    const inv = p.inv_info || p.inventory || {};
    const oos = av.is_available === false || av.not_for_sale === true ||
      (av.avail_status !== undefined && av.avail_status !== null && String(av.avail_status) !== '' && String(av.avail_status) !== '001') ||
      ['out_of_stock', 'not_available', 'coming_soon', 'notify me', 'sold out'].includes(btn) ||
      inv.is_out_of_stock === true || (inv.stock_status !== undefined && inv.stock_status !== null && ['000', '002'].includes(String(inv.stock_status)));
    const brand = (p.brand && p.brand.name) || p.p_brand || guessBrand(title0);
    const id = p.id != null ? String(p.id) : (String(title0) + '|' + sp);
    return { id, title: String(title0) + (pack ? ' · ' + pack : ''), pack, brand: String(brand), price: sp, mrp, disc: mrp > sp ? Math.round((mrp - sp) / mrp * 100) : 0, save: mrp - sp, img: (im && (im.s || im.m)) || BB_IMG_FALLBACK, url: /^http/.test(u) ? u : 'https://www.bigbasket.com' + u, inStock: !oos, cat };
  }
  // Fallback when the listing payload nests products under an unfamiliar key:
  // walk the whole response for objects that look like products.
  function walkProducts(json) {
    const out = [];
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || d > 10) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
      if (o.pricing && (o.desc || o.p_desc || o.name) && o.id != null) { out.push(o); return; }
      for (const k in o) walk(o[k], d + 1);
    })(json, 0);
    return out;
  }
  // Built-in self-test payload: a listing response with a child variant.
  // The Self-test button in the sidebar runs extract() on this and reports the count.
  const SELFTEST = {"tabs": [{"product_info": {"products": [{"id": 101, "desc": "Self-Test Atta", "w": "1 kg", "pricing": {"discount": {"mrp": 240, "prim_price": {"sp": 120}}}, "brand": {"name": "TestBrand"}, "images": [{"s": "https://example.com/a.jpg"}], "absolute_url": "/pd/101", "availability": {"is_available": true, "avail_status": "001"}}, {"id": 102, "desc": "Self-Test Rice", "w": "5 kg", "pricing": {"discount": {"mrp": 400, "prim_price": {"sp": 199}}}, "images": [{"s": "https://example.com/b.jpg"}], "absolute_url": "/pd/102", "availability": {"is_available": true, "avail_status": "001"}, "children": [{"id": 103, "desc": "Self-Test Rice", "w": "1 kg", "pricing": {"discount": {"mrp": 90, "prim_price": {"sp": 45}}}, "images": [{"s": "https://example.com/c.jpg"}], "absolute_url": "/pd/103", "availability": {"is_available": true, "avail_status": "001"}}]}]}}]};
  function selfTest() {
    const items = extract(SELFTEST, 'Self-test');
    const bad = items.filter(p => !p.title || !p.price || !p.mrp || !p.url);
    return { total: 3, got: items.length, bad: bad.length, pass: items.length === 3 && !bad.length };
  }
  function extract(json, cat, minDisc = 20) {
    const out = [], seen = new Set(), topDiscs = [];
    let qualifyingVariant = false;
    let items = items0(json);
    if (!items.length) items = walkProducts(json);
    for (const p of items) {
      const variants = [p].concat(p.children || []);
      for (let ci = 0; ci < variants.length; ci++) {
        const n = normalise(variants[ci], cat); // each variant parsed on its own, never merged into the parent
        if (ci > 0 && n && n.disc >= minDisc) qualifyingVariant = true;
        if (n && !seen.has(n.id)) { seen.add(n.id); out.push(n); if (ci === 0) topDiscs.push(n.disc); }
      }
    }
    // Paging signal: the lowest discount among top-level products only.
    // Child variants ride along with their parent and can sit last in the
    // array, so reading the last item's discount stopped paging after
    // page 1 whenever a low-discount variant trailed a page of 70-95% deals.
    out.tailDisc = topDiscs.length ? Math.min(...topDiscs) : (out.length ? Math.min(...out.map(p => p.disc)) : 0);
    out.totalFound = out.length;
    // Listings sort parents by discount; qualifying variants can have lower-discount parents.
    out.more = out.length > 0 && (out.tailDisc >= minDisc || qualifyingVariant);
    return out;
  }
  async function fetchListing(url, signal) {
    if (signal.aborted) throw signal.reason;
    const request = new AbortController();
    const abort = () => request.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => request.abort(new Error('request timed out')), 15000);
    try {
      const r = await W.fetch(url, { signal: request.signal, credentials: 'include', headers: { accept: 'application/json', 'x-channel': 'BB-WEB', 'x-entry-context': 'bb-b2c', 'x-entry-context-id': '100', 'x-tracker': tracker() } });
      return { r, json: r.ok ? await r.json() : null };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  async function fetchPage(job, page, ctl, minDisc) {
    const signal = ctl.signal;
    await sleep(2000 + Math.random() * 500, signal);
    const url = 'https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=' + encodeURIComponent(job.slug) + '&page=' + page + '&sort=dphtl';
    let lastErr;
    for (let a = 0; a < 4; a++) {
      let pageData;
      try {
        pageData = await fetchListing(url, signal);
      } catch (e) {
        if (signal.aborted) throw signal.reason;
        lastErr = e;
        if (a < 3) await sleep(700 * (a + 1), signal);
        continue;
      }
      if (signal.aborted) throw signal.reason;
      const { r, json } = pageData;
      if (r.status === 403) { blocked = true; stopScan(); throw new Error('blocked'); }
      if (r.status === 429 || r.status === 503) {
        S.diag.rateLimited++;
        lastErr = new Error('HTTP ' + r.status);
        const delay = retryDelay(r.headers.get('retry-after'), 3000 * (a + 1));
        if (delay > 30000) throw lastErr;
        if (a < 3) await sleep(delay, signal);
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return extract(json, job.g.name + ' › ' + job.name, minDisc);
    }
    throw lastErr;
  }
  const P = {
    key: 'bbd_v1', hostRe: /(^|\.)bigbasket\.com$/,
    defaults: { groups: ['staples', 'dairy', 'snacks'], depth: 2 },
    workers: 2,
    jobs: st => { const jobs = []; for (const g of GROUPS) if (st.groups.includes(g.id)) for (const [c, n] of g.subs) jobs.push({ g, name: n, slug: c }); return jobs; },
    fetchPage,
    noLocation: () => blocked,
    noLocMsg: 'BigBasket blocked the request. Open bigbasket.com in this tab, set your location, wait a few seconds and scan again.',
    locUI: () => '', locInput: () => false
  };
  // Live data can only be read from the store's own site, inside your logged-in tab.
  const OFFSITE = !P.hostRe.test(location.hostname);

  const KEY = P.key;
  const defaults = Object.assign({
    theme: 'auto', view: 'grid', sort: 'score', minDisc: 30, maxPrice: 0, depth: 3,
    stockOnly: true, favs: [], hidden: [], list: {}, prices: {}, lastScan: 0
  }, P.defaults);
  let store;
  try { store = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { store = Object.assign({}, defaults); }
  store.stock = store.stock ?? (store.stockOnly ? 'in' : '');
  delete store.stockOnly;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota/private mode */ } };
  store.groups = (store.groups || []).filter(id => GROUPS.some(g => g.id === id));
  if (!store.groups.length) store.groups = defaults.groups.slice();
  delete store.auto; // every scan is started by hand
  // v3: Hunter scans every category by itself and leads with the biggest discounts.
  if (store.v !== 4) { store.groups = GROUPS.map(g => g.id); store.sort = 'disc'; store.depth = (typeof P !== 'undefined' && P.defaults && P.defaults.depth) || 2; store.v = 4; save(); }

  // ───────────────────────── State ─────────────────────────
  const S = { products: new Map(), scanning: false, done: 0, total: 0, errors: 0, ctl: null,
    q: '', brand: '', cat: '', pack: '', unit: '', priceBand: '', preset: '', pick: false, tgm: false,
    favOnly: false, newOnly: false, shown: 60, tab: 'best', panel: false, startedAt: 0, scanMinDisc: null, diag: null, selfTest: null };

  // ───────────────────────── Scanner ─────────────────────────
  function stopScan() { if (S.scanning) S.ctl.abort(); }
  async function scan() {
    if (S.scanning) return;
    if (OFFSITE) { toast('Open ' + PLATFORM + ' to fetch live deals.'); return; }
    if (typeof captureUI === 'function') { autoScroll(); return; }
    const jobs = P.jobs(store);
    if (!jobs.length) { toast('Pick at least one category'); return; }
    blocked = false;
    S.scanning = true; S.ctl = new AbortController(); S.done = 0; S.errors = 0; S.total = jobs.length; S.startedAt = Date.now();
    S.diag = { ran: true, rateLimited: 0, emptyCats: [] };
    S.products.clear(); S.shown = 60; render();
    const ctl = S.ctl, queue = jobs.slice();
    const alerts = store.tg.on && tgReady();
    const minDisc = alerts ? Math.min(store.minDisc, store.tg.drops || store.tg.watch ? 0 : store.tg.minDisc) : store.minDisc;
    S.scanMinDisc = minDisc;
    const runJob = async job => {
      try {
        for (let page = 1; page <= store.depth && !ctl.signal.aborted; page++) {
          const items = await P.fetchPage(job, page, ctl, minDisc);
          if (page === 1 && !items.length && S.diag) S.diag.emptyCats.push(job.g.name + ' › ' + job.name);
          const fresh = ingest(items);
          scheduleRender();
          // Stop on the last page, or when a page adds nothing and does not promise more.
          if (items.more === false || (!fresh && items.more !== true)) break;
        }
      } catch (e) { if (!ctl.signal.aborted) S.errors++; }
      S.done++; scheduleRender();
    };
    // The first request finds the right data centre; then the workers run in parallel.
    if (queue.length) await runJob(queue.shift());
    const worker = async () => { while (queue.length && !ctl.signal.aborted) await runJob(queue.shift()); };
    await Promise.all(Array.from({ length: (typeof P !== 'undefined' && P.workers) || 4 }, worker));
    S.scanning = false;
    recordPrices();
    store.lastScan = Date.now(); save(); render();
    notify();
    if (P.noLocation()) { toast(P.noLocMsg); return; }
    toast(ctl.signal.aborted ? 'Scan stopped' : `Scan complete · ${S.products.size} products` + (S.errors ? ` · ${S.errors} failed` : ''));
  }

  // ───────────────────────── Filtering ─────────────────────────
  // Unit price: rupees per kg, litre or piece, read from the pack size in the title.
  const UNITS = { kg: ['kg', 1], kgs: ['kg', 1], g: ['kg', .001], gm: ['kg', .001], gms: ['kg', .001], gram: ['kg', .001], grams: ['kg', .001], l: ['L', 1], ltr: ['L', 1], litre: ['L', 1], liter: ['L', 1], ml: ['L', .001], pc: ['pc', 1], pcs: ['pc', 1], piece: ['pc', 1], pieces: ['pc', 1], unit: ['pc', 1], units: ['pc', 1] };
  function unitOf(t) {
    const m = String(t).toLowerCase().match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kgs?|gms?|grams?|g|ltr|litre|liter|l|ml|pcs?|pieces?|units?)\b(?:\s*[x×]\s*(\d+))?/);
    if (!m || !UNITS[m[3]]) return null;
    const u = UNITS[m[3]], qty = +(m[1] || m[4] || 1) * +m[2] * u[1];
    return qty > 0 ? { base: u[0], qty } : null;
  }
  const r1 = n => n < 10 ? '₹' + n.toFixed(1) : $inr(n);
  function unitLabel(p) {
    if (!p.unit) return '';
    const per = p.price / p.unit.qty;
    if (p.unit.base === 'pc') return r1(per) + ' per piece';
    return p.unit.qty < 1 ? r1(per / 10) + ' per 100' + (p.unit.base === 'kg' ? ' g' : ' ml') : r1(per) + ' per ' + p.unit.base;
  }
  const UNIT_GROUPS = { kg: 'Weight · per kg', L: 'Volume · per L', pc: 'Count · per piece' };
  const UNIT_ORDER = Object.keys(UNIT_GROUPS);
  function compareUnitPrice(a, b) {
    if (!a.unit || !b.unit) return Number(!a.unit) - Number(!b.unit);
    if (a.unit.base !== b.unit.base) return UNIT_ORDER.indexOf(a.unit.base) - UNIT_ORDER.indexOf(b.unit.base);
    return a.price / a.unit.qty - b.price / b.unit.qty;
  }
  const PRICE_BANDS = {
    under100: ['Under ₹100', 0, 100],
    under250: ['₹100–₹249.99', 100, 250],
    under500: ['₹250–₹499.99', 250, 500],
    over500: ['₹500 and above', 500, Infinity]
  };
  const DISCOUNT_BANDS = [0, 30, 50, 70, 90];
  const STOCK_OPTIONS = [['', 'Any stock'], ['in', 'In stock'], ['out', 'Out of stock']];
  const PRESETS = {
    big: ['Save ₹100+', p => p.save >= 100],
    drops: ['Price drops', p => !!p.was],
    lowest: ['Lowest ever', p => !!p.lowEver]
  };
  // Price history: a few points per product, kept only in this browser.
  store.hist = store.hist || {};
  store.favAt = store.favAt || {};
  function recordPrices() {
    const now = Date.now(), h = store.hist;
    S.products.forEach(p => {
      store.prices[p.id] = p.price;
      const a = h[p.id] || (h[p.id] = []), last = a[a.length - 1];
      if (!last || last[1] !== p.price || now - last[0] > 864e5) { a.push([now, p.price]); if (a.length > 10) a.shift(); }
    });
    const ks = Object.keys(h); if (ks.length > 2500) ks.slice(0, ks.length - 2500).forEach(k => delete h[k]);
    const ps = Object.keys(store.prices); if (ps.length > 6000) ps.slice(0, ps.length - 6000).forEach(k => delete store.prices[k]);
  }
  const score = p => p.disc + Math.min(30, p.save / 8);
  const SORTS = {
    score: ['Best deal', (a, b) => score(b) - score(a)],
    disc: ['Highest discount', (a, b) => byDisc(a, b)],
    save: ['Biggest saving ₹', (a, b) => b.save - a.save],
    pasc: ['Price: low → high', (a, b) => a.price - b.price],
    pdesc: ['Price: high → low', (a, b) => b.price - a.price],
    unit: ['Unit price by unit', compareUnitPrice],
    name: ['Name A–Z', (a, b) => a.title.localeCompare(b.title)]
  };
  // Comma separates OR groups; spaces inside a group are AND.
  function matchQuery(p, q) {
    const groups = String(q || '').trim().toLowerCase().split(',').map(g => g.trim().split(/\s+/).filter(Boolean)).filter(g => g.length);
    if (!groups.length) return true;
    const t = (p.title + ' ' + (p.brand || '') + ' ' + p.cat).toLowerCase();
    return groups.some(g => g.every(w => t.includes(w)));
  }
  function categoryOf(p) { return p.cat.split(' › ')[0]; }
  function filtered() {
    const fav = new Set(store.favs), hid = new Set(store.hidden);
    const band = PRICE_BANDS[S.priceBand];
    const out = [];
    S.products.forEach(p => {
      if (hid.has(p.id)) return;
      if (store.stock && p.inStock !== (store.stock === 'in')) return;
      if (p.disc < store.minDisc) return;
      if (store.maxPrice && p.price > store.maxPrice) return;
      if (band && (p.price < band[1] || p.price >= band[2])) return;
      if (S.brand && p.brand !== S.brand) return;
      if (S.cat && categoryOf(p) !== S.cat) return;
      if (S.pack && p.pack !== S.pack) return;
      if (S.unit && p.unit?.base !== S.unit) return;
      if ((S.favOnly || S.tab === 'saved') && !fav.has(p.id)) return;
      if (S.newOnly && !p.isNew && !p.was) return;
      if (S.preset && !PRESETS[S.preset][1](p)) return;
      if (!matchQuery(p, S.q)) return;
      out.push(p);
    });
    return out.sort((SORTS[store.sort] || SORTS.disc)[1]);
  }

  // ───────────────────────── UI ─────────────────────────
  const PLATFORM = 'BigBasket';
  const STORE_URL = 'https://www.bigbasket.com/';
  const host = document.createElement('div');
  host.id = 'fkm-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:none';
  const root = host.attachShadow({ mode: 'open' });
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    bag: '<path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    eyeoff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6C3.6 8.6 2 12 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    scan: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    ext: '<path d="M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    arrowdown: '<path d="M12 4v13M6.5 11.5 12 17l5.5-5.5"/><path d="M6 21h12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
  };
  const ic = (n, s) => `<svg class="i" viewBox="0 0 24 24" width="${s || 18}" height="${s || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
.app{--bg:#f4f6f2;--sf:#fff;--sf2:#eff2eb;--tx:#19221a;--mt:#535f55;--bd:#dde5da;--pr:#38651e;--pr2:#294c15;--onpr:#fff;--ac:#e8f0de;--on:#2c481c;--hd:#38651e;--ok:#127047;--hot:#b63532;
 position:absolute;inset:0;background:var(--bg);color:var(--tx);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
.app.dark{--bg:#131a15;--sf:#1a231c;--sf2:#263128;--tx:#f0f4ed;--mt:#afbdb0;--bd:#38463a;--pr:#a8d285;--pr2:#c4eaaa;--onpr:#172513;--ac:#2b3e29;--on:#d9ebcc;--ok:#80d4a7;--hot:#ff8c86}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer;border:0;background:none}
.i{display:block;flex:none}
header{display:flex;align-items:center;gap:10px;padding:0 24px;height:66px;flex:none;background:var(--sf);color:var(--tx);position:relative;border-bottom:1px solid var(--bd)}
.logo{display:flex;align-items:center;gap:11px;white-space:nowrap;margin-right:6px}
.logo .mk{width:38px;height:38px;border-radius:8px;background:var(--ac);color:var(--on);display:grid;place-items:center;flex:none}
.logo b{display:block;font-weight:800;font-size:17px;letter-spacing:-.3px;line-height:1.15}
.logo small{display:flex;align-items:center;gap:6px;font-weight:600;font-size:11px;line-height:1.3;margin-top:3px;color:var(--mt)}
.flag{font-size:10px;font-weight:800;background:var(--ac);color:var(--on);border-radius:4px;padding:0 6px;text-transform:uppercase}
.search{flex:1;max-width:540px;min-width:140px;position:relative;display:flex;align-items:center}
.search .i{position:absolute;left:12px;color:var(--mt);pointer-events:none}
.search input{width:100%;height:38px;border:1px solid var(--bd);border-radius:7px;padding:0 35px 0 37px;background:var(--bg);outline:0;font-size:13px}
.search input:focus{background:var(--sf);border-color:var(--pr)}
.search input::placeholder{color:var(--mt)}
.search kbd{position:absolute;right:9px;color:var(--mt);background:var(--sf);border:1px solid var(--bd)}
.sp{flex:1}
.ib,.hb,.sb{height:37px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-weight:700;font-size:13px;white-space:nowrap;position:relative;transition:background .15s}
.ib,.hb{border:1px solid var(--bd);background:var(--sf);color:var(--tx)}
.ib{width:37px;flex:none}
.hb{padding:0 12px}
.ib:hover,.hb:hover{background:var(--sf2)}
.sb{padding:0 16px;background:var(--pr);color:var(--onpr)}
.sb:hover{filter:brightness(.95)}
.sb.stop{background:var(--sf2);color:var(--tx)}
.hb .n{background:var(--ac);color:var(--on);border-radius:99px;padding:0 7px;font-size:11px;font-weight:800;line-height:18px}
.dot{display:none}
.dot.on{display:block;position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--ok)}
.prog{position:absolute;left:0;bottom:0;height:3px;background:var(--pr);transition:width .3s}
.body{flex:1;display:flex;min-height:0}
aside{position:absolute;z-index:4;inset:0 auto 0 0;width:min(330px,90%);transform:translateX(-105%);visibility:hidden;transition:transform .2s,visibility .2s;background:var(--sf);border-right:1px solid var(--bd);overflow:auto;padding:20px 18px 38px;display:flex;flex-direction:column;gap:24px}
aside.open{transform:none;visibility:visible;box-shadow:10px 0 35px rgba(0,0,0,.12)}
.settings-title{display:flex;align-items:center;justify-content:space-between;gap:8px}
aside h4{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px}
aside h4 .i{color:var(--pr)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bd);background:var(--sf);border-radius:99px;padding:5px 12px;font-size:12.5px;font-weight:600;white-space:nowrap}
.chip:hover{border-color:var(--tx)}
.chip.on{background:var(--ac);border-color:var(--pr);color:var(--on)}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.row b{font-weight:800}
.fld{width:100%;height:38px;padding:0 12px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);outline:0;font-weight:600}
.fld:focus,select:focus{border-color:var(--pr)}
.stack{display:flex;flex-direction:column;gap:8px}
input[type=range]{width:100%;accent-color:var(--pr);margin-top:4px}
input[type=checkbox]{accent-color:var(--pr);width:16px;height:16px}
.sw{display:flex;gap:10px;align-items:center;cursor:pointer;font-weight:500}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--ac);color:var(--on);border-radius:12px;height:46px;font-weight:800;font-size:15px;width:100%}
.btn:hover{filter:brightness(.95)}
.btn.stop{background:var(--tx);color:var(--bg)}
.btn.ghost{background:var(--sf);color:var(--tx);border:1px solid var(--bd);height:40px;font-size:13.5px;width:auto;padding:0 16px}
.btn.ghost:hover{border-color:var(--tx);filter:none}
.btn.full{width:100%}
.note{color:var(--mt);font-size:12.5px;line-height:1.55}
.note b{color:var(--tx)}
.tgcard{border:1px solid var(--bd);border-radius:14px;padding:14px;background:var(--bg)}
.tgcard.on{border-color:var(--pr)}
main{flex:1;overflow:auto;padding:18px clamp(16px,3.2vw,52px) 48px;min-width:0}
.browse{background:var(--sf);border:1px solid var(--bd);border-radius:9px;padding:13px 15px;margin-bottom:20px;box-shadow:0 1px 3px rgba(20,32,20,.05)}
.browse-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.matches{white-space:nowrap;border-radius:99px;background:var(--ac);color:var(--on);padding:4px 10px;font-size:12px;font-weight:700}
.facets{display:grid;grid-template-columns:repeat(auto-fit,minmax(133px,1fr));gap:8px 10px}
.facet{display:grid;gap:3px;min-width:0;color:var(--mt);font-size:11.5px;font-weight:650}
.facet select{width:100%;max-width:none;height:35px;min-width:0;padding:0 7px;color:var(--tx);background:var(--sf);border-radius:6px;font-size:12px;font-weight:550}
.quick,.quick-presets{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.quick{margin-top:12px}
.quick>span,.scan-note{font-size:12px;font-weight:600;color:var(--mt)}
.quick .chip{font-size:11.5px;padding:4px 9px}
.quick-presets{padding-left:9px;margin-left:3px;border-left:1px solid var(--bd)}
.reset{margin-left:auto;color:var(--pr);font-size:12px;font-weight:700;padding:5px}
.reset:hover{text-decoration:underline}
.scan-note{margin-top:8px}
select{height:38px;border:1px solid var(--bd);border-radius:10px;background:var(--sf);padding:0 10px;outline:0;font-weight:600;max-width:190px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(188px,1fr));gap:12px}
.grid.list{grid-template-columns:1fr;gap:10px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;position:relative;transition:transform .15s,box-shadow .15s}
.card:hover{transform:translateY(-2px);box-shadow:0 4px 14px rgba(22,32,22,.09)}
.card.oos .im img{opacity:.55}
.list .card{flex-direction:row}.list .card:hover{transform:none}
.list .im{width:110px;height:110px;flex:none;aspect-ratio:auto}
.im{height:148px;background:var(--sf2);position:relative;padding:9px;display:grid;place-items:center}
.im img{width:100%;height:100%;min-height:0;object-fit:contain}
.dc{position:absolute;left:8px;top:8px;background:#166d49;color:#fff;border-radius:4px;font-size:11px;font-weight:800;padding:3px 6px}
.dc.hot{background:#244f17}
.tg{position:absolute;left:10px;top:38px;display:inline-flex;align-items:center;gap:4px;background:var(--ac);color:var(--on);border-radius:6px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:2px 7px}
.fv{position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:50%;background:#fff;color:#7a808c;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.14)}
.fv:hover{color:var(--hot)}
.fv.on{color:var(--hot)}.fv.on svg{fill:currentColor}
.inf{padding:9px 11px 11px;display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.ti{font-size:13px;font-weight:700;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--tx);text-decoration:none}
a.ti:hover{color:var(--pr)}
.ct{font-size:12px;color:var(--mt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ct.brand{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:750}
.pr{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-top:4px}
.pr b{font-size:19px;font-weight:800;letter-spacing:-.35px}
.pr s{color:var(--mt);font-size:13px}
.sv{font-size:12.5px;color:var(--ok);font-weight:700}
.sv i{font-style:normal;color:var(--hot)}
.was{font-size:12px;color:var(--mt)}
.acts{display:flex;gap:6px;margin-top:auto;padding-top:8px}
.acts button{flex:1;height:32px;border-radius:6px;font-size:12px;font-weight:750;background:var(--ac);color:var(--on);display:inline-flex;align-items:center;justify-content:center;gap:6px}
.acts button:hover{background:var(--pr);color:var(--onpr)}
.acts .add.in{background:var(--sf);color:var(--pr);box-shadow:inset 0 0 0 1.5px var(--pr)}
.acts .hide{flex:none;width:40px;background:var(--sf2);color:var(--mt)}
.acts .hide:hover{background:var(--bd);color:var(--tx)}
.empty{color:var(--mt);padding:80px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px}
.empty .ei{width:56px;height:56px;border-radius:16px;background:var(--sf2);color:var(--pr);display:grid;place-items:center;margin-bottom:8px}
.empty b{display:block;color:var(--tx);font-size:18px;font-weight:800}
.drawer{position:absolute;top:0;right:0;bottom:0;width:min(420px,100%);background:var(--sf);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .22s;z-index:5;box-shadow:-16px 0 40px rgba(0,0,0,.16)}
.drawer.open{transform:none}
.drawer header{gap:10px}
.drawer header b{flex:1;display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800}
.dl{flex:1;overflow:auto;padding:6px 20px}
.li{display:flex;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid var(--bd)}
.li img{width:52px;height:52px;border-radius:10px;object-fit:cover;background:var(--sf2)}
.li div{flex:1;min-width:0;font-size:13px}.li .ti{-webkit-line-clamp:1;font-size:13.5px}
.li s{color:var(--mt);font-size:12px;margin-left:6px}
.qty{display:flex;align-items:center;gap:8px;font-weight:800}.qty button{width:30px;height:30px;border-radius:9px;background:var(--sf2);display:grid;place-items:center}
.df{padding:18px 20px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:10px}
.df .tot{font-size:24px;font-weight:800;letter-spacing:-.6px}
.toast{position:absolute;left:50%;bottom:24px;transform:translateX(-50%) translateY(80px);background:var(--tx);color:var(--bg);padding:12px 18px;border-radius:12px;opacity:0;transition:.2s;pointer-events:none;z-index:9;max-width:90%;font-weight:600}
.toast.on{transform:translateX(-50%);opacity:1}
kbd{border:1px solid var(--bd);border-radius:5px;padding:0 5px;font-size:11px;font-weight:700}
.tg.low{background:var(--ok);color:#fff}
.up{font-size:12px;color:var(--mt);font-weight:600}
.hist{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--mt);font-weight:600;margin-top:2px}
.hist svg{flex:none}
.watch{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:14px 16px;margin-bottom:18px}
.wh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.wh b{display:flex;align-items:center;gap:8px;font-weight:800}.wh b .i{color:var(--hot);fill:var(--hot)}
.wh span{color:var(--mt);font-size:12.5px;font-weight:600}
.wl{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}
.mini{flex:none;width:230px;display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:12px;padding:8px;text-decoration:none;color:inherit;background:var(--bg)}
.mini img{width:48px;height:48px;border-radius:9px;object-fit:cover;background:var(--sf2)}
.mini div{min-width:0;font-size:12.5px}.mini .ti{-webkit-line-clamp:1;font-size:13px}
.mini em{font-style:normal;font-weight:700;font-size:11.5px}.mini .dn{color:var(--ok)}.mini .upx{color:var(--hot)}.mini .eq{color:var(--mt)}
.check{max-width:520px;margin:40px auto;background:var(--sf);border:1px solid var(--bd);border-radius:20px;padding:24px}
.check h3{font-size:19px;font-weight:800;margin-bottom:14px;letter-spacing:-.3px}
.ck{display:flex;gap:12px;padding:10px 0;border-top:1px solid var(--bd)}
.ck>span{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none}
.ck.ok>span{background:color-mix(in srgb,var(--ok) 16%,var(--sf));color:var(--ok)}
.ck.no>span{background:color-mix(in srgb,var(--hot) 16%,var(--sf));color:var(--hot)}
.ck.q>span{background:var(--sf2);color:var(--mt)}
.ck b{font-weight:700}.ck p{color:var(--mt);font-size:12.5px;margin-top:2px}
.tabs{display:flex;align-items:center;gap:4px;padding:3px;border-radius:7px;background:var(--sf2)}
.tabs button{height:30px;padding:0 12px;border-radius:5px;font-weight:700;font-size:12px;color:var(--mt);white-space:nowrap}
.tabs button.on{background:var(--sf);color:var(--pr);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.live{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:12.5px;font-weight:700;color:var(--pr)}
.live .i{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.sec{margin-bottom:24px}
.sh{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.sh h3{font-size:17px;font-weight:800;letter-spacing:-.25px}
.sh span{color:var(--mt);font-size:12.5px;font-weight:600}
.more{display:inline-flex;align-items:center;gap:5px;color:var(--pr);font-weight:800;font-size:13px;white-space:nowrap}
.hs{display:grid;grid-auto-flow:column;grid-auto-columns:188px;gap:12px;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin}
.mob{display:none}
.picker{position:absolute;z-index:7;left:50%;top:50%;transform:translate(-50%,-50%);width:min(580px,calc(100% - 24px));max-height:calc(100% - 40px);display:flex;flex-direction:column;background:var(--sf);border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.3);overflow:hidden;animation:fade .15s}
.ph{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--bd)}
.ph b{display:block;font-size:18px;font-weight:800;letter-spacing:-.3px}.ph small{color:var(--mt);font-size:12.5px;font-weight:600}
.ib.soft{background:var(--sf2);color:var(--tx)}.ib.soft:hover{background:var(--bd)}
.pb{padding:18px 20px;overflow:auto}.pb .chip{padding:7px 13px;font-size:13px}
.pf{display:flex;gap:10px;padding:14px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--bd)}.pf .btn{flex:1;width:auto}.pf .btn.ghost{flex:0 0 auto;height:46px}
.btn[disabled]{opacity:.45;pointer-events:none}
.tgb .dot{top:7px;right:7px}
.tgt{display:flex;align-items:center;gap:12px}
.tgi{width:42px;height:42px;border-radius:12px;background:#229ed9;color:#fff;display:grid;place-items:center;flex:none}
.ph small.ok{color:var(--ok)}
.tgs{list-style:none;padding:0;margin:0 0 16px;counter-reset:t;display:flex;flex-direction:column;gap:14px}
.tgs li{counter-increment:t;position:relative;padding-left:40px;display:flex;flex-direction:column;gap:6px}
.tgs li:before{content:counter(t);position:absolute;left:0;top:-1px;width:28px;height:28px;border-radius:9px;background:var(--pr);color:#fff;font-weight:800;font-size:13px;display:grid;place-items:center}
.tgs b{font-weight:800}.tgs span{color:var(--mt);font-size:13px}
.tgs code{font:12px ui-monospace,Menlo,monospace;background:var(--sf2);border-radius:5px;padding:0 5px}
.tlink{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:99px;background:#229ed9;color:#fff;font-weight:700;font-size:12.5px;text-decoration:none}
.tlink:hover{background:#1c8bc0}
.scrim{position:absolute;inset:0;background:rgba(10,12,16,.45);z-index:4;animation:fade .2s}.scrim.side{z-index:3}@keyframes fade{from{opacity:0}}
.body{position:relative}
@media(max-width:900px){
 .mob{display:flex;gap:7px;flex-wrap:wrap}
 header{padding:9px 12px;gap:7px;height:auto;flex-wrap:wrap}
 .logo{margin-right:0;min-width:0;flex:1 1 0;overflow:hidden}.logo>div{min-width:0;overflow:hidden}header .sp{display:none}.search kbd,.hb .lb,.sb .lb,[data-act=theme].ib{display:none}
 .logo b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .ib,.hb,.sb{height:38px}.ib{width:38px}.hb,.sb{padding:0 11px}
 .search{order:9;flex-basis:100%;max-width:none;min-width:0}.search input{height:40px}
 main{padding:14px 12px 40px}
 .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
 .tabs button{padding:0 9px}.live{flex:0 0 auto}
 .hs{grid-auto-columns:46%;gap:10px;margin:0 -12px;padding:0 12px 6px;scrollbar-width:none}.hs::-webkit-scrollbar{display:none}
 .sh h3{font-size:16px}.sec{margin-bottom:22px}
 .card:hover{transform:none;box-shadow:none}
 .im{height:122px}.inf{padding:8px}.ti{font-size:12.5px}.ct{font-size:11px}.pr b{font-size:17px}.pr s{font-size:12px}.sv,.up{font-size:11.5px}
 .acts button{height:34px;font-size:12px;gap:4px}.acts .hide{width:34px}
 .dc{font-size:11px;padding:2px 6px;left:8px;top:8px}.tg{left:8px;top:32px;font-size:9.5px}.fv{width:30px;height:30px;top:6px;right:6px}
 .list .im{width:88px;height:88px}
 .check{margin:20px 0;padding:18px}
 .picker{top:auto;bottom:0;left:0;transform:none;width:100%;max-height:88%;border-radius:20px 20px 0 0}
 .toast{bottom:calc(16px + env(safe-area-inset-bottom))}
}
@media(max-width:520px){
 header{gap:5px}.logo{gap:5px}.logo .mk{width:27px;height:27px}.logo .mk .i{width:16px;height:16px}.logo b{font-size:13px}.logo small{font-size:10px}
 .ib,.hb,.sb{height:34px}.ib{width:32px}.hb,.sb{padding:0 8px}.tgb{display:none}
 .browse{padding:10px;margin-bottom:15px}.facets{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
 .facet select{padding:0 3px;font-size:11px}.quick{margin-top:9px}.quick-presets{margin:0;padding:0;border:0}
 .matches{padding:4px 7px;font-size:11px}
}
`;
  root.innerHTML = '<style>' + CSS + '</style><div class="app" id="app"></div>';
  const app = root.getElementById('app');

  let sideOpen = false;
  const groupChip = g => `<button class="chip ${store.groups.includes(g.id) ? 'on' : ''}" data-act="grp" data-id="${g.id}">${esc(g.name)}</button>`;
  function scanUI() {
    return `<div><h4>${ic('scan', 15)}Scan</h4>
  ${P.locUI(store, esc)}
  <p class="note" style="margin-top:6px">Each scan asks which categories to check. Last time: ${store.groups.length} of ${GROUPS.length}.</p></div>
 ${S.scanning ? `<button class="btn stop" data-act="stop">${ic('stop')}Stop scan</button>` : `<button class="btn" data-act="scan">${ic('scan')}Choose & scan</button>`}`;
  }
  // Asked before every scan: which categories, and how deep.
  function pickerUI() {
    const n = store.groups.length;
    return `<div class="scrim" data-act="pclose" style="z-index:6"></div><div class="picker" role="dialog" aria-label="Choose what to scan">
 <div class="ph"><div><b>What should Hunter scan?</b><small>${esc(PLATFORM)} · pick one or more categories</small></div><button class="ib soft" data-act="pclose" title="Close">${ic('x')}</button></div>
 <div class="pb"><div class="chips">${GROUPS.map(groupChip).join('')}</div>
  <div class="row" style="margin-top:12px;justify-content:flex-start;gap:6px"><button class="chip" data-act="all">Select all</button><button class="chip" data-act="none">Clear</button></div>
  <label class="row" style="margin-top:20px"><span>Pages per category</span><b>${store.depth}</b></label><input type="range" min="1" max="5" value="${store.depth}" data-in="depth">
  <p class="note" style="margin-top:4px">More pages find more deals but take longer.</p></div>
 <div class="pf"><button class="btn ghost" data-act="pclose">Cancel</button><button class="btn" data-act="pstart" ${n ? '' : 'disabled'}>${ic('scan')}Scan ${n} ${n === 1 ? 'category' : 'categories'}</button></div></div>`;
  }
  function openPicker() {
    if (OFFSITE) { toast('Open ' + PLATFORM + ' to fetch live deals.'); return; }
    if (typeof captureUI === 'function') { autoScroll(); return; }
    if (S.scanning) return;
    sideOpen = false; S.pick = true; render();
  }
  // Telegram setup, opened from the header.
  function tgModal() {
    const t = store.tg, ready = tgReady();
    const status = ready ? (t.on ? 'Connected · alerts on' : 'Connected · alerts off') : 'Not set up yet · about 2 minutes';
    return `<div class="scrim" data-act="tgclose" style="z-index:6"></div><div class="picker" role="dialog" aria-label="Telegram alerts">
 <div class="ph"><div class="tgt"><span class="tgi">${ic('send', 20)}</span><div><b>Telegram alerts</b><small class="${ready && t.on ? 'ok' : ''}">${status}</small></div></div><button class="ib soft" data-act="tgclose" title="Close">${ic('x')}</button></div>
 <div class="pb">
  <ol class="tgs">
   <li><b>Create a bot</b><span>Open BotFather, send <code>/newbot</code>, follow the prompts and copy the token.</span><a class="tlink" href="https://t.me/BotFather" target="_blank" rel="noopener">${ic('ext', 14)}Open @BotFather</a></li>
   <li><b>Press Start in your new bot</b><span>So it is allowed to message you.</span></li>
   <li><b>Get your chat ID</b><span>Userinfobot replies with a number: that is your chat ID.</span><a class="tlink" href="https://t.me/userinfobot" target="_blank" rel="noopener">${ic('ext', 14)}Open @userinfobot</a></li>
   <li><b>Paste both here</b>
    <input class="fld" type="password" data-in="tgToken" placeholder="Bot token" value="${esc(t.token)}" autocomplete="off">
    <input class="fld" data-in="tgChat" placeholder="Chat ID" value="${esc(t.chat)}" autocomplete="off" inputmode="numeric"></li>
  </ol>
  <div class="tgcard ${t.on ? 'on' : ''} stack">
   <label class="sw"><input type="checkbox" data-in="tgOn" ${t.on ? 'checked' : ''}> <b>Send deals to Telegram</b></label>
   <label class="row" style="margin-top:4px"><span>Alert from</span><b id="tgminv">${t.minDisc}% off</b></label><input type="range" min="20" max="90" step="5" value="${t.minDisc}" data-in="tgMin">
   <label class="sw"><input type="checkbox" data-in="tgDrops" ${t.drops ? 'checked' : ''}> Any price drop</label>
   <label class="sw"><input type="checkbox" data-in="tgWatch" ${t.watch ? 'checked' : ''}> Saved items that get cheaper</label>
  </div>
  <p class="note" style="margin-top:12px">Alerts go out after each scan. Each deal is sent once, and again only if it gets cheaper. If the test fails on this store, install the userscript. Your token stays in this browser.</p>
 </div>
 <div class="pf"><button class="btn ghost" data-act="tgtest">${ic('send', 16)}Send test</button><button class="btn" data-act="tgclose">Done</button></div></div>`;
  }
  function sidebar() {
    return `<aside class="${sideOpen ? 'open' : ''}">
 <div class="settings-title"><h3>Tools &amp; settings</h3><button class="ib" data-act="side" aria-label="Close settings">${ic('x', 18)}</button></div>
 <div class="mob"><button class="chip" data-act="theme">${ic('moon', 14)}Theme</button><button class="chip" data-act="tgopen">${ic('send', 14)}Telegram ${store.tg.on && tgReady() ? 'on' : 'off'}</button></div>
 ${typeof captureUI === 'function' && !OFFSITE ? captureUI() : scanUI()}
 <div><h4>${ic('sliders', 15)}Fine-tune filters</h4>
  <label class="row"><span>Min discount</span><b>${store.minDisc}%</b></label><input type="range" min="0" max="90" step="5" value="${store.minDisc}" data-in="minDisc">
  <label class="row" style="margin-top:14px"><span>Max price</span><b>${store.maxPrice ? $inr(store.maxPrice) : 'Any'}</b></label><input type="range" min="0" max="2000" step="50" value="${store.maxPrice}" data-in="maxPrice">
  <label class="sw" style="margin-top:16px"><input type="checkbox" data-in="favOnly" ${S.favOnly ? 'checked' : ''}> Saved only</label>
  <label class="sw" style="margin-top:10px"><input type="checkbox" data-in="newOnly" ${S.newOnly ? 'checked' : ''}> New or price dropped</label></div>
 <div><h4>${ic('download', 15)}Export</h4><div class="chips"><button class="chip" data-act="csv">${ic('download', 14)}CSV</button><button class="chip" data-act="json">${ic('download', 14)}JSON</button><button class="chip" data-act="copyall">${ic('copy', 14)}Copy top 20</button><button class="chip" data-act="unhide">${ic('eyeoff', 14)}Unhide (${store.hidden.length})</button><button class="chip" data-act="selftest">${ic('check', 14)}Self-test</button></div>${S.selfTest ? `<p class="note" style="margin-top:10px">Self-test: ${S.selfTest.pass ? 'PASS' : 'FAIL'} — ${S.selfTest.got}/${S.selfTest.total} sample products parsed${S.selfTest.bad ? `, ${S.selfTest.bad} incomplete` : ''}.</p>` : ''}
  <p class="note" style="margin-top:14px"><kbd>/</kbd> search &nbsp;<kbd>S</kbd> scan &nbsp;<kbd>Esc</kbd> close</p></div>
</aside>`;
  }
  function spark(p) {
    const pts = (store.hist[p.id] || []).map(x => x[1]);
    if (pts[pts.length - 1] !== p.price) pts.push(p.price);
    if (pts.length < 2) return '';
    const lo = Math.min(...pts), hi = Math.max(...pts), w = 64, h = 18, n = pts.length - 1;
    const xy = pts.map((v, i) => [Math.round(i / n * w), hi === lo ? h / 2 : Math.round(2 + (hi - v) / (hi - lo) * (h - 4))]);
    const last = xy[xy.length - 1];
    return `<div class="hist"><svg width="${w + 4}" height="${h}" viewBox="-2 0 ${w + 4} ${h}"><polyline points="${xy.map(a => a.join(',')).join(' ')}" fill="none" stroke="var(--pr)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="var(--pr)"/></svg>Low ${$inr(lo)} · high ${$inr(hi)}</div>`;
  }
  function offsiteCard() {
    return `<div class="check"><h3>Open ${esc(PLATFORM)} to see live deals</h3><p class="note" style="font-size:14px">PriceDrop Hunter reads live prices inside your own ${esc(PLATFORM)} tab, so it can only fetch deals there.</p><p class="note" style="font-size:14px;margin-top:8px"><b>Userscript installed?</b> Hunter opens by itself on the store. <b>Using the bookmark?</b> After the store opens, tap your PriceDrop Hunter bookmark again on that page.</p><a class="btn" href="${STORE_URL}#pricedrop" target="_blank" rel="noopener" style="margin-top:16px;text-decoration:none">${ic('ext')}Open ${esc(PLATFORM)}</a></div>`;
  }
  function checklist() {
    const capture = typeof captureUI === 'function';
    const loc = typeof fkLocCheck === 'function' ? fkLocCheck() : (typeof P !== 'undefined' && P.locCheck ? P.locCheck() : null);
    const rows = [
      [true, 'You are on ' + PLATFORM, ''],
      [loc, 'Delivery location set', loc === false ? 'Set your delivery address on ' + PLATFORM + ', then reopen Hunter.' : 'Make sure your delivery address is set on ' + PLATFORM + '.'],
      [typeof GM_xmlhttpRequest === 'function' ? true : null, 'Userscript installed', 'Optional. Recommended for reliable Telegram alerts.'],
      [tgReady() ? true : null, 'Telegram connected', 'Optional. Press Telegram in the top bar to connect your bot.']
    ];
    return `<div class="check"><h3>Before your first ${capture ? 'capture' : 'scan'}</h3>${rows.map(([ok, t, hint]) => `<div class="ck ${ok ? 'ok' : ok === false ? 'no' : 'q'}"><span>${ic(ok ? 'check' : ok === false ? 'x' : 'info', 15)}</span><div><b>${t}</b>${!ok && hint ? `<p>${hint}</p>` : ''}</div></div>`).join('')}<button class="btn" data-act="scan" style="margin-top:16px">${ic('scan')}${capture ? 'Auto-scroll page' : 'Scan deals'}</button></div>` + diagHtml();
  }
  // After a scan that found nothing, say why instead of showing a blank page.
  function diagHtml() {
    const d = S.diag;
    if (!d || !d.ran || S.products.size) return '';
    const rows = [];
    if (blocked) rows.push(['BigBasket blocked this browser (HTTP 403)', 'Open bigbasket.com in this tab, set your location, wait a few seconds and scan again. Cloud servers are usually blocked — the Telegram bot needs a self-hosted runner.']);
    if (d.rateLimited) rows.push([`Rate-limited ${d.rateLimited} time${d.rateLimited > 1 ? 's' : ''}`, 'BigBasket slowed the scan down. Wait a few minutes and scan again.']);
    if (d.emptyCats.length) rows.push([`${d.emptyCats.length} categor${d.emptyCats.length > 1 ? 'ies' : 'y'} returned no products`, esc(d.emptyCats.slice(0, 3).join(' · ')) + (d.emptyCats.length > 3 ? ` · +${d.emptyCats.length - 3} more` : '') + ' — they may have no deals above your minimum discount, or the listing served a shape this version cannot read. Lower the minimum discount and try again.']);
    if (!rows.length && S.errors) rows.push(['Some categories failed to load', 'Check your connection and scan again.']);
    if (!rows.length) return '';
    return `<div class="check" style="margin-top:16px"><h3>Why 0 results</h3>${rows.map(([t, hint]) => `<div class="ck no"><span>${ic('info', 15)}</span><div><b>${esc(t)}</b><p>${hint}</p></div></div>`).join('')}</div>`;
  }
  function card(p, fav, qtyMap) {
    const inList = qtyMap[p.id];
    const name = p.pack ? p.title.slice(0, -(p.pack.length + 3)) : p.title;
    return `<article class="card ${p.inStock ? '' : 'oos'}">
 <div class="im"><img src="${esc(p.img)}" alt="" loading="lazy">
  <span class="dc ${p.disc >= 60 ? 'hot' : ''}">${p.disc}% OFF</span>${p.isNew ? '<span class="tg">New</span>' : p.lowEver ? `<span class="tg low">${ic('star', 11)}Lowest ever</span>` : p.was ? `<span class="tg">${ic('arrowdown', 11)}Price drop</span>` : ''}
  <button class="fv ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(p.id)}" title="${fav ? 'Saved' : 'Save'}">${ic('heart', 17)}</button></div>
 <div class="inf"><div class="ct brand">${esc(p.brand || categoryOf(p))}</div><a class="ti" ${p.url ? `href="${esc(p.url)}" target="_blank" rel="noopener"` : ''}>${esc(name)}</a>
  <div class="ct" title="${esc(p.cat)}">${esc(p.pack || p.cat)}</div>
  <div class="pr"><b>${$inr(p.price)}</b><s>${$inr(p.mrp)}</s></div>
  <div class="sv">Save ${$inr(p.save)}${p.inStock ? '' : ' · <i>Out of stock</i>'}</div>
  ${p.unit ? `<div class="up">${unitLabel(p)}</div>` : ''}
  ${spark(p)}
  <div class="acts"><button class="add ${inList ? 'in' : ''}" data-act="add" data-id="${esc(p.id)}">${inList ? ic('check', 16) + 'In list · ' + inList : ic('plus', 16) + 'Add to list'}</button><button class="hide" data-act="hide" data-id="${esc(p.id)}" title="Hide">${ic('eyeoff', 16)}</button></div></div></article>`;
  }
  const byDisc = (a, b) => b.disc - a.disc || b.save - a.save;
  function bestView(list) {
    if (!list.length) return '';
    const top = list.slice(0, 12), fav = new Set(store.favs);
    const cats = new Map();
    for (const p of list) { const c = categoryOf(p); if (!cats.has(c)) cats.set(c, []); cats.get(c).push(p); }
    return `<section class="sec"><div class="sh"><h3>${store.sort === 'disc' ? 'Biggest discounts right now' : 'Top picks'}</h3><span>${top.length} of ${list.length} matches</span></div>
  <div class="grid">${top.map(p => card(p, fav.has(p.id), store.list)).join('')}</div></section>
 ${[...cats].map(([c, ps]) => `<section class="sec"><div class="sh"><h3>${esc(c)}</h3><button class="more" data-act="seeall" data-id="${esc(c)}">See all ${ps.length}${ic('ext', 13)}</button></div>
  <div class="hs">${ps.slice(0, 10).map(p => card(p, fav.has(p.id), store.list)).join('')}</div></section>`).join('')}`;
  }
  function facetValues(products, valueOf) {
    const counts = new Map();
    for (const p of products) {
      const value = valueOf(p);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'en-IN', { numeric: true }))
      .map(([value, count]) => [value, `${value} (${count})`]);
  }
  function facetSelect(key, label, selected, options, any) {
    const values = any ? [['', any], ...options] : options;
    if (selected && !values.some(([value]) => value === selected)) values.push([selected, selected]);
    return `<label class="facet"><span>${label}</span><select data-in="${key}">${values.map(([value, text]) => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  }
  function browseControls(list) {
    const hidden = new Set(store.hidden);
    const catalog = [...S.products.values()].filter(p => !hidden.has(p.id));
    const options = [['best', 'Best deals'], ['all', 'All deals'], ['saved', 'Saved' + (store.favs.length ? ' · ' + store.favs.length : '')]];
    const discounts = [...new Set([...DISCOUNT_BANDS, store.minDisc])].sort((a, b) => a - b);
    return `<section class="browse" aria-label="Deal filters">
 <div class="browse-top"><nav class="tabs" aria-label="Deal views">${options.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" aria-pressed="${S.tab === k}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</nav>
 ${S.scanning ? `<span class="live">${ic('scan', 14)}Scanning ${S.done}/${S.total}</span>` : `<span class="matches">${list.length} of ${catalog.length} items</span>`}</div>
 <div class="facets">
  ${facetSelect('cat', 'Category', S.cat, facetValues(catalog, categoryOf), 'All categories')}
  ${facetSelect('brand', 'Brand', S.brand, facetValues(catalog, p => p.brand), 'All brands')}
  ${facetSelect('pack', 'Pack size', S.pack, facetValues(catalog, p => p.pack), 'All sizes')}
  ${facetSelect('unit', 'Compare by', S.unit, Object.entries(UNIT_GROUPS), 'Any unit')}
  ${facetSelect('priceBand', 'Price', S.priceBand, Object.entries(PRICE_BANDS).map(([id, [label]]) => [id, label]), 'Any price')}
  ${facetSelect('stock', 'Stock', store.stock, STOCK_OPTIONS)}
  ${facetSelect('sort', 'Sort by', store.sort, Object.entries(SORTS).map(([id, [label]]) => [id, label]))}
 </div>
 <div class="quick"><span>Discount</span>${discounts.map(percent => `<button class="chip ${store.minDisc === percent ? 'on' : ''}" aria-pressed="${store.minDisc === percent}" data-act="discount" data-id="${percent}">${percent ? percent + '%+' : 'Any %'}</button>`).join('')}
 <div class="quick-presets">${Object.entries(PRESETS).map(([id, [name]]) => `<button class="chip ${S.preset === id ? 'on' : ''}" aria-pressed="${S.preset === id}" data-act="preset" data-id="${id}">${name}</button>`).join('')}</div>
 ${store.maxPrice ? `<span>Max ${$inr(store.maxPrice)}</span>` : ''}
 <button class="reset" data-act="resetfilters">Clear filters</button></div>
 ${!S.scanning && S.scanMinDisc > store.minDisc ? '<p class="scan-note">Scan again to search deeper at the lower discount.</p>' : ''}
 </section>`;
  }
  function mainView() {
    if (OFFSITE) return `<main id="main">${offsiteCard()}</main>`;
    if (!S.products.size && !S.scanning) return `<main id="main">${checklist()}</main>`;
    const list = filtered();
    const head = browseControls(list);
    let body;
    if (S.tab === 'best') {
      body = bestView(list) || `<div class="empty"><span class="ei">${ic(S.scanning ? 'scan' : 'tag', 26)}</span><b>${S.scanning ? 'Finding deals…' : 'No matching deals'}</b>${S.scanning ? 'They appear here as each category comes in.' : 'Try a different filter or clear your selection.'}</div>`;
    } else {
      const fav = new Set(store.favs);
      body = list.length ? `<div class="grid ${store.view}">${list.slice(0, S.shown).map(p => card(p, fav.has(p.id), store.list)).join('')}</div>
   ${list.length > S.shown ? `<div style="text-align:center;margin-top:24px"><button class="btn ghost" data-act="more">Show more (${list.length - S.shown} left)</button></div>` : ''}`
        : `<div class="empty"><span class="ei">${ic(S.tab === 'saved' ? 'heart' : 'tag', 26)}</span><b>${S.tab === 'saved' && !store.favs.length ? 'Nothing saved yet' : 'No matching deals'}</b>${S.tab === 'saved' && !store.favs.length ? 'Tap the heart on any deal to keep an eye on it.' : 'Try a different filter or clear your selection.'}</div>`;
    }
    return `<main id="main">${head}${body}</main>`;
  }
  function listItems() {
    return Object.entries(store.list).map(([id, q]) => [S.products.get(id) || (store._cache && store._cache[id]), q]).filter(([p]) => p);
  }
  function openListLinks() {
    let blockedTabs = 0;
    for (const [p] of listItems()) {
      if (!p.url) continue;
      const tab = window.open('about:blank', '_blank');
      if (!tab) { blockedTabs++; continue; }
      tab.opener = null;
      tab.location.replace(p.url);
    }
    if (blockedTabs) toast(`Browser blocked ${blockedTabs} tab${blockedTabs === 1 ? '' : 's'} — allow popups or click items individually`);
  }
  function drawer() {
    const items = listItems();
    const tot = items.reduce((s, [p, q]) => s + p.price * q, 0), mrp = items.reduce((s, [p, q]) => s + p.mrp * q, 0);
    return `<div class="drawer ${S.panel ? 'open' : ''}"><header><b>${ic('bag', 20)}Shopping list</b><button class="hb" data-act="clearlist">Clear</button><button class="ib" data-act="closepanel" title="Close">${ic('x')}</button></header>
 <div class="dl">${items.length ? items.map(([p, q]) => `<div class="li"><img src="${esc(p.img)}" alt=""><div>${p.url ? `<a class="ti" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : `<span class="ti">${esc(p.title)}</span>`}<b>${$inr(p.price * q)}</b><s>${$inr(p.mrp * q)}</s></div><div class="qty"><button data-act="dec" data-id="${esc(p.id)}">−</button>${q}<button data-act="inc" data-id="${esc(p.id)}">+</button></div></div>`).join('') : `<div class="empty"><span class="ei">${ic('bag', 26)}</span><b>Your list is empty</b>Tap “Add to list” on any deal.</div>`}</div>
 <div class="df"><div class="row"><span class="note">Total</span><span class="tot">${$inr(tot)}</span></div><div class="row"><span class="note">You save</span><b style="color:var(--ok);font-size:16px">${$inr(mrp - tot)}</b></div>
 <div class="row" style="gap:10px;margin-top:4px"><button class="btn ghost" style="flex:1" data-act="copylist">${ic('copy', 16)}Copy list</button><button class="btn" style="flex:1;height:40px;font-size:14px" data-act="openlinks">${ic('ext', 16)}Open all</button></div></div></div>`;
  }
  function render() {
    const dark = store.theme === 'dark' || (store.theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
    const keepScroll = (root.getElementById('main') || {}).scrollTop || 0;
    const sideScroll = (root.querySelector('aside') || {}).scrollTop || 0;
    const focused = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.in : null;
    const count = Object.values(store.list).reduce((a, b) => a + b, 0);
    const pct = S.total ? Math.round(S.done / S.total * 100) : 0;
    const capture = typeof captureUI === 'function' && !OFFSITE;
    app.className = 'app' + (dark ? ' dark' : '');
    app.innerHTML = `<header>
 <div class="logo"><span class="mk">${ic('arrowdown', 20)}</span><div><b>${esc(PLATFORM)} Deals</b><small>PriceDrop Hunter${OFFSITE ? '<span class="flag">Not on store</span>' : ''}</small></div></div>
 <label class="search">${ic('search', 17)}<input data-in="q" aria-label="Search products or brands" title="Separate alternatives with commas" placeholder="Search products or brands" value="${esc(S.q)}"><kbd>/</kbd></label><span class="sp"></span>
 ${capture ? '' : S.scanning ? `<button class="sb stop" data-act="stop" aria-label="Stop scan">${ic('stop', 16)}<span class="lb">Stop</span></button>` : `<button class="sb" data-act="scan" aria-label="Scan deals">${ic('scan', 16)}<span class="lb">Scan</span></button>`}
 <button class="hb tgb" data-act="tgopen" title="Telegram alerts">${ic('send', 16)}<span class="lb">Telegram</span><span class="dot ${store.tg.on && tgReady() ? 'on' : ''}"></span></button>
 <button class="ib" data-act="theme" title="${dark ? 'Light' : 'Dark'} mode">${ic(dark ? 'sun' : 'moon')}</button>
 <button class="hb" data-act="panel" title="Shopping list">${ic('bag')}<span class="lb">List</span>${count ? `<span class="n">${count}</span>` : ''}</button>
 <button class="ib" data-act="side" title="Tools and settings" aria-expanded="${sideOpen}">${ic('sliders', 17)}</button>
 <button class="ib" data-act="close" title="Close (Esc)">${ic('x')}</button>${S.scanning ? `<div class="prog" style="width:${pct}%"></div>` : ''}</header>
 <div class="body">${sideOpen ? '<div class="scrim side" data-act="side"></div>' : ''}${sidebar()}${mainView()}</div>${S.panel ? '<div class="scrim" data-act="closepanel"></div>' : ''}${drawer()}${S.pick ? pickerUI() : ''}${S.tgm ? tgModal() : ''}<div class="toast" id="toast"></div>`;
    const m = root.getElementById('main'); if (m) m.scrollTop = keepScroll;
    const a = root.querySelector('aside'); if (a) a.scrollTop = sideScroll;
    if (focused === 'q') { const i = root.querySelector('[data-in=q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  let rq = 0;
  const scheduleRender = () => { if (rq) return; rq = setTimeout(() => { rq = 0; render(); }, 250); };
  let tt;
  function toast(msg) {
    const t = root.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3600);
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || 'Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast(msg || 'Copied'); }
  }
  function listText() {
    const lines = listItems().map(([p, q]) => `- ${p.title} x${q}: ${$inr(p.price * q)}${p.url ? '\n  ' + p.url : ''}`);
    return lines.join('\n');
  }
  // Pure serialisers for the filtered list, shared by the CSV/JSON buttons
  // and covered by the regression test.
  function serialise(list) {
    const rows = [['Title', 'Brand', 'Category', 'Price', 'MRP', 'Discount %', 'Saving', 'In stock', 'URL']].concat(list.map(p => [p.title, p.brand, p.cat, p.price, p.mrp, p.disc, p.save, p.inStock, p.url]));
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const json = JSON.stringify(list.map(p => ({ title: p.title, brand: p.brand, category: p.cat, price: p.price, mrp: p.mrp, discountPct: p.disc, saving: p.save, inStock: p.inStock, url: p.url })), null, 2);
    return { csv, json };
  }
  function downloadFile(name, text, type) {
    const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([text], { type })); a2.download = name; a2.click();
  }
  // Add products from any source (scan, passive capture) with price-history flags.
  function ingest(items) {
    let fresh = 0;
    for (const p of items) {
      if (!allowed(p) || S.products.has(p.id)) continue;
      const prev = store.prices[p.id];
      p.isNew = prev == null; p.was = prev != null && prev > p.price ? prev : 0;
      p.unit = unitOf(p.pack) || unitOf(p.title);
      const hs = store.hist[p.id];
      if (hs && hs.length) {
        const ps = hs.map(x => x[1]), lo = Math.min(...ps), hi = Math.max(...ps);
        p.low = Math.min(lo, p.price); p.lowEver = p.price < lo || (p.price === lo && hi > lo);
      }
      S.products.set(p.id, p); fresh++;
    }
    return fresh;
  }

  // ───────────────────────── Telegram alerts ─────────────────────────
  store.tg = Object.assign({ on: false, token: '', chat: '', minDisc: 60, drops: true, watch: true }, store.tg || {});
  store.sent = store.sent || {};
  const tgReady = () => !!(store.tg.token && store.tg.chat);
  async function tgSend(text) {
    const url = 'https://api.telegram.org/bot' + store.tg.token + '/sendMessage';
    // Form encoding keeps this a simple request: a JSON body triggers a CORS preflight that Telegram does not answer.
    const data = new URLSearchParams({ chat_id: store.tg.chat, text, parse_mode: 'HTML', disable_web_page_preview: 'true' }).toString();
    // Userscript: GM_xmlhttpRequest is not limited by the shop's Content-Security-Policy.
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((res, rej) => GM_xmlhttpRequest({
        method: 'POST', url, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data,
        onload: r => { let j = {}; try { j = JSON.parse(r.responseText); } catch (e) { /* ignore */ } if (r.status === 200) res(); else rej(new Error(j.description || 'HTTP ' + r.status)); },
        onerror: () => rej(new Error('network error'))
      }));
    }
    let r;
    try { r = await W.fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: data }); }
    catch (e) { throw new Error('this site blocks direct requests to Telegram. Use the userscript version for alerts.'); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.description || 'HTTP ' + r.status); }
  }
  const tgLine = p => `<b>${p.disc}% off</b> · ${esc(p.title.slice(0, 90))}\n${$inr(p.price)} <s>${$inr(p.mrp)}</s>${p.was ? ' · was ' + $inr(p.was) : ''}${p.url ? `\n<a href="${esc(p.url)}">Open on ${esc(PLATFORM)}</a>` : ''}`;
  async function notify() {
    if (OFFSITE || !store.tg.on || !tgReady()) return;
    const fav = new Set(store.favs), out = [];
    S.products.forEach(p => {
      if (!p.inStock) return;
      const hit = p.disc >= store.tg.minDisc || (store.tg.drops && p.was) || (store.tg.watch && fav.has(p.id) && (p.was || store.favAt[p.id] > p.price));
      const last = store.sent[p.id];
      if (hit && (last == null || p.price < last)) out.push(p);
    });
    if (!out.length) return;
    out.sort(SORTS.score[1]);
    const top = out.slice(0, 12);
    const head = `<b>PriceDrop Hunter · ${esc(PLATFORM)}</b>\n${out.length} new deal${out.length > 1 ? 's' : ''}${out.length > top.length ? ', best ' + top.length + ' below' : ''}`;
    try {
      await tgSend(head + '\n\n' + top.map(tgLine).join('\n\n'));
      top.forEach(p => { store.sent[p.id] = p.price; });
      const ks = Object.keys(store.sent); if (ks.length > 4000) ks.slice(0, ks.length - 4000).forEach(k => delete store.sent[k]);
      save(); toast(`Sent ${top.length} deal${top.length > 1 ? 's' : ''} to Telegram`);
    } catch (e) { toast('Telegram: ' + e.message); }
  }
  const notifySoon = debounce(() => notify(), 4000);
  async function tgTest() {
    if (!tgReady()) { S.tgm = true; render(); toast('Paste your bot token and chat ID first'); return; }
    try { await tgSend(`<b>PriceDrop Hunter</b> is connected for ${esc(PLATFORM)}.\nDeals from ${store.tg.minDisc}% off will arrive here.`); toast('Test message sent. Check Telegram.'); }
    catch (e) { toast('Telegram: ' + e.message); }
  }
  // ───────────────────────── Events ─────────────────────────
  const reFilter = debounce(() => { S.shown = 60; render(); }, 150);
  root.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.in; if (!k) return;
    if (k === 'q') { S.q = e.target.value; reFilter(); return; }
    if (P.locInput(k, e.target.value)) return;
    if (k === 'tgToken' || k === 'tgChat') { store.tg[k === 'tgToken' ? 'token' : 'chat'] = e.target.value.trim(); save(); return; }
    if (k === 'tgMin') { store.tg.minDisc = +e.target.value; save(); const b = root.getElementById('tgminv'); if (b) b.textContent = store.tg.minDisc + '% off'; return; }
  });
  root.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.in; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'tgOn' || k === 'tgDrops' || k === 'tgWatch') {
      store.tg[{ tgOn: 'on', tgDrops: 'drops', tgWatch: 'watch' }[k]] = v; save(); render();
      if (k === 'tgOn' && v && !tgReady()) toast('Add your bot token and chat ID too');
      return;
    }
    if (k === 'depth' || k === 'minDisc' || k === 'maxPrice') { store[k] = +v; save(); }
    else if (k === 'stock' || k === 'sort') { store[k] = v; save(); }
    else if (k === 'favOnly') S.favOnly = v; else if (k === 'newOnly') S.newOnly = v;
    else if (['cat', 'brand', 'pack', 'unit', 'priceBand'].includes(k)) S[k] = v;
    else return;
    S.shown = 60; render();
  });
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, id = el.dataset.id;
    store._cache = store._cache || {};
    switch (a) {
      case 'close': api.hide(); break;
      case 'theme': store.theme = app.classList.contains('dark') ? 'light' : 'dark'; save(); render(); break;
      case 'side': sideOpen = !sideOpen; render(); break;
      case 'panel': S.panel = !S.panel; render(); break;
      case 'closepanel': S.panel = false; render(); break;
      case 'grp': store.groups = store.groups.includes(id) ? store.groups.filter(x => x !== id) : store.groups.concat(id); save(); render(); break;
      case 'all': store.groups = GROUPS.map(g => g.id); save(); render(); break;
      case 'none': store.groups = []; save(); render(); break;
      case 'scan': openPicker(); break;
      case 'pstart': if (!store.groups.length) { toast('Pick at least one category'); break; } S.pick = false; render(); scan(); break;
      case 'pclose': S.pick = false; render(); break;
      case 'stop': stopScan(); toast('Stopping…'); break;
      case 'autoscroll': if (typeof autoScroll === 'function') autoScroll(); break;
      case 'tgtest': tgTest(); break;
      case 'bell': case 'tgopen': sideOpen = false; S.pick = false; S.tgm = true; render(); break;
      case 'tgclose': S.tgm = false; render(); break;
      case 'view': store.view = el.dataset.v; save(); render(); break;
      case 'more': S.shown += 60; render(); break;
      case 'fav':
        if (store.favs.includes(id)) { store.favs = store.favs.filter(x => x !== id); delete store.favAt[id]; }
        else { store.favs = store.favs.concat(id); const p = S.products.get(id); if (p) store.favAt[id] = p.price; }
        save(); render(); break;
      case 'discount': store.minDisc = +id; save(); S.shown = 60; render(); break;
      case 'preset': S.preset = S.preset === id ? '' : id; S.shown = 60; render(); break;
      case 'resetfilters':
        Object.assign(S, { q: '', cat: '', brand: '', pack: '', unit: '', priceBand: '', preset: '', favOnly: false, newOnly: false, shown: 60 });
        Object.assign(store, { minDisc: 0, maxPrice: 0, stock: '' });
        save(); render(); break;
      case 'tab': S.tab = el.dataset.v; S.shown = 60; render(); { const m = root.getElementById('main'); if (m) m.scrollTop = 0; } break;
      case 'seeall': S.tab = 'all'; S.cat = id; S.shown = 60; render(); { const m = root.getElementById('main'); if (m) m.scrollTop = 0; } break;
      case 'hide': store.hidden.push(id); save(); render(); toast('Hidden — undo via Data › Unhide'); break;
      case 'unhide': store.hidden = []; save(); render(); break;
      case 'add': store.list[id] = (store.list[id] || 0) + 1; { const p = S.products.get(id); if (p) store._cache[id] = p; } save(); render(); break;
      case 'inc': store.list[id]++; save(); render(); break;
      case 'dec': if (--store.list[id] <= 0) delete store.list[id]; save(); render(); break;
      case 'clearlist': store.list = {}; save(); render(); break;
      case 'copylist': copy(listText() || 'Empty list', 'List copied'); break;
      case 'openlinks': openListLinks(); break;
      case 'copyall': copy(filtered().slice(0, 20).map(p => `${p.disc}% off · ${p.title} · ${$inr(p.price)} (MRP ${$inr(p.mrp)})${p.url ? '\n' + p.url : ''}`).join('\n'), 'Top 20 deals copied'); break;
      case 'csv': { const s2 = serialise(filtered()); downloadFile('bigbasket-deals.csv', s2.csv, 'text/csv'); toast('CSV downloaded'); break; }
      case 'json': { const s2 = serialise(filtered()); downloadFile('bigbasket-deals.json', s2.json, 'application/json'); toast('JSON downloaded'); break; }
      case 'selftest': { S.selfTest = selfTest(); render(); toast(S.selfTest.pass ? `Self-test PASS: ${S.selfTest.got}/${S.selfTest.total} sample products parsed` : `Self-test FAIL: ${S.selfTest.got}/${S.selfTest.total} parsed`); break; }
    }
  });
  document.addEventListener('keydown', e => {
    if (host.style.display === 'none') return;
    const typing = root.activeElement && /INPUT|SELECT/.test(root.activeElement.tagName);
    if (e.key === 'Escape' && (S.pick || S.tgm || sideOpen)) { S.pick = false; S.tgm = false; sideOpen = false; render(); }
    else if (e.key === 'Escape') { if (S.panel) { S.panel = false; render(); } else if (typing) root.activeElement.blur(); else api.hide(); }
    else if (!typing && !e.metaKey && !e.ctrlKey) {
      if (e.key === '/') { e.preventDefault(); const i = root.querySelector('[data-in=q]'); i && i.focus(); }
      else if (e.key.toLowerCase() === 's') S.scanning ? stopScan() : openPicker();
    }
    if (!typing || e.key === 'Escape') e.stopPropagation();
  }, true);

  // ───────────────────────── Public API ─────────────────────────
  let prevOverflow = '';
  // Floating button left on the store page while the panel is closed (drag it up or down).
  const HD = (CSS.match(/--hd:(#[0-9a-f]{3,8})/i) || [])[1] || '#2874f0';
  const fab = document.createElement('div');
  fab.style.cssText = 'all:initial;position:fixed;z-index:2147483646;right:14px;display:none';
  const fabRoot = fab.attachShadow({ mode: 'open' });
  fabRoot.innerHTML = `<style>
.f{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:9px;padding:7px 15px 7px 7px;border-radius:999px;background:${HD};color:#fff;font:800 15px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.28),0 0 0 2px rgba(255,255,255,.9);user-select:none;-webkit-user-select:none;touch-action:none;transition:transform .15s}
.f:hover{transform:translateY(-2px)}.f.drag{cursor:grabbing;transform:scale(1.04)}
.mk{width:34px;height:34px;border-radius:50%;background:#ffd43b;color:#111;display:grid;place-items:center}
.n{background:#ffd43b;color:#111;border-radius:99px;padding:3px 8px;font-size:12px}.n:empty{display:none}
.x{all:unset;position:absolute;top:-7px;left:-7px;width:20px;height:20px;border-radius:50%;background:#111;color:#fff;display:grid;place-items:center;font:700 12px/1 sans-serif;cursor:pointer;opacity:.85}
.x:hover{opacity:1}
</style><div style="position:relative"><button class="f" title="Open PriceDrop Hunter · drag to move"><span class="mk"><svg viewBox="0 0 16 16" width="18" height="18"><path d="M8 2.5v8M4.5 7.2 8 11l3.5-3.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13.8h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>Deals<span class="n"></span></button><button class="x" title="Hide this button on this page" aria-label="Hide">×</button></div>`;
  const fabBtn = fabRoot.querySelector('.f');
  const placeFab = () => { fab.style.bottom = Math.max(8, Math.min(window.innerHeight - 64, +store.fabY || 24)) + 'px'; };
  let drag = null;
  fabBtn.addEventListener('pointerdown', e => { drag = { y: e.clientY, b: parseFloat(fab.style.bottom) || 24, moved: false }; try { fabBtn.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ } });
  fabBtn.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 5) { drag.moved = true; fabBtn.classList.add('drag'); }
    if (drag.moved) { store.fabY = drag.b - dy; placeFab(); }
  });
  fabBtn.addEventListener('pointerup', () => {
    const moved = drag && drag.moved; drag = null; fabBtn.classList.remove('drag');
    if (moved) save(); else api.show();
  });
  fabRoot.querySelector('.x').addEventListener('click', () => { fab.remove(); });
  function updateFab() {
    const n = S.products.size ? filtered().length : 0;
    fabRoot.querySelector('.n').textContent = n ? String(n) : '';
  }
  const api = {
    show() { fab.style.display = 'none'; host.style.display = 'block'; if (!OFFSITE && !S.scanning && !S.products.size && typeof captureUI !== 'function') setTimeout(openPicker, 300); prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; render(); },
    hide() { host.style.display = 'none'; document.documentElement.style.overflow = prevOverflow; updateFab(); placeFab(); fab.style.display = 'block'; },
    toggle() { host.style.display === 'none' ? api.show() : api.hide(); }
  };
  window.__BBD__ = api;
  document.body.appendChild(host);
  document.body.appendChild(fab);
  api.show();
  if (typeof P !== 'undefined' && P.install && !OFFSITE) P.install(ingest);
})();
