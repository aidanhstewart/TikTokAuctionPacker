// pdfParser.js - TikTok Shop packing list parsing

const ROW_Y_TOLERANCE = 6;
const SELLER_SKU_X_TOLERANCE = 40;

function isNumericSellerSkuAtColumn(item, sellerSkuX) {
  if (sellerSkuX == null) return false;
  const text = item.str.trim();
  return (
    /^\d+$/.test(text) &&
    Math.abs(item.transform[4] - sellerSkuX) <= SELLER_SKU_X_TOLERANCE
  );
}

function getSellerSkuFromRow(rowItems, sellerSkuX) {
  return (
    rowItems.find(item => isNumericSellerSkuAtColumn(item, sellerSkuX)) || null
  );
}

function hasSellerSkuValues(dataItems, sellerSkuX) {
  return dataItems.some(item => isNumericSellerSkuAtColumn(item, sellerSkuX));
}

// ---------------------------------------------------------------------------
// Row / text helpers
// ---------------------------------------------------------------------------

function normalizePdfText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function groupTextItemsByRow(items, tolerance = ROW_Y_TOLERANCE) {
  const rows = [];

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;

    const y = item.transform[5];
    let row = rows.find(r => Math.abs(r.y - y) <= tolerance);

    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }

    row.items.push(item);
  }

  for (const row of rows) {
    row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    row.text = row.items.map(i => i.str).join(" ");
  }

  rows.sort((a, b) => b.y - a.y);
  return rows;
}

function findLabelItem(items, pattern) {
  return items.find(item => pattern.test(item.str));
}

function groupProductLines(sortedProducts) {
  const lines = [];
  let currentY = null;

  for (const item of sortedProducts) {
    const y = item.transform[5];

    if (currentY == null || Math.abs(y - currentY) > ROW_Y_TOLERANCE) {
      lines.push(item.str.trim());
      currentY = y;
    } else {
      lines[lines.length - 1] += " " + item.str.trim();
    }
  }

  return lines;
}

function findColumnX(headerRow, label) {
  for (const item of headerRow.items) {
    if (item.str.includes(label)) {
      return item.transform[4];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Table layout
// ---------------------------------------------------------------------------

function getTableColumnLayout(textContent) {
  const items = textContent.items.filter(item => item.str && item.str.trim());

  const sellerSkuLabel = findLabelItem(items, /Seller\s*SKU/i);
  const skuLabel = items.find(item => {
    const text = item.str.trim();
    return text === "SKU" || (text.includes("SKU") && !/Seller/i.test(text));
  });

  const productLabel = findLabelItem(items, /Product Name/i);
  const skuX = skuLabel?.transform[4] ?? null;
  const sellerSkuX = sellerSkuLabel?.transform[4] ?? null;

  if (skuX == null && sellerSkuX == null) {
    return emptyColumnLayout();
  }

  const firstDataColumn = Math.min(skuX ?? Infinity, sellerSkuX ?? Infinity);

  return {
    productColumnLeftPdf: productLabel?.transform[4] ?? 20,
    productColumnRightPdf: firstDataColumn - 4,
    skuColumnXPdf: skuX,
    sellerSkuColumnXPdf: sellerSkuX,
    skuColumnLeftPdf: skuX != null ? skuX - 2 : null,
    skuColumnRightPdf:
      sellerSkuX != null
        ? sellerSkuX - 4
        : skuX != null
          ? skuX + 50
          : null
  };
}

function emptyColumnLayout() {
  return {
    productColumnLeftPdf: null,
    productColumnRightPdf: null,
    skuColumnXPdf: null,
    sellerSkuColumnXPdf: null,
    skuColumnLeftPdf: null,
    skuColumnRightPdf: null
  };
}

// ---------------------------------------------------------------------------
// Live title detection
// ---------------------------------------------------------------------------

function isGenericLiveTitle(text) {
  const value = normalizePdfText(text);

  if (/LIVE\s*-\s*AS SEEN/i.test(value)) return true;
  if (/^SCREEN\s*\d*$/i.test(value)) return true;
  if (/^ON\s+SCREEN\s*\d*$/i.test(value)) return true;

  return false;
}

function isMaskableLiveTitle(text) {
  const value = normalizePdfText(text);
  if (isScreenIndicator(value)) return false;
  return /LIVE\s*-\s*AS SEEN/i.test(value);
}

function isScreenIndicator(text) {
  const value = normalizePdfText(text);
  return (
    /^SCREEN\s*\d*$/i.test(value) || /^ON\s+SCREEN\s*\d*$/i.test(value)
  );
}

function isTableEndText(text) {
  return (
    text.includes("Qty Total") ||
    text.includes("TikTok Shop") ||
    text.includes("Buyer ID") ||
    text.includes("NickName")
  );
}

function getPageSheetIndex(textContent) {
  const pageText = textContent.items.map(item => item.str).join(" ");
  const liveMatch = pageText.match(
    /([A-Z]+\s+LIVE\s*-\s*AS SEEN ON(?:\s+SCREEN)?(?:\s+\d+)?)/i
  );

  if (!liveMatch) {
    return getLiveSheetIndex(pageText, []);
  }

  return getLiveSheetIndex(liveMatch[1], liveMatch[1].split(/\s+/));
}

function detectSheetIndexFromTitle(titleText, titleLines, pageSheetIndex, lastDetectedSheetIndex) {
  if (/LIVE|SCREEN/i.test(titleText)) {
    return getLiveSheetIndex(titleText, titleLines);
  }

  if (lastDetectedSheetIndex != null) {
    return lastDetectedSheetIndex;
  }

  return pageSheetIndex;
}

// ---------------------------------------------------------------------------
// Main packing-list parser
// ---------------------------------------------------------------------------

function parseTikTokPackingItems(textContent) {
  const items = textContent.items.filter(item => item.str && item.str.trim());
  const layout = getTableColumnLayout(textContent);
  const sellerSkuLabel = findLabelItem(items, /Seller\s*SKU/i);

  if (!sellerSkuLabel) {
    return parseTikTokPackingItemsFromRows(textContent.items);
  }

  const headerY = getHeaderBaselineY(items, sellerSkuLabel);
  const tableBottomY = findLabelItem(items, /Qty Total/i)?.transform[5] ?? 0;
  const sellerSkuX = layout.sellerSkuColumnXPdf ?? sellerSkuLabel.transform[4];
  const productColumnRight = layout.productColumnRightPdf ?? sellerSkuX - 20;
  const pageSheetIndex = getPageSheetIndex(textContent);

  const dataItems = items.filter(item => {
    const y = item.transform[5];
    return y < headerY - 2 && y > tableBottomY + 2;
  });

  if (!hasSellerSkuValues(dataItems, sellerSkuX)) {
    return parseTikTokPackingItemsFromRows(textContent.items);
  }

  return buildPackingItemsFromOrderedItems(
    dataItems,
    sellerSkuX,
    productColumnRight,
    pageSheetIndex,
    tableBottomY
  );
}

function getHeaderBaselineY(items, sellerSkuLabel) {
  const skuLabel = items.find(item => {
    const text = item.str.trim();
    return text === "SKU" || (text.includes("SKU") && !/Seller/i.test(text));
  });
  const productLabel = findLabelItem(items, /Product Name/i);

  return Math.max(
    sellerSkuLabel.transform[5],
    skuLabel?.transform[5] ?? 0,
    productLabel?.transform[5] ?? 0
  );
}

function rowHasDataColumnValue(row, productColumnRight) {
  if (productColumnRight == null) return false;

  return row.items.some(item => {
    const text = item.str.trim();
    if (!text) return false;
    if (isTableEndText(text)) return false;
    if (
      isMaskableLiveTitle(text) ||
      isScreenIndicator(text) ||
      isGenericLiveTitle(text)
    ) {
      return false;
    }
    return item.transform[4] >= productColumnRight;
  });
}

// Anchor on every line-item row (auction OR marketplace), not just rows that
// have a Seller SKU. A row counts as a line item if it carries a Seller SKU
// value or any value in the SKU/Qty columns (right of the product column).
// Continuation lines of a wrapped product title stay in the product column, so
// they are not treated as new rows.
function collectLineItemRows(dataItems, sellerSkuX, productColumnRight) {
  const rows = [];

  for (const row of groupTextItemsByRow(dataItems)) {
    const saleItem = getSellerSkuFromRow(row.items, sellerSkuX);
    const hasData = rowHasDataColumnValue(row, productColumnRight);
    if (!saleItem && !hasData) continue;

    rows.push({ y: row.y, saleItem });
  }

  return rows.sort((a, b) => b.y - a.y);
}

function computeLineItemRowBounds(sortedRows, tableBottomY) {
  return sortedRows.map((row, idx) => {
    const rowY = row.y;
    const prevY = idx > 0 ? sortedRows[idx - 1].y : null;
    const nextY = idx < sortedRows.length - 1 ? sortedRows[idx + 1].y : null;

    const upperBound = prevY != null ? (prevY + rowY) / 2 : Infinity;
    let lowerBound;

    if (nextY != null) {
      lowerBound = (rowY + nextY) / 2;
    } else {
      lowerBound = tableBottomY + ROW_Y_TOLERANCE;
    }

    return { upperBound, lowerBound };
  });
}

function collectTitleItemsForSaleBand(
  dataItems,
  productColumnRight,
  lowerBound,
  upperBound
) {
  const titleItems = dataItems.filter(item => {
    const text = item.str.trim();
    if (!text) return false;
    if (item.transform[4] >= productColumnRight) return false;
    if (/^\d+$/.test(text)) return false;
    if (isTableEndText(text)) return false;

    const y = item.transform[5];
    return y > lowerBound && y < upperBound;
  });

  titleItems.sort(
    (a, b) =>
      b.transform[5] - a.transform[5] ||
      a.transform[4] - b.transform[4]
  );

  return titleItems;
}

function buildPackingItemsFromOrderedItems(
  dataItems,
  sellerSkuX,
  productColumnRight,
  pageSheetIndex,
  tableBottomY = 0
) {
  if (sellerSkuX == null) return [];

  const lineItemRows = collectLineItemRows(
    dataItems,
    sellerSkuX,
    productColumnRight
  );
  if (lineItemRows.length === 0) return [];

  const rowBounds = computeLineItemRowBounds(lineItemRows, tableBottomY);
  let lastDetectedSheetIndex = null;
  const results = [];

  lineItemRows.forEach((row, idx) => {
    // Marketplace rows have no Seller SKU, so they get no label and are left
    // untouched. Their row still bounds the neighbouring auction bands above.
    const saleItem = row.saleItem;
    if (!saleItem) return;

    const { upperBound, lowerBound } = rowBounds[idx];
    const titleItems = collectTitleItemsForSaleBand(
      dataItems,
      productColumnRight,
      lowerBound,
      upperBound
    );
    const titleLines = groupProductLines(titleItems);
    const titleText = titleLines.join(" ");
    const sheetIndex = detectSheetIndexFromTitle(
      titleText,
      titleLines,
      pageSheetIndex,
      lastDetectedSheetIndex
    );

    if (/LIVE|SCREEN/i.test(titleText)) {
      lastDetectedSheetIndex = sheetIndex;
    }

    results.push({
      saleNumber: saleItem.str.trim(),
      saleItem,
      liveTitle: titleText,
      sheetIndex,
      productItems: titleItems
    });
  });

  return results;
}

function parseTikTokPackingItemsFromRows(rawItems) {
  const rows = groupTextItemsByRow(rawItems);
  const headerIdx = findPackingTableHeaderRow(rows);

  if (headerIdx < 0) {
    return parseLooseNumericRows(rows);
  }

  const headerRow = rows[headerIdx];
  const sellerSkuX = findColumnX(headerRow, "Seller SKU");
  const skuX = findColumnX(headerRow, "SKU");

  if (sellerSkuX == null) {
    return parseLooseNumericRows(rows);
  }

  const columnCutoff = Math.min(sellerSkuX ?? Infinity, skuX ?? Infinity);
  const productColumnRight = columnCutoff - 8;
  const dataItems = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isTableEndText(row.text)) break;
    dataItems.push(...row.items);
  }

  const pageSheetIndex = getPageSheetIndex({ items: rawItems });
  const tableBottomY =
    rows.find(row => isTableEndText(row.text))?.y ??
    rows[rows.length - 1]?.y ??
    0;
  const results = buildPackingItemsFromOrderedItems(
    dataItems,
    sellerSkuX,
    productColumnRight,
    pageSheetIndex,
    tableBottomY
  );

  if (results.length > 0) {
    return results;
  }

  // A Seller SKU column exists but yielded no values: these are marketplace
  // items (only a plain SKU like a colour/size, no Seller SKU). Ignore them
  // rather than loose-guessing an unrelated product from another column/sheet.
  if (hasSkuColumnValues(dataItems, skuX)) {
    return [];
  }

  return parseLooseNumericRows(rows);
}

function hasSkuColumnValues(dataItems, skuX) {
  if (skuX == null) return false;
  return dataItems.some(item => {
    const text = item.str.trim();
    if (!text) return false;
    return Math.abs(item.transform[4] - skuX) <= SELLER_SKU_X_TOLERANCE;
  });
}

function findPackingTableHeaderRow(rows) {
  return rows.findIndex(row => {
    const text = row.text;
    return (
      text.includes("Qty") &&
      text.includes("Seller") &&
      (text.includes("SKU") || text.includes("Product"))
    );
  });
}

function parseLooseNumericRows(rows) {
  const results = [];
  let lastDetectedSheetIndex = getPageSheetIndex({
    items: rows.flatMap(r => r.items)
  });

  for (const row of rows) {
    if (isTableEndText(row.text)) break;

    const saleItem = row.items.find(item => /^\d+$/.test(item.str.trim()));
    if (!saleItem) continue;

    const titleItems = row.items.filter(item => {
      const text = item.str.trim();
      if (!text || /^\d+$/.test(text) || isTableEndText(text)) return false;
      return item !== saleItem;
    });

    const titleLines = groupProductLines(titleItems);
    const titleText = titleLines.join(" ");

    if (/LIVE|SCREEN/i.test(titleText)) {
      lastDetectedSheetIndex = getLiveSheetIndex(titleText, titleLines);
    }

    results.push({
      saleNumber: saleItem.str.trim(),
      saleItem,
      liveTitle: titleText,
      sheetIndex: lastDetectedSheetIndex,
      productItems: titleItems
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Text fallback matcher (content.js overlay)
// ---------------------------------------------------------------------------

function matchTikTokPackingItems(fullText, maps) {
  const matches = [];
  const seen = new Set();

  const headerEnd = fullText.search(/Seller SKU\s+Qty/i);
  if (headerEnd < 0) {
    return matchSellerSkuFallback(fullText, maps);
  }

  const afterHeader = fullText.slice(headerEnd);
  const tableEnd = afterHeader.search(/Qty Total/i);
  const tableBody =
    tableEnd >= 0 ? afterHeader.slice(0, tableEnd) : afterHeader;

  const rowPattern = /(.+?)\s+(\d+)\s+(\d+)\s+(\d+)(?=\s|$)/g;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(tableBody)) !== null) {
    const liveTitle = rowMatch[1].trim();
    const sellerSku = rowMatch[3];
    const sheetIndex = getLiveSheetIndex(liveTitle);
    const key = `${sheetIndex}:${sellerSku}`;

    if (seen.has(key)) continue;

    const productName = lookupProduct(maps, sheetIndex, sellerSku);
    if (!productName) continue;

    seen.add(key);
    matches.push({ saleNumber: sellerSku, sheetIndex, liveTitle, productName });
  }

  if (matches.length === 0) {
    return matchSellerSkuFallback(fullText, maps);
  }

  return matches;
}

function matchSellerSkuFallback(fullText, maps) {
  const matches = [];
  const seen = new Set();

  const sellerSkuSection = fullText.split(/Seller SKU/i)[1];
  if (!sellerSkuSection) return matches;

  const liveMatch = fullText.match(
    /([A-Z]+\s+LIVE\s*-\s*AS SEEN ON SCREEN(?:\s+\d+)?)/i
  );
  const liveTitle = liveMatch ? liveMatch[1] : "";
  const sheetIndex = getLiveSheetIndex(liveTitle);

  const numbers = sellerSkuSection.match(/\b(\d+)\b/g) || [];

  for (const saleNumber of numbers) {
    const key = `${sheetIndex}:${saleNumber}`;
    if (seen.has(key)) continue;

    const productName = lookupProduct(maps, sheetIndex, saleNumber);
    if (!productName) continue;

    seen.add(key);
    matches.push({ saleNumber, sheetIndex, liveTitle, productName });
  }

  return matches;
}
