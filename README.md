# TikTok Shop Packing List Enhancer

A Chrome extension that takes a TikTok Shop packing‑list PDF and overlays the matching product name (looked up from a Google Sheet) next to each line item, then prints the result on a 4×6 thermal label printer (e.g. TSC 203 DPI).

It's built for sellers who run their orders out of TikTok Live auctions, where the PDF only shows the buyer's "Seller SKU" number (the auction sale number) and not the actual product they won.

---

## What it does

When you open a TikTok Shop packing list PDF in Chrome, the extension:

1. Detects the PDF and redirects the tab to its own viewer.
2. Renders the PDF at 4×6 inches @ 203 DPI on a high‑res canvas (tuned for TSC thermal printers).
3. Parses the items in the packing‑list table.
4. For each item, decides which live auction it came from (Live 1 vs. Live 2) based on the row's product‑name text.
5. Looks up the Seller SKU (the auction sale number) in the matching Google Sheet to get the actual product name.
6. Draws the looked‑up product name beside the original row, prefixed with `S1:` or `S2:` so you can cross‑check it.
7. Lets you hit **Print** to send a clean, monochrome version to the thermal printer.

---

## Installation

1. Clone or download this repo.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top‑right toggle).
4. Click **Load unpacked** and choose this folder.
5. The "TikTok Shop Packing List Enhancer" extension should appear in your toolbar.

---

## Setup — Google Sheets

You need two published‑to‑web CSV URLs, one per live auction.

### Sheet format

Each sheet must have two columns:

| Column A     | Column B           |
|--------------|--------------------|
| Sale Number  | Product Name       |
| 1            | 500ML DESIRE       |
| 2            | 150ML DIFFUSER     |
| 3            | FAIRY 2.6L         |
| …            | …                  |

- The first row is treated as a header and skipped.
- Column A must contain only the sale number (e.g. `62`, not `Sale 62`).
- Column B is the product name to show on the label.

### Publish the sheet as CSV

In Google Sheets:

1. **File → Share → Publish to web**.
2. Pick the correct **tab/sheet** from the first dropdown.
3. Pick **Comma‑separated values (.csv)** from the second dropdown.
4. Click **Publish** and copy the resulting URL.
5. Repeat for the second live's sheet.

### Save the URLs in the extension

1. Click the extension icon in Chrome.
2. Paste the **Live 1** CSV URL into the first input.
3. Paste the **Live 2** CSV URL into the second input.
4. Click **Save**.

The URLs are kept in `chrome.storage.local` and reused on every PDF.

---

## Usage

1. In TikTok Seller Center, open a packing list. The extension auto‑detects the PDF and opens it inside its own viewer.
2. Each row will show:
   - The original PDF row, **unchanged** on the left (so you can see the title that came from TikTok).
   - The looked‑up product name on the right, in place of the duplicate SKU number, prefixed with `S1:` or `S2:` to indicate which sheet it came from.
3. Click **Print** to send to your thermal printer. The page is flattened to a true 4×6 @ 203 DPI monochrome bitmap before printing for a crisp thermal output.

If a row shows `S1:` or `S2: (no match)`, the sale number wasn't found in that sheet — typically a row missing from the sheet, or a typo in the sale number column.

---

## How the "Live 1 vs Live 2" detection works

TikTok prints each row's product name as something like:

```
SUNDAY LIVE - AS SEEN ON
SCREEN              <- this row is from Live 1
```

or:

```
SUNDAY LIVE - AS SEEN ON
SCREEN 2            <- this row is from Live 2
```

The extension reads the title text that physically sits in each row's vertical band on the page and routes the lookup to the matching sheet — `SCREEN` → Live 1, `SCREEN 2` → Live 2.

Row boundaries are computed as the **midpoint** between consecutive sale‑number Y positions, so the title is always bound to the correct sale regardless of which line the sale number's baseline sits on.

---

## Project structure

```
manifest.json     Chrome MV3 manifest (permissions, viewer registration)
background.js     Service worker — detects TikTok packing PDFs and redirects them to viewer.html
content.js       Legacy on‑page overlay (used as a fallback when the PDF isn't redirected)
popup.html       Settings UI for the two Google Sheet URLs
popup.js         Saves/loads the sheet URLs to chrome.storage.local
viewer.html      Standalone viewer page used after the redirect
viewer.js        Renders the PDF, runs the parser, draws the overlay, handles printing
pdfParser.js     Parses the TikTok packing‑list table out of the raw PDF text items
sheetUtils.js    Fetches the CSV sheets and provides lookupProduct() / getLiveSheetIndex()
styles.css       Viewer / print styling
pdfjs/           Bundled PDF.js library + worker
```

---

## Debugging

Each row's parsing decision is logged to the viewer page's DevTools console (right‑click → **Inspect** → **Console**) in this form:

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

1. **Wrong `sheetIndex`** → the parser misread the row's title. Check that the row's `detectedTitle` matches what the PDF visually shows on that row.
2. **Right `sheetIndex`, `lookedUpProduct: null`** → the sale number isn't in that sheet's column A.
3. **Right `sheetIndex`, wrong `lookedUpProduct`** → the wrong product name is in column B of that sheet row.

The `S1:` / `S2:` prefix on the printed overlay is a deliberate visual aid so the picker can spot a mis‑routed row at a glance.

---

## Thermal printer notes

- Target: 4×6 inch labels at 203 DPI (812 × 1218 px). Defaults are in the `THERMAL` constant at the top of `viewer.js`.
- Print output is dithered to pure black/white using a luminance threshold of `165` (also configurable at the top of `viewer.js`).
- Internal render is at 2× the target resolution (`RENDER_SCALE = 2`) and downsampled at print time to keep text crisp.
- For a different printer, change `widthIn`, `heightIn`, `dpi`, and (if needed) `MONO_THRESHOLD`.

---

## Permissions used

- `storage` — to remember the two Google Sheet URLs.
- `tabs` + `webNavigation` — to detect TikTok packing‑list URLs and redirect them to the viewer.
- `host_permissions: <all_urls>` — required so the redirect works on TikTok's signed S3 PDF URLs and so the viewer can fetch the published Google Sheet CSVs.

No analytics, no remote code, nothing leaves your browser except the CSV fetch to Google's published sheet URL.
