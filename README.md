# PriceDrop Hunter for BigBasket

Scans BigBasket categories through its listing API, ranks products by real savings, and tracks price changes between scans. It runs in your own browser as a bookmarklet or userscript. Nothing is uploaded and there is no account.

**Live page:** https://stymrj.github.io/BigBasket-Deals/

## Features

- Ranks by percent off and rupees saved together
- Labels products that are new or cheaper than your last scan
- Filters: search, category, brand, maximum price, minimum discount, stock, saved items
- Shopping list with quantities, total and total savings
- CSV export and copy-to-share text
- Grid and list views, light and dark themes, keyboard shortcuts
- Settings, saved items and price history stay in your browser

## Install

**Bookmarklet (desktop).** Run `node build.js`, open `index.html`, and drag the button to your bookmarks bar. Open bigbasket.com and click the bookmark.

**Bookmarklet (mobile).** Copy the code from the page, create a bookmark, and paste the code as its address. Run it from the address bar on bigbasket.com.

**Userscript.** Install `dist/bigbasket-deals.user.js` in Tampermonkey or Violentmonkey. A small Deals button appears on every bigbasket.com page.

**Demo.** Use "Try the demo" on the install page to explore the interface with sample data.

## Keyboard shortcuts

`/` search, `S` scan or stop, `Esc` close.

## How it gets data

Calls `listing-svc/v2/products` with the same headers the BigBasket site sends, from your logged-in session. It scans slowly (two workers, randomised delays) to avoid rate limits, honours `Retry-After`, and stops if BigBasket returns 403.

## Limitations

- Only five category slugs are confirmed (`dairy`, `biscuits-cookies`, `foodgrains-oil-masala`, `edible-oils-ghee`, `beverages`); the rest are likely guesses.
- One page per category is fetched by default; depth is limited to keep the request rate low.
- The endpoint is undocumented and can change.

## Project layout

```
src/deals.js         the app (one file, no dependencies)
src/index.tpl.html   install page template
build.js             builds dist/ and index.html
favicon.svg
```

Run `node build.js` after any change.

---

Made with ♥ by [Satyam Raj](https://www.linkedin.com/in/satyamraj1)
