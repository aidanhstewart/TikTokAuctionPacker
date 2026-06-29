# TikTok Shop Packing List Enhancer

A Chrome extension (Manifest V3) that takes a TikTok Shop packing‑list PDF, overlays the real product name (looked up from your spreadsheet) next to each line item, and prints the result on a 4×6 thermal label printer (e.g. TSC 203 DPI).

It is built for sellers who run their orders out of TikTok **Live auctions**, where the PDF only shows the buyer's **Seller SKU** number (the auction sale number) instead of the actual product they won. The extension turns that sale number back into a human‑readable product name automatically.

It also understands **marketplace orders** (normal shop orders that have a real SKU but no Seller SKU) and leaves those labels alone instead of stamping the wrong product on them.

---

## What it does

When you open a TikTok Shop packing list PDF in Chrome, the extension:

1. **Detects** the packing‑list PDF and redirects the tab to its own viewer.
2. **Renders** the PDF at 4×6 inches @ 203 DPI on a high‑resolution canvas (tuned for TSC thermal printers).
3. **Parses** the line‑item table directly from the PDF's positioned text.
4. For each **auction** item, works out which live it came from (Live 1 / Live 2 / … up to Live 6) from the row's title text (`AS SEEN ON SCREEN n`).
5. **Looks up** the Seller SKU (the auction sale number) in the matching sheet/tab to get the real product name.
6. **Draws** that product name beside the original row, prefixed with `S1:`, `S2:`, … so you can cross‑check which sheet it came from.
7. **Skips marketplace items** — any row that has a plain SKU (colour/size) but no Seller SKU is left completely untouched (no overlay, no wrong product).
8. Lets you hit **Print** to send a clean, monochrome 4×6 bitmap to the thermal printer.

---

## Key features

- **Three ways to supply product data** (in priority order):
  1. **Live Google Sheet link** (recommended) — one link, all tabs loaded automatically, re‑fetched on every PDF so edits go live instantly.
  2. **Excel workbook upload** (`.xlsx` / `.xls` / `.xlsm`) — fully offline fallback, stored in the browser.
  3. **Legacy per‑tab CSV links** — up to 6 individual published‑CSV URLs (Live 1 + Live 2 required).
- **Multi‑live support** — each tab maps to a live; tab names like `LIVE 3`, `SCREEN 4`, or a bare `5` are mapped to the right live index automatically (falls back to tab position).
- **Marketplace‑aware parsing** — rows with no Seller SKU get no label. On **mixed pages** (auction + marketplace items together), each auction row is bounded to its own row so its overlay never bleeds onto a neighbouring marketplace item.
- **CHECK‑column gating** — if column **C** has any value on a product row, packing is **blocked** until it is cleared, so flagged items can't be packed by mistake.
- **`COST` tabs ignored** — any tab whose name contains `COST` is skipped during loading.
- **Smart sheet routing** — if the same sale number exists on multiple lives, the detected live is preferred; otherwise the first match is used.
- **Thermal‑ready output** — flattened to a true 4×6 @ 203 DPI pure black/white bitmap before printing.
- **Selectable/searchable text layer** — the rendered viewer keeps an invisible text layer so you can Ctrl+F the labels.
- **Local PDF testing** — `file://` PDFs are supported for testing saved packing slips (requires "Allow access to file URLs").
- **Privacy‑friendly** — no analytics, no remote code; the only network call is fetching your own published sheet.

---

## Installation

1. Clone or download this repo.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top‑right toggle).
4. Click **Load unpacked** and choose this folder.
5. The extension appears in your toolbar.

> To test local PDF files, open the extension's details in `chrome://extensions` and enable **Allow access to file URLs**.

---

## Setup — choose one data source

Open the extension popup. The **setup banner** at the top always tells you which mode is active and whether you're ready to pack.

### Option 1 — Live Google Sheet link (recommended)

1. Share your spreadsheet as **Anyone with the link can view**.
2. Copy the normal spreadsheet URL from your browser.
3. Paste it into **Google Sheets link** and click **Save sheet link**.

All tabs are loaded automatically and **refreshed on every PDF**, so edits to the sheet take effect immediately — no re‑upload needed.

### Option 2 — Excel workbook upload (offline fallback)

Only used when no Google Sheet link is saved.

1. In Google Sheets: **File → Download → Microsoft Excel (.xlsx)**.
2. Open the popup → **Offline fallback: Excel workbook upload** → choose the file.
3. The workbook is parsed and stored locally; use **Reload file** to refresh it after changes.

### Option 3 — Legacy per‑tab CSV links

Only used when neither a sheet link nor a workbook is set.

1. In Google Sheets, **File → Share → Publish to web**, pick the tab, choose **Comma‑separated values (.csv)**, publish, copy the URL.
2. Paste each live's CSV URL into **Live 1 … Live 6** (Live 1 and Live 2 are required).
3. Click **Save sheet links**.

---

## Spreadsheet format

Each **tab = one live**. Columns:

| Column A    | Column B          | Column C            |
|-------------|-------------------|---------------------|
| Sale Number | Product Name      | CHECK (must be empty) |
| 1           | 500ML DESIRE      |                     |
| 2           | 150ML DIFFUSER    |                     |
| 3           | FAIRY 2.6L        | ✔ (blocks packing)  |

- **Row 1 is a header** and is skipped.
- **Column A** = the sale number only (e.g. `62`, not `Sale 62`).
- **Column B** = the product name shown on the label.
- **Column C (CHECK)** = leave empty. Any value (✔, `TRUE`, text, etc.) **blocks packing** for that row until cleared. The popup and viewer will tell you exactly which sheet/rows need clearing. (Values like `FALSE`, `0`, or `NO` count as empty.)
- Tabs containing **`COST`** in the name are ignored entirely.
- Tab names are mapped to a live index from patterns like `LIVE 3` / `SCREEN 4` / a bare `5`; otherwise the tab's position is used.

---

## Usage

1. In TikTok Seller Center, open/download a packing list. The extension auto‑detects the PDF and opens it inside its own viewer.
2. Each **auction** row shows:
   - The original PDF row, **unchanged** on the left (the title TikTok printed).
   - The looked‑up product name on the right, replacing the duplicate SKU number, prefixed `S1:` / `S2:` / … to show which sheet it came from.
3. **Marketplace** rows (real SKU, no Seller SKU) are left exactly as printed.
4. Click **Print** to send to your thermal printer — the page is flattened to a true 4×6 @ 203 DPI monochrome bitmap for crisp output.

If a row shows `S1: (no match)` (etc.), the sale number wasn't found in that sheet — usually a missing row or a typo in column A.

If product data is missing, the CHECK column is flagging rows, or the sheet can't be read, the viewer shows a clear banner explaining what to fix.

---

## How the parsing works

### Live (auction) detection

TikTok prints each auction row's title like:

```
SUNDAY LIVE - AS SEEN ON
SCREEN              <- Live 1
```
```
SUNDAY LIVE - AS SEEN ON
SCREEN 2            <- Live 2
```

The extension reads the title text sitting in each row's vertical band and routes the lookup to the matching live — `SCREEN` → Live 1, `SCREEN 2` → Live 2, and so on.

### Row anchoring & marketplace handling

- The parser anchors on **every line‑item row** (auction *and* marketplace), using any value in the SKU / Seller SKU / Qty columns. Wrapped product‑title continuation lines stay in the product column and are not treated as new rows.
- Each row's vertical band is the **midpoint** between it and its neighbouring rows, so an auction label is bounded to its own row even when a marketplace row sits right next to it.
- A label is only drawn when the row actually has a **Seller SKU**. Rows without one are treated as marketplace items and skipped — no overlay, nothing covered.

This means pure‑auction pages, pure‑marketplace pages, and **mixed** pages all behave correctly.

---

## Project structure

```
manifest.json      Chrome MV3 manifest (permissions, viewer + worker registration)
background.js      Service worker — detects TikTok packing PDFs and redirects them to viewer.html
content.js         Fallback on‑page overlay for raw PDFs that aren't redirected
popup.html         Settings UI: Google Sheet link, workbook upload, legacy links, status
popup.js           Saves/loads data sources, renders setup/status, refreshes CHECK state
viewer.html        Standalone viewer page used after the redirect
viewer.js          Renders the PDF, runs the parser, draws overlays, handles 4×6 thermal printing
pdfParser.js       Parses the TikTok packing‑list table from positioned PDF text items
workbookParser.js  Parses Excel/Google Sheet xlsx buffers into per‑tab sale → product maps
sheetUtils.js      Storage keys, sheet/CSV/xlsx loading, live detection, lookup + resolution
styles.css         Viewer / print styling
xlsx.full.min.js   SheetJS (xlsx) library for workbook parsing
pdfjs/             Bundled PDF.js library + worker
```

---

## Debugging

Each row's parsing decision is logged to the viewer's DevTools console (right‑click → **Inspect** → **Console**):

```
[TikTokPacker] {
  page: 1,
  saleNumber: "62",
  sheetIndex: 2,
  detectedTitle: "SUNDAY LIVE - AS SEEN ON SCREEN 2",
  lookedUpProduct: "FAIRY 2.6L"
}
```

If the overlay shows the wrong product:

1. **Wrong `sheetIndex`** → the parser misread the row's title. Check `detectedTitle` matches what the PDF visually shows on that row.
2. **Right `sheetIndex`, `lookedUpProduct: null`** → the sale number isn't in that tab's column A.
3. **Right `sheetIndex`, wrong product** → the wrong name is in column B of that row.

The `S1:` / `S2:` prefix on the printed overlay is a deliberate visual aid so the picker can spot a mis‑routed row at a glance.

---

## Thermal printer notes

- Target: 4×6 inch labels at 203 DPI (812 × 1218 px). Defaults live in the `THERMAL` constant at the top of `viewer.js`.
- Print output is reduced to pure black/white using a luminance threshold of `165` (`MONO_THRESHOLD` in `viewer.js`).
- Internal render is at 2× target resolution (`RENDER_SCALE = 2`) and downsampled at print time to keep text crisp.
- For a different printer, change `widthIn`, `heightIn`, `dpi`, and (if needed) `MONO_THRESHOLD`.

---

## Permissions used

- `storage` — remembers your Google Sheet link / uploaded workbook / legacy links.
- `tabs` + `webNavigation` — detect TikTok packing‑list URLs and redirect them to the viewer.
- `host_permissions: <all_urls>` — required so the redirect works on TikTok's signed S3 PDF URLs and so the viewer can fetch your published Google Sheet.

No analytics, no remote code — nothing leaves your browser except the fetch to your own published sheet.
