// BigBasket: the listing API the site uses, slowly, with your own session cookie.
'use strict';
const crypto = require('crypto');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const items0 = j => {
  if (!j) return [];
  if (Array.isArray(j.tabs)) for (const t of j.tabs) { const l = t && t.product_info && t.product_info.products; if (l && l.length) return l; }
  if (j.product_info && j.product_info.products) return j.product_info.products;
  return Array.isArray(j.products) ? j.products : [];
};
function normalise(p, cat, { price, brandOf }) {
  const pr = p.pricing || {}, dsc = pr.discount || {};
  const mrp0 = price(dsc.mrp || pr.mrp || p.mrp);
  const sp = price((dsc.prim_price && dsc.prim_price.sp) || pr.offer_price || pr.sp || p.sp) || mrp0;
  const title = p.desc || p.p_desc || p.name, w = p.w || p.pack_desc || '';
  if (!title || !sp || p.id == null) return null;
  const mrp = mrp0 < sp ? sp : mrp0, av = p.availability || {}, u = p.absolute_url || '/pd/' + p.id;
  const oos = av.is_available === false || av.avail_status === '002' || av.avail_status === '000' || ['OUT_OF_STOCK', 'NOT_AVAILABLE', 'COMING_SOON'].includes(p.button_state);
  return { id: String(p.id), title: String(title) + (w ? ' · ' + w : ''), brand: String((p.brand && p.brand.name) || p.p_brand || brandOf(title)), price: sp, mrp, disc: mrp > sp ? Math.round((mrp - sp) / mrp * 100) : 0, url: /^http/.test(u) ? u : 'https://www.bigbasket.com' + u, inStock: !oos, cat };
}
function extract(json, cat, ctx) {
  const out = [], seen = new Set();
  for (const p of items0(json)) for (const c of [p].concat(p.children || [])) {
    const n = normalise(c === p ? p : Object.assign({}, p, c), cat, ctx);
    if (n && !seen.has(n.id)) { seen.add(n.id); out.push(n); }
  }
  return out;
}

module.exports = {
  label: 'BigBasket',
  required: ['BIGBASKET_COOKIE'],
  workers: 2,
  pageSize: 20,
  async fetchPage(job, page, ctx) {
    const { env, fetch, sleep } = ctx;
    await sleep(1500 + Math.random() * 1500);
    const url = 'https://www.bigbasket.com/listing-svc/v2/products?type=pc&slug=' + encodeURIComponent(job.sub[0]) + '&page=' + page + '&sort=dphtl';
    for (let a = 0; a < 4; a++) {
      const r = await fetch(url, { headers: { accept: 'application/json', 'x-channel': 'BB-WEB', 'x-entry-context': 'bb-b2c', 'x-entry-context-id': '100', 'x-tracker': crypto.randomUUID(), 'user-agent': UA, referer: 'https://www.bigbasket.com/', cookie: env.BIGBASKET_COOKIE } });
      if (r.status === 403) throw Object.assign(new Error('BigBasket blocked this machine (HTTP 403). GitHub-hosted runners are usually blocked; use a self-hosted runner and a fresh BIGBASKET_COOKIE (see README).'), { blocked: true });
      if (r.status === 429 || r.status === 503) { const ra = +r.headers.get('retry-after'); await sleep(ra > 0 ? ra * 1000 : 4000 * (a + 1)); continue; }
      if (!r.ok) return [];
      return extract(await r.json(), job.g.name + ' › ' + job.sub[1], ctx);
    }
    throw new Error('rate limited');
  }
};
