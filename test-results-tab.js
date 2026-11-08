// Regression test: sample listing-svc payload -> parser -> real card() render.
// Fixture (7 top-level products, one with 2 child variants) must parse to
// 9 products and render 9 cards in the results grid.
// Also covers: self-test, CSV/JSON serialise, multi-keyword search,
// generic-walk fallback for unfamiliar nesting.
// Usage: node test-results-tab.js   (paths are relative to this file)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src', 'deals.js'), 'utf8');

// Stubs for the helpers card() needs (unit price is not set by extract, so
// unitLabel is never called here; spark/ic are stubbed the same way).
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const ic = () => '';
const spark = () => '';

function slice(startMark, endMark, name) {
  const a = src.indexOf(startMark), b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error('could not find ' + name + ' in src/deals.js');
  return src.slice(a, b);
}
// Parser slice: price -> fetchPage (covers normalise, walkProducts,
// SELFTEST + selfTest, extract). serialise slice and matchQuery slice likewise.
eval(slice('  const price = ', '  async function fetchPage', 'parser'));
eval(slice('  function card(p, fav, qtyMap) {', '  const byDisc = ', 'card'));
eval(slice('  function listText() {', '  // Add products from any source', 'serialise'));
eval(slice('  // Comma separates OR groups', '  function filtered() {', 'matchQuery'));

let failures = 0;
const check = (label, ok, extra) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra !== undefined ? ' — ' + extra : ''));
  if (!ok) failures++;
};

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-api.json'), 'utf8'));
const items = extract(fixture, 'Test');
check('parser returns 9 products (7 + 2 child variants)', items.length === 9, 'got ' + items.length);
check('every product has title/price/mrp/url', items.every(p => p.title && p.price > 0 && p.mrp >= p.price && /^https:\/\/www\.bigbasket\.com/.test(p.url)));
const byTitle = t => items.find(p => p.title === t);
check('child variants parsed on their own (not merged/dropped)', items.filter(p => /Fortune Oil/.test(p.title)).length === 3);
check('nested availability.button_state marks out-of-stock', byTitle('Test OOS Dal · 1 kg') && byTitle('Test OOS Dal · 1 kg').inStock === false);
check('avail_status 002 marks out-of-stock', byTitle('Test Gone Sugar · 1 kg') && byTitle('Test Gone Sugar · 1 kg').inStock === false);
check('missing image falls back to placeholder', byTitle('Test No Image Rice · 5 kg') && byTitle('Test No Image Rice · 5 kg').img === 'https://www.bigbasket.com/static/images/default.jpg');
check('missing id falls back to title|price', items.some(p => p.id === 'Test No ID Product|50'));
check('zero selling price falls back to MRP', byTitle('Test Zero SP Milk · 1 L') && byTitle('Test Zero SP Milk · 1 L').price === 90);
check('out-of-stock items flagged, not dropped', items.filter(p => !p.inStock).length === 2);
check('tail discount recorded', items.tailDisc === items[items.length - 1].disc && items.totalFound === 9, 'tailDisc=' + items.tailDisc);

// Fallback: products nested under an unfamiliar key (no tabs/product_info).
const oddShape = { data: { list: { entries: [{ id: 301, desc: 'Test Fallback Dal', w: '1 kg', pricing: { discount: { mrp: 110, prim_price: { sp: 55 } } }, absolute_url: '/pd/301', availability: { avail_status: '001' } }] } } };
check('generic-walk fallback parses unfamiliar nesting', extract(oddShape, 'Test').length === 1);

// Render: the real card() must emit one <article class="card" per product.
const gridHtml = items.map(p => card(p, false, {})).join('');
const cards = (gridHtml.match(/<article class="card/g) || []).length;
console.log('Cards rendered:', cards);
check('cards rendered equals input count', cards === 9, cards + ' of 9');
check('card shows first title', gridHtml.includes('Test Tata Salt'));
check('card shows discount badge', gridHtml.includes('50% OFF'));
check('card shows price', gridHtml.includes('₹60'));

// Self-test button path (same function the sidebar calls).
const st = selfTest();
console.log('selfTest():', JSON.stringify(st));
check('self-test passes', st.pass && st.got === 3 && st.total === 3);

// Export serialisers.
const s2 = serialise(items);
check('CSV has header + 9 rows', s2.csv.split('\n').length === 10);
check('JSON parses to 9 objects', JSON.parse(s2.json).length === 9);
check('JSON keeps discount field', JSON.parse(s2.json)[0].discountPct === items[0].disc);

// Multi-keyword search: comma = OR, spaces = AND inside a group.
const salt = { title: 'Test Tata Salt · 1 kg', cat: 'Staples' };
check('search: single word matches', matchQuery(salt, 'salt') === true);
check('search: comma is OR', matchQuery(salt, 'rice, salt') === true);
check('search: spaces are AND', matchQuery(salt, 'salt rice') === false);
check('search: empty query matches all', matchQuery(salt, '') === true);

if (failures) { console.log('FAIL: ' + failures + ' check(s) failed'); process.exit(1); }
console.log('PASS: all 9 cards render');
