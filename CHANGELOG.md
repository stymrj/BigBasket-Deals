# Changelog

## v2.0.0 — 2026-11-08
- Fixed (2026-11-09): install button now reads “BigBasket Deals” instead of the generic “PriceDrop Hunter”, so the dragged bookmark is named after this store instead of colliding with every other tool.
- Fixed (2026-11-09): highest-discount products were missed — the paging signal read the last item's discount, and a low-discount child variant trailing page 1 stopped the scan, so page 2 was never fetched; it now reads the lowest discount among top-level products. Also: object-wrapped MRP/selling prices are now read (they parsed as 0, so the item vanished or lost its discount), and the selling price and MRP are also read from a bare `prim_price` number and from `prim_price.mrp`. Same fixes mirrored in `bot/platform.js`, and the bot's early-stop now uses the same tail discount in `bot/core.js`. No version bump (stays 2.0.0).
- Fixed (2026-11-09): bot coverage — `bot/config.json` covered only 7 groups / 17 slugs while the browser tool covers 9 groups / 21; added Bakery, Cakes & Dairy (dairy), Kitchen, Garden & Pets (home), and the Eggs, Meat & Fish and Gourmet groups, so the bot now scans all 21 slugs. Install-page and README corrections — the desktop install step named the drag button "PriceDrop Hunter" (it reads "BigBasket Deals"); the "14 categories" stat is 21; the Telegram step named the button "Send test message" (it reads "Send test"); there is no short mobile loader for BigBasket (the loader is the full bookmarklet, about 60 KB, not about 380 characters / 45 KB) — the mobile panel, copy button and README now say so. Telegram bot: a run with no token/chat ID now exits 1 instead of passing silently; the workflow schedule comment now states both UTC and IST and notes GitHub-hosted runners are usually blocked (HTTP 403). No version bump (stays 2.0.0).

- Strict stock rules: `avail_status` `'001'` means in stock and anything else
  present means out of stock, plus `availability.button_state`,
  `not_for_sale` and inventory flags. Stock shown before v2 was too optimistic.
- Child variants are parsed on their own instead of being merged into the
  parent (which gave them the parent id and let dedupe drop them).
- Fallbacks instead of blank cards: title from the URL slug, id from
  title + price, image placeholder, selling price falling back to MRP.
- Generic-walk fallback parses products nested under unfamiliar response keys.
- Tail-discount paging: page 2 is fetched only while the previous page still
  ends on a 20%+ discount. Depth default 1 → 2 pages per category.
- One stable `x-tracker` id per browser session (was a fresh random id per request).
- Slower pace between listing requests: 2–2.5 s (was under 2 s).
- Empty-state diagnostics: an empty scan now reports why (blocked 403, signed
  out, rate-limited, empty categories) instead of a blank page.
- In-browser Self-test button (sidebar) runs the parser on a built-in sample
  listing payload and reports PASS/FAIL.
- 7 new category slugs (Dry Fruits, Chocolates & Candies, Skin Care, Hair
  Care, Bath & Hand Wash, Diapers & Wipes, Detergents & Dishwash); 21 in total.
- Multi-keyword search (comma = OR, spaces = AND) and JSON export alongside CSV.
- Bot: `bot/platform.js` mirrors the browser parser (strict stock, standalone
  variants, fallbacks, one tracker per run, tail-discount paging);
  `bot/config.json` gains the new slugs. No new tokens or secrets.
- UI shell (filters, saved items, price history, themes, CSV export) unchanged.

## v1.0.0 — 2026-10-25

- Initial PriceDrop Hunter release for BigBasket.
