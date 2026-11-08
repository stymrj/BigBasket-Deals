// BigBasket: the listing API the site uses, slowly, with your own session cookie.
// v2: strict stock rules, child variants parsed on their own, image/id fallbacks,
// one tracker per run, generic-walk fallback for unfamiliar payload shapes.
'use strict';
const crypto = require('crypto');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
let trackerVal = null;

const BB_IMG_FALLBACK = 'https://www.bigbasket.com/static/images/default.jpg';

const items0 = j => {
  if (!j) return [];
  if (Array.isArray(j.tabs)) for (const t of j.tabs) { const l = t && t.product_info && t.product_info.products; if (l && l.length) return l; }
  if (j.product_info && j.product_info.products) return j.product_info.products;
  return Array.isArray(j.products) ? j.products : [];
};
// Fallback when the listing payload nests products under an unfamiliar key.
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
function normalise(p, cat, { price, brandOf }) {
  const pr = p.pricing || {}, dsc = pr.discount || {};
  const mrp0 = price(dsc.mrp || pr.mrp || p.mrp);
  const sp = price((dsc.prim_price && dsc.prim_price.sp) || pr.offer_price || pr.sp || p.sp) || mrp0;
  const title = p.desc || p.p_desc || p.name || 'Product', w = p.w || p.pack_desc || '';
  if (!sp) return null;
  const mrp = mrp0 < sp ? sp : mrp0, av = p.availability || {}, u = p.absolute_url || '/pd/' + (p.id || '');
  const btn = String(av.button || av.button_state || p.button_state || '').toLowerCase();
  const inv = p.inv_info || p.inventory || {};
  const oos = av.is_available === false || av.not_for_sale === true ||
    (av.avail_status !== undefined && av.avail_status !== null && String(av.avail_status) !== '' && String(av.avail_status) !== '001') ||
    ['out_of_stock', 'not_available', 'coming_soon', 'notify me', 'sold out'].includes(btn) ||
    inv.is_out_of_stock === true || (inv.stock_status !== undefined && inv.stock_status !== null && ['000', '002'].includes(String(inv.stock_status)));
  const id = p.id != null ? String(p.id) : (String(title) + '|' + sp);
  return { id, title: String(title) + (w ? ' · ' + w : ''), brand: String((p.brand && p.brand.name) || p.p_brand || brandOf(title)), price: sp, mrp, disc: mrp > sp ? Math.round((mrp - sp) / mrp * 100) : 0, url: /^http/.test(u) ? u : 'https://www.bigbasket.com' + u, inStock: !oos, cat };
}
function extract(json, cat, ctx) {
  const out = [], seen = new Set();
  let items = items0(json);
  if (!items.length) items = walkProducts(json);
  for (const p of items) for (const c of [p].concat(p.children || [])) {
    const n = normalise(c, cat, ctx); // each variant parsed on its own, never merged into the parent
    if (n && !seen.has(n.id)) { seen.add(n.id); out.push(n); }
  }
  out.tailDisc = out.length ? out[out.length - 1].disc : 0;
  out.totalFound = out.length;
  out.more = out.tailDisc >= 20;
  return out;
}

module.exports = {
  label: 'BigBasket',
  required: ['BIGBASKET_COOKIE'],
  workers: 2,
  pageSize: 20,
  sortedByDiscount: true,
  async fetchPage(job, page, ctx) {
    const { env, fetch, sleep } = ctx;
    if (!trackerVal) trackerVal = crypto.randomUUID();
    await sleep(2000 + Math.random() * 500);
    const url = 'https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=' + encodeURIComponent(job.sub[0]) + '&page=' + page + '&sort=dphtl';
    for (let a = 0; a < 4; a++) {
      const r = await fetch(url, { headers: { accept: 'application/json', 'x-channel': 'BB-WEB', 'x-entry-context': 'bb-b2c', 'x-entry-context-id': '100', 'x-tracker': trackerVal, 'user-agent': UA, referer: 'https://www.bigbasket.com/', cookie: env.BIGBASKET_COOKIE } });
      if (r.status === 403) throw Object.assign(new Error('BigBasket blocked this machine (HTTP 403). GitHub-hosted runners are usually blocked; use a self-hosted runner and a fresh BIGBASKET_COOKIE (see README).'), { blocked: true });
      if (r.status === 429 || r.status === 503) { const ra = +r.headers.get('retry-after'); await sleep(ra > 0 ? ra * 1000 : 4000 * (a + 1)); continue; }
      if (!r.ok) return Object.assign([], { more: false, tailDisc: 0, totalFound: 0 });
      return extract(await r.json(), job.g.name + ' › ' + job.sub[1], ctx);
    }
    throw new Error('rate limited');
  }
};
