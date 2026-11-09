# PriceDrop Hunter for BigBasket

Scans the BigBasket categories you pick through its listing API and shows the biggest discounts, then the best deals of each category. It runs in your own browser as a bookmarklet or userscript. Nothing is uploaded and there is no account.

**Live page:** https://stymrj.github.io/BigBasket-Deals/

## What's new in v2 (2026-11-08)

- **Strict stock rules:** `avail_status` is now read properly — `'001'` means in stock, anything else present means out of stock — plus `availability.button_state`, `not_for_sale` and inventory flags. Stock shown before v2 was too optimistic.
- **Child variants parsed on their own:** pack variants used to be merged into the parent product, inherit its id, and get silently dropped by dedupe. Each variant is now parsed separately, so a parent with two variants yields three products.
- **Fallbacks instead of blank cards:** a product with no title keeps a title from its URL slug, a missing id falls back to title + price, a missing image falls back to the store placeholder, and a zero selling price falls back to the MRP.
- **Unfamiliar payload shapes:** if the listing response nests products under a key the parser doesn't know, a generic walk finds product-shaped objects instead of returning nothing.
- **Tail-discount paging:** pages are discount-sorted, so page 2 is fetched only while the previous page still ends on a discount worth showing (20%+). Depth is now 2 pages per category by default (was 1).
- **Highest-discount fix (2026-11-09):** the page-end discount that decides whether page 2 is fetched is now the lowest discount among top-level products — a low-discount child variant trailing the page used to stop the scan after page 1. Prices wrapped in objects (e.g. `mrp: {value: ...}`) are now read instead of parsing as 0, and the selling price and MRP are also read from a bare `prim_price` number and from `prim_price.mrp`.
- **One tracker per session:** the `x-tracker` header used to be a fresh random id on every request; it is now one stable id per browser session.
- **Slower, steadier pace:** 2–2.5 seconds between listing requests (was under 2s), to stay under the rate limit that returns 403.
- **Empty-state diagnostics:** a scan that finds nothing now says why — blocked (403), signed out, rate-limited, or categories that returned no products — instead of a blank page.
- **Self-test button:** the sidebar has a Self-test that runs the parser on a built-in sample listing payload and reports PASS/FAIL. Run it any time the results look wrong.
- **7 new category slugs:** Dry Fruits, Chocolates & Candies, Skin Care, Hair Care, Bath & Hand Wash, Diapers & Wipes, Detergents & Dishwash — 21 slugs in total.
- **Multi-keyword search:** comma separates OR groups, spaces inside a group are AND — `atta, rice` finds either; `atta 1kg` needs both words.
- **JSON export** alongside CSV, from the same filtered list.
- **Bookmark name fixed:** the install button now reads **BigBasket Deals** instead of the generic “PriceDrop Hunter”, so the bookmark you drag to your bookmarks bar is named after this store.

## Why v2 is stronger

- **Price history, lowest-ever and price-drop alerts** — every scan is compared with the prices stored in your browser, and the Telegram bot keeps the same history server-side in `data/state.json` (30 days), so drops and restocks are caught, not just today's deals.
- **Saved items with sparklines** — heart any deal and its price is tracked; the card shows a low/high sparkline and how much it dropped since you saved it.
- **Cross-category best-deal row** — the top 12 discounts across everything you scanned, plus the best of each category in swipeable rows.
- **Unit-price / value sort** — rupees per kg, litre or piece, read from the pack size, with a best-value sort.
- **Telegram bot with dedupe + price history** — the bot sends each deal once, then again only if it gets cheaper or comes back in stock; scheduled runs every 30 minutes.
- **CSV and JSON export** of the filtered list, and a shopping list with totals and savings.

## Features

- Asks which categories to scan, then shows the biggest discounts first
- Best deals of each category in one swipeable row, with See all
- Ranks by percent off and rupees saved together
- Labels products that are new, cheaper than last time, or at their lowest price ever
- Price history sparkline on every product you have seen before
- Saved items strip showing how much each one dropped since you saved it
- Unit price (per kg, litre or piece) with a value sort
- One-tap presets: under ₹99, 50% off, save ₹100+, price drops, lowest ever, best value
- A setup checklist on first open, plus a "Why 0 results" box after an empty scan
- Filters: search, category, brand, maximum price, minimum discount, stock, saved items
- Shopping list with quantities, total and total savings
- CSV and JSON export, copy-to-share text, grid/list views, light and dark themes
- Settings, saved items and price history stay in your browser

## Install

![Install walkthrough](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.gif)

[Watch the walkthrough video (MP4)](https://stymrj.github.io/PriceDrop-Hunter/media/install-demo.mp4)

**Bookmarklet (desktop).** Run `node build.js`, open `index.html`, and drag the **BigBasket Deals** button to your bookmarks bar. Open bigbasket.com and click the bookmark.

**Bookmarklet (mobile).** On the install page, tap **Copy mobile loader**. It is a bookmark of about 380 characters that loads the latest version from GitHub Pages, so it fits on any phone. Create a bookmark named **BigBasket Deals**, paste it as the address, and run it from the address bar on bigbasket.com. The full bookmarklet (about 45 KB, no network needed) is in `dist/bookmarklet.txt`.

**Userscript.** Install `dist/bigbasket-deals.user.js` in Tampermonkey or Violentmonkey. A small Deals button appears on every bigbasket.com page.

## Use

1. Open bigbasket.com and click the bookmark (or the Deals button).
2. Press **Scan**, pick categories, and set pages per category (1–5).
3. Browse Best deals, All deals, or Saved. Heart items to track them, add them to the shopping list, or export CSV/JSON.
4. If a scan returns nothing, read the **Why 0 results** box — it names the cause. If results look wrong, press **Self-test** in the sidebar: it parses a built-in sample and reports PASS/FAIL. Shortcuts: `/` search, `S` scan, `Esc` close.

## Telegram alerts

Hunter can send new deals, price drops and cheaper saved items to your Telegram.

1. In Telegram, open `@BotFather`, send `/newbot`, and copy the bot token.
2. Open your new bot and press **Start**.
3. Get your chat ID from `@userinfobot`, or open `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id`.
4. On the store, open Hunter, press **Telegram** in the top bar, paste the token and chat ID, press **Send test**, then switch alerts on.

Each deal is sent once, and again only if its price drops further. Use the userscript for alerts: some shops block bookmarklets from calling Telegram, while the userscript sends through `GM_xmlhttpRequest`. The token is stored only in your browser.

## Telegram bot (GitHub Actions)

Hunter can also run on its own, without a browser, on GitHub Actions. Every 30 minutes it scans BigBasket, compares with the previous run, and sends what changed to Telegram. The bot keeps a price history in `data/state.json`, so it reports new deals, price drops and restocks — and stays silent when nothing changed.

| | Browser tool | Telegram bot |
| :--- | :--- | :--- |
| Runs | In your browser tab | On GitHub Actions (free for public repos) |
| When | Each time you press Scan and pick categories | Every 30 minutes, 08:31 to 00:01 IST |
| Uses | Your open BigBasket session | A copy of your session stored as a GitHub secret |
| Alerts | New deals, price drops, saved items | New deals, price drops, back in stock, a morning catalogue |

### Step 1: Copy the repository

Click **Fork** at the top of [github.com/stymrj/BigBasket-Deals](https://github.com/stymrj/BigBasket-Deals). Everything below happens in your fork.

### Step 2: Create your Telegram bot

1. In Telegram, open `@BotFather`, send `/newbot`, and follow the prompts. Copy the token it gives you. This is `TELEGRAM_BOT_TOKEN`.
2. Open your new bot and press **Start**.
3. Open `@userinfobot` and press **Start**. Copy the number it shows. This is `TELEGRAM_CHAT_ID`.


### Step 3: Copy your BigBasket session

1. On a computer, open [bigbasket.com](https://www.bigbasket.com), log in, and set your delivery address.
2. Press `F12`, open the **Network** tab, reload, click the first request to `www.bigbasket.com`, and copy the **cookie** request header. This is `BIGBASKET_COOKIE`.

> **Important:** BigBasket blocks most cloud servers. Plan to use a self-hosted runner on your own computer (Step 6). The bot scans slowly on purpose (two workers, random delays) and stops at the first 403.

### Step 4: Add the secrets

In your fork, open **Settings → Secrets and variables → Actions → Secrets** and add:

| Secret | Required | What it is |
| :--- | :---: | :---: |
| `TELEGRAM_BOT_TOKEN` | Yes | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your chat ID from @userinfobot, or a channel `@username` |
| `BIGBASKET_COOKIE` | Yes | The Cookie header from a logged-in bigbasket.com tab with your address set. |

Then open the **Variables** tab and add `BOT_ENABLED` = `true`. Scheduled runs only start once this is set.

Optional variables:

| Variable | Default | What it does |
| :--- | :--- | :--- |
| `MIN_DISCOUNT` | per group | One threshold for every group, for example `65` |
| `GROUPS` | all | Only scan these groups, for example `staples,dairy` |
| `PAGES` | `1` | Pages per aisle, 1 to 5 |
| `DIGEST_HOUR_IST` | `9` | Hour of the morning catalogue; `-1` turns it off |
| `RUNNER` | `ubuntu-latest` | Set to `self-hosted` to run on your own computer |

### Step 5: Enable and test

1. Open the **Actions** tab. GitHub pauses workflows in new forks: click **I understand my workflows, go ahead and enable them**.
2. Choose **Telegram deal alerts** → **Run workflow**, first with **Print the messages instead of sending them** ticked (dry run), then without — your first alert arrives within a minute or two.

From then on it runs every 30 minutes by itself. GitHub sometimes starts scheduled runs late, and it pauses schedules in repositories with no activity for 60 days; re-enable them from the Actions tab if that happens.

### Step 6 (if blocked): run it on your own computer

GitHub's servers share IP addresses that some shops block. A self-hosted runner runs the same workflow on your computer, from your home connection.

In your repository: **Settings → Actions → Runners → New self-hosted runner**, follow its commands, then set variable `RUNNER` = `self-hosted` and keep that computer on during alert hours. Node 18 or newer must be installed on that computer.

### Run it on your computer

```bash
cp .env.example .env        # fill in the values from steps 2 and 3
node bot/run.js --dry-run   # prints the messages, sends nothing
node bot/run.js             # sends to Telegram and remembers this run in data/state.json
```

Node 18 or newer, no `npm install` needed.

### Keep your session safe

A session cookie works like your password for that site. Keep it only in GitHub **Secrets** or your local `.env` (already in `.gitignore`), never in a commit or an issue. GitHub hides secrets in run logs. If one ever leaks, log out of all devices on BigBasket to cancel it.

## Troubleshooting

- **Blank results / 0 deals:** read the **Why 0 results** box after the scan. Common causes: BigBasket blocked the browser (403 — open bigbasket.com, wait a few seconds and scan again), you are logged out, BigBasket rate-limited the scan (wait a few minutes), or the categories genuinely have nothing above your minimum discount (lower it and rescan).
- **Login / location:** Hunter only works inside your own logged-in bigbasket.com tab, with your delivery address set on bigbasket.com first — prices and stock depend on it.
- **Self-test fails:** the parser itself is broken for the built-in sample — check that `dist/` was rebuilt with `node build.js` after the last change, and report the FAIL line.
- **Telegram test fails:** use the userscript version; the bookmarklet is blocked from calling Telegram on some pages.
- **Mobile loader:** BigBasket blocks pages from loading code from other sites. Use the full bookmarklet (not the mobile loader), and the userscript for Telegram alerts.

## Testing

Run `node test-results-tab.js` (sample listing-svc payload: 9 products incl. 2 child variants, parser -> real card() render) and `node build.js` to rebuild `dist/` and `index.html`.

The regression test asserts 9 parsed products render 9 cards, plus the strict stock rules, child-variant parsing, image/id fallbacks, the generic-walk fallback, the self-test, CSV/JSON export and multi-keyword search. Live BigBasket results still need a manual browser test: the API cannot be fully verified from a machine without a logged-in BigBasket session, and BigBasket blocks most cloud servers.

## How it gets data

Calls `listing-svc/v2/products` with the same headers the BigBasket site sends (`x-channel: BB-WEB`, one stable `x-tracker` per session), from your tab. It scans slowly (two at a time, 2–2.5 second pauses), honours `Retry-After`, fetches page 2 only while the tail discount stays high, and stops if BigBasket returns 403.

## Limitations

- BigBasket blocks pages from loading code or calling Telegram from other sites. Use the full bookmarklet (not the mobile loader), and the userscript for Telegram alerts.
- All 21 category slugs were checked against the Nov 2026 category list; BigBasket can rename them at any time.
- The bot runs on GitHub-hosted runners by default, which BigBasket usually blocks — use a self-hosted runner.

## Project layout

```
src/deals.js         the app (one file, no dependencies)
src/index.tpl.html   install page template
bot/                 Telegram bot: run.js, core.js, platform.js, config.json
.github/workflows/   telegram-bot.yml (every 30 minutes)
.env.example         settings for local runs
test-results-tab.js  regression test (node test-results-tab.js)
fixtures/sample-api.json   sample listing-svc payload for the test
build.js             builds dist/ and index.html
favicon.svg
```

Run `node build.js` after any change.

## License

MIT — see `LICENSE`. The BigBasket parser in v2 was written fresh for this repo from the listing API's observed response shape; no third-party code was copied.

Made with ♥ by [Satyam Raj](https://www.linkedin.com/in/satyamraj1)
