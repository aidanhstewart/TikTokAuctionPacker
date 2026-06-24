// workbookParser.js - parse Excel workbooks (requires XLSX)

function getSheetCellValue(cell) {
  if (!cell) return "";
  if (cell.t === "b") return cell.v === true ? "TRUE" : "";
  if (cell.v === 0) return "0";
  if (cell.v != null && String(cell.v).trim() !== "") return cell.v;
  if (cell.w != null && String(cell.w).trim() !== "") return cell.w;
  return "";
}

function findItemCheckRowsFromSheet(sheet, rows, headerInfo) {
  const { columnIndex, headerRowIndex } = headerInfo;
  const hits = new Set();

  findColumnCheckRows(rows, columnIndex, headerRowIndex).forEach(rowNumber => {
    hits.add(rowNumber);
  });

  if (sheet && typeof XLSX !== "undefined") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    scanItemCheckRowsFromCsvText(csv).forEach(rowNumber => {
      hits.add(rowNumber);
    });
  }

  if (!sheet) {
    return Array.from(hits).sort((a, b) => a - b);
  }

  for (const addr of Object.keys(sheet)) {
    if (addr[0] === "!") continue;

    let decoded;
    try {
      decoded = XLSX.utils.decode_cell(addr);
    } catch {
      continue;
    }

    if (decoded.c !== columnIndex || decoded.r <= headerRowIndex) continue;

    if (hasItemCheckValue(getSheetCellValue(sheet[addr]))) {
      hits.add(decoded.r + 1);
    }
  }

  if (sheet["!ref"]) {
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const firstDataRow = Math.max(range.s.r, headerRowIndex + 1);

    for (let r = firstDataRow; r <= range.e.r; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: columnIndex })];
      if (hasItemCheckValue(getSheetCellValue(cell))) {
        hits.add(r + 1);
      }
    }
  }

  return Array.from(hits).sort((a, b) => a - b);
}

function parseWorkbookBuffer(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellText: true,
    cellDates: true
  });
  const tabReports = [];
  const itemCheckEntries = [];
  let liveTabPosition = 0;

  workbook.SheetNames.forEach(tabName => {
    if (isIgnoredWorkbookTab(tabName)) {
      return;
    }

    const sheet = workbook.Sheets[tabName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false
    });
    const headerInfo = detectItemCheckColumnInfo(rows);
    const itemCheckRows = findItemCheckRowsFromSheet(sheet, rows, headerInfo);

    if (itemCheckRows.length > 0) {
      itemCheckEntries.push({
        sheet: tabName,
        liveIndex: null,
        rows: itemCheckRows
      });
    }

    liveTabPosition += 1;

    const liveIndex = liveIndexFromTabName(tabName, liveTabPosition);
    const { map, skippedRows } = rowsToSaleMap(rows);

    if (itemCheckRows.length > 0) {
      const entry = itemCheckEntries[itemCheckEntries.length - 1];
      entry.liveIndex = liveIndex;
    }

    if (Object.keys(map).length === 0) {
      tabReports.push({
        tabName,
        status: "skipped",
        reason: "no valid product rows (need column A = sale #, column B = product name)",
        liveIndex,
        skippedRows,
        itemCheckRows
      });
      return;
    }

    tabReports.push({
      tabName,
      status: "loaded",
      liveIndex,
      map,
      skippedRows,
      itemCheckRows,
      rowCount: Object.keys(map).length
    });
  });

  const result = buildWorkbookParseResult(tabReports);
  result.itemChecks = filterIgnoredTabItemChecks(
    mergeItemCheckEntries(itemCheckEntries, result.itemChecks || [])
  );

  return result;
}

async function loadSheetDataFromStorage(stored) {
  const data =
    stored || (await chrome.storage.local.get(getSheetStorageKeys()));

  if (hasSpreadsheetUrl(data)) {
    const buffer = await fetchSpreadsheetXlsx(data.spreadsheetUrl);
    const result = parseWorkbookBuffer(buffer);

    if (result.itemChecks?.length) {
      console.log(
        `[TikTokPacker] Item checks pending: ${formatItemChecksForLog(result.itemChecks)}`
      );
    } else {
      console.log(
        "[TikTokPacker] Live Google Sheet loaded",
        countMapRows(result.maps)
      );
    }

    return { ...result, source: "spreadsheet" };
  }

  if (hasWorkbookMaps(data)) {
    console.log(
      "[TikTokPacker] Using saved workbook",
      data.workbookFileName || "(saved)",
      countMapRows(data.workbookMaps)
    );
    return {
      maps: data.workbookMaps,
      itemChecks: data.workbookItemChecks || [],
      warnings: data.workbookWarnings || [],
      liveCount: Object.keys(data.workbookMaps).length,
      source: "workbook"
    };
  }

  const urls = getStoredSheetUrls(data);
  if (!urls[0] || !urls[1]) {
    return null;
  }

  const maps = await loadSheetMapsFromUrls(urls);
  const itemChecks = await scanLegacyUrlsForItemChecks(urls);

  return {
    maps,
    itemChecks,
    warnings: [],
    liveCount: Object.keys(maps).length,
    source: "legacy"
  };
}
