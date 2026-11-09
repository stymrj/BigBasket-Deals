# Changelog

## v2.0.0 — 2026-11-08
- Fixed (2026-11-09): install button now reads “BigBasket Deals” instead of the generic “PriceDrop Hunter”, so the dragged bookmark is named after this store instead of colliding with every other tool.

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
