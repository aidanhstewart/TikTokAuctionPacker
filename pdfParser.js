// pdfParser.js — TikTok Shop packing list parsing

function groupTextItemsByRow(items, tolerance = 6) {
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

    if (currentY == null || Math.abs(y - currentY) > 6) {
      lines.push(item.str.trim());
      currentY = y;
    } else {
      lines[lines.length - 1] += " " + item.str.trim();
    }
  }

  return lines;
}

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
    return {
      productColumnLeftPdf: null,
      productColumnRightPdf: null,
      skuColumnLeftPdf: null,
      skuColumnRightPdf: null
    };
  }

  const firstDataColumn = Math.min(
    skuX ?? Infinity,
    sellerSkuX ?? Infinity
  );

  return {
    productColumnLeftPdf: productLabel?.transform[4] ?? 20,
    productColumnRightPdf: firstDataColumn - 4,
    skuColumnLeftPdf: skuX != null ? skuX - 22 : null,
    skuColumnRightPdf:
      sellerSkuX != null
        ? sellerSkuX - 4
        : skuX != null
          ? skuX + 50
          : null
  };
}

function isGenericLiveTitle(text) {
  const value = text.replace(/\s+/g, " ").trim();

  if (/LIVE\s*-\s*AS SEEN/i.test(value)) return true;
  if (/^SCREEN\s*2?$/i.test(value)) return true;
  if (/^ON\s+SCREEN\s*2?$/i.test(value)) return true;

  return false;
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
    /([A-Z]+\s+LIVE\s*-\s*AS SEEN ON(?:\s+SCREEN)?(?:\s+2)?)/i
  );

  if (!liveMatch) {
    return getLiveSheetIndex(pageText, []);
  }

  return getLiveSheetIndex(liveMatch[1], liveMatch[1].split(/\s+/));
}

function parseTikTokPackingItems(textContent) {
  const items = textContent.items.filter(item => item.str && item.str.trim());
  const layout = getTableColumnLayout(textContent);

  const sellerSkuLabel = findLabelItem(items, /Seller\s*SKU/i);
  const skuLabel = items.find(item => {
    const text = item.str.trim();
    return text === "SKU" || (text.includes("SKU") && !/Seller/i.test(text));
  });
  const productLabel = findLabelItem(items, /Product Name/i);
  const qtyTotalLabel = findLabelItem(items, /Qty Total/i);

  if (!sellerSkuLabel) {
    return parseTikTokPackingItemsFromRows(textContent.items);
  }

  const headerY = Math.max(
    sellerSkuLabel.transform[5],
    skuLabel?.transform[5] ?? 0,
    productLabel?.transform[5] ?? 0
  );

  const tableBottomY = qtyTotalLabel?.transform[5] ?? 0;
  const sellerSkuX = sellerSkuLabel.transform[4];
  const productColumnRight = layout.productColumnRightPdf ?? sellerSkuX - 20;
  const rowTolerance = 5;
  const pageSheetIndex = getPageSheetIndex(textContent);

  const dataItems = items.filter(item => {
    const y = item.transform[5];
    return y < headerY - 2 && y > tableBottomY + 2;
  });

  const saleItems = dataItems.filter(item => {
    if (!/^\d+$/.test(item.str.trim())) return false;
    return Math.abs(item.transform[4] - sellerSkuX) <= 40;
  });

  if (saleItems.length === 0) {
    return parseTikTokPackingItemsFromRows(textContent.items);
  }

  const sortedSales = [...saleItems].sort(
    (a, b) => b.transform[5] - a.transform[5]
  );

  const results = [];

  sortedSales.forEach((saleItem, idx) => {
    const saleY = saleItem.transform[5];
    const upperBound =
      idx === 0
        ? headerY - 2
        : sortedSales[idx - 1].transform[5] - rowTolerance;
    const lowerBound = saleY - rowTolerance;

    const productItems = dataItems.filter(item => {
      const y = item.transform[5];

      return (
        item.transform[4] < productColumnRight &&
        y <= upperBound &&
        y >= lowerBound &&
        !/^\d+$/.test(item.str.trim()) &&
        !isGenericLiveTitle(item.str)
      );
    });

    const sortedProducts = productItems.sort(
      (a, b) =>
        b.transform[5] - a.transform[5] ||
        a.transform[4] - b.transform[4]
    );

    const productLines = groupProductLines(sortedProducts);
    const liveTitle = productLines.join(" ");

    if (isTableEndText(liveTitle)) return;

    let sheetIndex = getLiveSheetIndex(liveTitle, productLines);

    if (!/LIVE|SCREEN/i.test(liveTitle)) {
      sheetIndex = pageSheetIndex;
    }

    results.push({
      saleNumber: saleItem.str.trim(),
      saleItem,
      liveTitle,
      sheetIndex,
      productItems: sortedProducts
    });
  });

  return results;
}

function parseTikTokPackingItemsFromRows(rawItems) {
  const rows = groupTextItemsByRow(rawItems);

  const headerIdx = rows.findIndex(row => {
    const text = row.text;
    return (
      text.includes("Qty") &&
      text.includes("Seller") &&
      (text.includes("SKU") || text.includes("Product"))
    );
  });

  if (headerIdx < 0) return [];

  const headerRow = rows[headerIdx];
  const sellerSkuX = findColumnX(headerRow, "Seller SKU");
  const skuX = findColumnX(headerRow, "SKU");
  const columnCutoff = Math.min(
    sellerSkuX ?? Infinity,
    skuX ?? Infinity
  );

  const results = [];
  const saleRowIndices = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isTableEndText(row.text)) break;

    const sellerSkuItem = findItemAtColumn(row, sellerSkuX, 40);
    if (!sellerSkuItem || !/^\d+$/.test(sellerSkuItem.str.trim())) continue;

    saleRowIndices.push(i);
  }

  saleRowIndices.forEach((rowIdx, idx) => {
    const row = rows[rowIdx];
    const sellerSkuItem = findItemAtColumn(row, sellerSkuX, 40);
    const saleNumber = sellerSkuItem.str.trim();
    const prevRowIdx =
      idx === 0 ? headerIdx : saleRowIndices[idx - 1];

    const productItems = [];

    for (let j = rowIdx; j > prevRowIdx; j--) {
      productItems.push(
        ...rows[j].items.filter(
          item =>
            item.transform[4] < columnCutoff - 8 &&
            !/^\d+$/.test(item.str.trim()) &&
            !isGenericLiveTitle(item.str)
        )
      );
    }

    const sortedProducts = productItems.sort(
      (a, b) =>
        b.transform[5] - a.transform[5] ||
        a.transform[4] - b.transform[4]
    );
    const productLines = groupProductLines(sortedProducts);
    const liveTitle = productLines.join(" ");
    let sheetIndex = getLiveSheetIndex(liveTitle, productLines);

    if (!/LIVE|SCREEN/i.test(liveTitle)) {
      sheetIndex = getPageSheetIndex({ items: rawItems });
    }

    results.push({
      saleNumber,
      saleItem: sellerSkuItem,
      liveTitle,
      sheetIndex,
      productItems: sortedProducts
    });
  });

  return results;
}

function findColumnX(headerRow, label) {
  for (const item of headerRow.items) {
    if (item.str.includes(label)) {
      return item.transform[4];
    }
  }

  return null;
}

function findItemAtColumn(row, columnX, tolerance = 40) {
  if (columnX == null) return null;

  let best = null;
  let bestDist = Infinity;

  for (const item of row.items) {
    const dist = Math.abs(item.transform[4] - columnX);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }

  return best;
}

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
    /([A-Z]+\s+LIVE\s*-\s*AS SEEN ON SCREEN(?:\s+2)?)/i
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
