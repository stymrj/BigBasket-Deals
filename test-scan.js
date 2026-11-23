// Offline regression tests for the browser scanner and the bot feed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { run } = require('./bot/core');
const platform = require('./bot/platform');

const src = fs.readFileSync(path.join(__dirname, 'src', 'deals.js'), 'utf8');
const response = (status, products = [], headers = {}) => new Response(JSON.stringify({ products }), { status, headers });
const product = (id, offer) => ({
  id, desc: 'Test product',
  pricing: { discount: { mrp: { value: 0 }, prim_price: { mrp: 100, tracking: { mrp: 100 } } }, offer_price: { value: offer } }
});

function browser(fetch, onDelay = () => {}, minDisc = 10) {
  const toasts = [];
  const noop = () => {};
  const scanner = src.slice(src.indexOf('  const $inr ='), src.indexOf('  // ───────────────────────── Filtering'));
  const api = vm.runInNewContext(scanner + '; store.tg = { on: false }; ({ scan, stopScan, S })', {
    W: { fetch }, window: {}, AbortController, clearTimeout,
    setTimeout(fn, ms) {
      onDelay(ms);
      return setTimeout(fn, ms === 15000 ? ms : 0);
    },
    localStorage: { getItem: () => JSON.stringify({ v: 4, groups: ['fresh'], minDisc, depth: 3 }), setItem: noop },
    location: { hostname: 'www.bigbasket.com' },
    render: noop, scheduleRender: noop, recordPrices: noop, notify: noop,
    toast: msg => toasts.push(msg), ingest: items => items.forEach(p => api.S.products.set(p.id, p))
  });
  return { ...api, toasts };
}

async function feed(fetch) {
  const settings = { BIGBASKET_COOKIE: 'mock-cookie', GROUPS: 'fresh', PAGES: '3', MIN_DISCOUNT: '', THRESHOLDS: 'fresh=60' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  const log = console.log, error = console.error;
  const lines = [], waits = [];
  try {
    Object.assign(process.env, settings);
    console.log = console.error = line => lines.push(line);
    const code = await run({
      ...platform,
      fetchPage(job, page, ctx) {
        return platform.fetchPage(job, page, { ...ctx, fetch, sleep: async ms => { waits.push(ms); } });
      }
    }, ['--json']);
    const json = lines.find(line => line.startsWith('{'));
    return { code, json: json && JSON.parse(json), waits };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    console.log = log; console.error = error;
  }
}

test('browser recovers after HTTP 403 and pages at the selected cutoff', async () => {
  const requests = [];
  const { scan, S, toasts } = browser(async url => {
    const page = new URL(url).searchParams.get('page');
    requests.push(page);
    if (requests.length === 1) return response(403);
    return response(200, [product(page, page === '1' ? 85 : 95)]);
  });
  await scan();
  assert.match(toasts.at(-1), /BigBasket blocked/);
  await scan();
  assert.deepEqual(requests, ['1', '1', '2']);
  assert.equal(S.products.get('1').price, 85);
  assert.equal(S.products.get('1').disc, 15);
});

test('browser continues paging when a variant meets the cutoff but the parent does not', async () => {
  const requests = [];
  const fixture = require('./fixtures/sample-high-discount.json');
  const { scan, S } = browser(async url => {
    const page = new URL(url).searchParams.get('page');
    requests.push(page);
    if (page === '1') return new Response(JSON.stringify(fixture));
    return response(200, page === '2' ? [{ ...product('parent', 40), children: [product('variant', 5)] }] : []);
  }, undefined, 90);
  await scan();
  assert.deepEqual(requests, ['1', '2', '3']);
  assert.equal(S.products.get('variant').disc, 95);
});

test('Stop aborts the browser listing request and retry wait', async () => {
  let signal;
  const scanning = browser((url, options) => new Promise((resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    scanning.stopScan();
  }));
  await scanning.scan();
  assert.equal(signal.aborted, true);
  assert.equal(scanning.toasts.at(-1), 'Scan stopped');

  let requests = 0;
  const backoff = browser(async () => {
    requests++;
    return response(429, [], { 'retry-after': '5' });
  }, ms => { if (ms === 5000) queueMicrotask(() => backoff.stopScan()); });
  await backoff.scan();
  assert.equal(requests, 1);
  assert.equal(backoff.toasts.at(-1), 'Scan stopped');
});

test('bot feed rejects HTTP 500 and 403 but accepts a valid empty listing', async () => {
  for (const status of [500, 403]) {
    const result = await feed(async () => response(status));
    assert.equal(result.code, 1);
    assert.equal(result.json, undefined);
  }
  const result = await feed(async () => response(200));
  assert.equal(result.code, 0);
  assert.deepEqual(result.json.deals, []);
});

test('bot feed retries rate limits, parses fallback prices and uses its own paging cutoff', async () => {
  const requests = [];
  const result = await feed(async (url, { signal }) => {
    const page = new URL(url).searchParams.get('page');
    assert.ok(signal instanceof AbortSignal);
    requests.push(page);
    if (requests.length === 1) return response(429, [], { 'retry-after': '2' });
    if (requests.length === 2) return response(503, [], { 'retry-after': 'Thu, 01 Jan 1970 00:00:00 GMT' });
    return response(200, Array.from({ length: 20 }, (_, i) => product(page + '-' + i, page === '1' ? 45 : 55)));
  });
  assert.equal(result.code, 0);
  assert.deepEqual(requests, ['1', '1', '1', '2']);
  assert.deepEqual(result.waits.slice(1, 3), [2000, 0]);
  assert.equal(result.json.deals.length, 20);
  assert.ok(result.json.deals.every(p => p.price === 45 && p.disc === 55));
});

test('bot feed does not retry before a long Retry-After has elapsed', async () => {
  let requests = 0;
  const result = await feed(async () => {
    requests++;
    return response(429, [], { 'retry-after': '60' });
  });
  assert.equal(result.code, 1);
  assert.equal(result.json, undefined);
  assert.equal(requests, 1);
  assert.equal(result.waits.length, 1);
});
