// pdfParser.js - TikTok Shop packing list parsing

function getRowYTolerance() {
  return getEffectivePdfSettings().rowYTolerance;
}

function getSellerSkuXTolerance() {
  return getEffectivePdfSettings().sellerSkuXTolerance;
}

// ---------------------------------------------------------------------------
// Row / text helpers
// ---------------------------------------------------------------------------

function normalizePdfText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function groupTextItemsByRow(items, tolerance) {
  const rowTolerance = tolerance ?? getRowYTolerance();
  const validItems = items.filter(item => item.str?.trim());
  if (validItems.length === 0) return [];

  const sorted = [...validItems].sort((a, b) => b.transform[5] - a.transform[5]);
  const rows = [];
  let current = null;

  for (const item of sorted) {
    const y = item.transform[5];

    if (!current || Math.abs(current.y - y) > tolerance) {
      current = { y, items: [item] };
      rows.push(current);
    } else {
      current.items.push(item);
      current.y = (current.y * (current.items.length - 1) + y) / current.items.length;
    }
  }

  for (const row of rows) {
    row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    row.text = row.items.map(i => i.str).join(" ");
  }

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

    if (currentY == null || Math.abs(y - currentY) > getRowYTolerance()) {
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
    skuColumnLeftPdf: null,
    skuColumnRightPdf: null
  };
}

// ---------------------------------------------------------------------------
// Live title detection
// ---------------------------------------------------------------------------

function isMaskableLiveTitle(text) {
  return isMaskableLiveTitleText(text);
}

function isScreenIndicator(text) {
  return isLegacyScreenIndicator(text);
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
  return getPageDefaultLiveIndex(pageText);
}

function detectSheetIndexFromTitle(titleText, titleLines, pageSheetIndex, lastDetectedSheetIndex) {
  if (rowTitleMatchesScreenKeyword(titleText, titleLines)) {
    const keywordIndex = getLiveSheetIndex(titleText, titleLines);
    if (keywordIndex != null) return keywordIndex;
    if (isStrictLiveMatchingEnabled()) return null;
  }

  if (isStrictLiveMatchingEnabled()) {
    if (lastDetectedSheetIndex != null) {
      return lastDetectedSheetIndex;
    }
    return null;
  }

  if (isLiveTitleText(titleText)) {
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
  const sellerSkuX = sellerSkuLabel.transform[4];
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
    pageSheetIndex
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

function hasSellerSkuValues(dataItems, sellerSkuX) {
  return dataItems.some(item => {
    if (!isAuctionSaleNumber(item.str.trim())) return false;
    return Math.abs(item.transform[4] - sellerSkuX) <= getSellerSkuXTolerance();
  });
}

function buildPackingItemsFromOrderedItems(
  dataItems,
  sellerSkuX,
  productColumnRight,
  pageSheetIndex
) {
  if (sellerSkuX == null) return [];

  const saleItems = dataItems.filter(item => {
    const text = item.str.trim();
    if (!isAuctionSaleNumber(text)) return false;
    return Math.abs(item.transform[4] - sellerSkuX) <= getSellerSkuXTolerance();
  });

  if (saleItems.length === 0) return [];

  const sortedSales = [...saleItems].sort(
    (a, b) => b.transform[5] - a.transform[5]
  );

  const rowBounds = sortedSales.map((sale, idx) => {
    const saleY = sale.transform[5];
    const upperBound =
      idx === 0
        ? Infinity
        : (sortedSales[idx - 1].transform[5] + saleY) / 2;
    const lowerBound =
      idx === sortedSales.length - 1
        ? -Infinity
        : (saleY + sortedSales[idx + 1].transform[5]) / 2;
    return { upperBound, lowerBound };
  });

  let lastDetectedSheetIndex = null;
  const results = [];

  sortedSales.forEach((sale, idx) => {
    const { upperBound, lowerBound } = rowBounds[idx];
    const titleItems = collectTitleItemsForSaleRow(
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

    if (rowTitleMatchesScreenKeyword(titleText, titleLines) && sheetIndex != null) {
      lastDetectedSheetIndex = sheetIndex;
    } else if (!isStrictLiveMatchingEnabled() && isLiveTitleText(titleText)) {
      lastDetectedSheetIndex = sheetIndex;
    }

    results.push({
      saleNumber: sale.str.trim(),
      saleItem: sale,
      liveTitle: titleText,
      titleLines,
      sheetIndex,
      productItems: titleItems
    });
  });

  return results;
}

function collectTitleItemsForSaleRow(
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

function parseTikTokPackingItemsFromRows(rawItems) {
  const rows = groupTextItemsByRow(rawItems);
  const headerIdx = findPackingTableHeaderRow(rows);

  if (headerIdx < 0) {
    return parseLooseNumericRows(rows);
  }

  const headerRow = rows[headerIdx];
  const sellerSkuX = findColumnX(headerRow, "Seller SKU");
  const skuX = findColumnX(headerRow, "SKU");

  if (sellerSkuX == null && skuX == null) {
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
  const results = buildPackingItemsFromOrderedItems(
    dataItems,
    sellerSkuX ?? skuX,
    productColumnRight,
    pageSheetIndex
  );

  if (results.length > 0) {
    return results;
  }

  return parseLooseNumericRows(rows);
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
  const pageItems = rows.flatMap(r => r.items);
  const pageSheetIndex = getPageSheetIndex({ items: pageItems });
  let lastDetectedSheetIndex = null;

  for (const row of rows) {
    if (isTableEndText(row.text)) break;

    const titleItems = row.items.filter(item => {
      const text = item.str.trim();
      return text && !/^\d+$/.test(text) && !isTableEndText(text);
    });
    const titleLines = groupProductLines(titleItems);
    const titleText = titleLines.join(" ");
    const sheetIndex = detectSheetIndexFromTitle(
      titleText,
      titleLines,
      pageSheetIndex,
      lastDetectedSheetIndex
    );

    if (rowTitleMatchesScreenKeyword(titleText, titleLines) && sheetIndex != null) {
      lastDetectedSheetIndex = sheetIndex;
    } else if (!isStrictLiveMatchingEnabled() && isLiveTitleText(titleText)) {
      lastDetectedSheetIndex = sheetIndex;
    }

    const saleItem = row.items.find(item => isAuctionSaleNumber(item.str.trim()));
    if (!saleItem) continue;

    results.push({
      saleNumber: saleItem.str.trim(),
      saleItem,
      liveTitle: titleText,
      titleLines,
      sheetIndex,
      productItems: titleItems
    });
  }

  return results;
}
