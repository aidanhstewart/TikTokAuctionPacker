// sheetUtils.js - shared storage, sheet loading, and live detection

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const MAX_LEGACY_SHEET_URLS = 6;

const SHEET_URL_KEYS = Array.from(
  { length: MAX_LEGACY_SHEET_URLS },
  (_, i) => `sheetUrl${i + 1}`
);

const WORKBOOK_STORAGE_KEYS = [
  "workbookMaps",
  "workbookFileName",
  "workbookUpdatedAt",
  "workbookWarnings",
  "workbookItemChecks"
];

const SPREADSHEET_STORAGE_KEYS = [
  "spreadsheetUrl",
  "spreadsheetLastStatus"
];

function getSheetStorageKeys() {
  return [
    ...SHEET_URL_KEYS,
    "sheetUrl",
    ...WORKBOOK_STORAGE_KEYS,
    ...SPREADSHEET_STORAGE_KEYS
  ];
}

function getStoredSheetUrls(stored) {
  return SHEET_URL_KEYS.map((key, i) => {
    if (i === 0) {
      return stored.sheetUrl1 || stored.sheetUrl || "";
    }
    return stored[key] || "";
  });
}

function hasWorkbookMaps(stored) {
  return Boolean(
    stored?.workbookMaps && Object.keys(stored.workbookMaps).length > 0
  );
}

function hasLegacySheetUrls(stored) {
  const urls = getStoredSheetUrls(stored || {});
  return Boolean(urls[0] && urls[1]);
}

function hasSpreadsheetUrl(stored) {
  return Boolean(stored?.spreadsheetUrl?.trim());
}

// ---------------------------------------------------------------------------
// Sale / product normalization
// ---------------------------------------------------------------------------

function normalizeSaleNumber(value) {
  if (value == null || value === "") return "";

  return String(value)
    .replace(/^\ufeff/, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function normalizeProductName(value) {
  if (value == null) return "";

  return String(value)
    .replace(/\r/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function rowsToSaleMap(rows) {
  const map = {};
  let skippedRows = 0;

  rows.slice(1).forEach(row => {
    if (!row || !row.length) return;

    const saleNumber = normalizeSaleNumber(row[0]);
    const productName = normalizeProductName(row[1]);

    if (!saleNumber && !productName) return;

    if (!saleNumber || !productName) {
      skippedRows += 1;
      return;
    }

    map[saleNumber] = productName;
  });

  return { map, skippedRows };
}

function countMapRows(maps) {
  const counts = {};
  for (const [index, map] of Object.entries(maps || {})) {
    counts[index] = Object.keys(map).length;
  }
  return counts;
}

function hasCellValue(value) {
  return normalizeProductName(value) !== "";
}

function hasItemCheckValue(value) {
  if (value == null) return false;
  if (typeof value === "boolean") return value === true;

  const normalized = normalizeProductName(value).toUpperCase();
  if (!normalized) return false;
  if (normalized === "FALSE" || normalized === "0" || normalized === "NO") {
    return false;
  }

  return true;
}

function detectItemCheckColumnInfo(rows) {
  const defaultInfo = { columnIndex: 2, headerRowIndex: 0 };

  if (!rows?.length) return defaultInfo;

  for (
    let headerRowIndex = 0;
    headerRowIndex < Math.min(5, rows.length);
    headerRowIndex++
  ) {
    const headerRow = rows[headerRowIndex] || [];

    for (let columnIndex = 0; columnIndex < headerRow.length; columnIndex++) {
      const label = normalizeProductName(headerRow[columnIndex]).toUpperCase();

      if (
        label === "CHECK" ||
        /^CHECK\b/.test(label) ||
        label.includes("ITEM CHECK")
      ) {
        return { columnIndex, headerRowIndex };
      }
    }
  }

  return defaultInfo;
}

function getRowCell(row, columnIndex) {
  if (row == null) return "";
  if (Array.isArray(row)) return row[columnIndex] ?? "";
  return row[columnIndex] ?? "";
}

function findColumnCheckRows(rows, columnIndex = 2, headerRowIndex = 0) {
  const hits = [];

  rows.forEach((row, i) => {
    if (i <= headerRowIndex) return;

    if (hasItemCheckValue(getRowCell(row, columnIndex))) {
      hits.push(i + 1);
    }
  });

  return hits;
}

function mergeItemCheckEntries(existing, additions) {
  const bySheet = new Map();

  for (const entry of [...(existing || []), ...(additions || [])]) {
    const key = entry.sheet;
    const prev = bySheet.get(key) || {
      sheet: entry.sheet,
      liveIndex: entry.liveIndex,
      rows: []
    };

    prev.rows = [...new Set([...prev.rows, ...(entry.rows || [])])].sort(
      (a, b) => a - b
    );
    prev.liveIndex = prev.liveIndex ?? entry.liveIndex;
    bySheet.set(key, prev);
  }

  return Array.from(bySheet.values()).filter(entry => entry.rows.length > 0);
}

function formatRowList(rows) {
  if (rows.length === 1) {
    return `row ${rows[0]}`;
  }

  return `rows ${rows.join(", ")}`;
}

function formatItemCheckEntry(entry) {
  const liveLabel =
    entry.liveIndex != null ? ` (Live ${entry.liveIndex})` : "";
  return `Sheet "${entry.sheet}"${liveLabel}: ${formatRowList(entry.rows)}`;
}

function formatItemChecksForLog(itemChecks) {
  const entries = Array.isArray(itemChecks)
    ? itemChecks
    : itemChecks
      ? [itemChecks]
      : [];

  if (!entries.length) {
    return "none";
  }

  return entries.map(formatItemCheckEntry).join(" | ");
}

function formatItemCheckBlockMessage(itemChecks) {
  const lines = [
    "Item checks are required before continuing.",
    "",
    "Clear column C (CHECK column) on these rows, then save your sheet and reopen the PDF:",
    ""
  ];

  itemChecks.forEach(entry => {
    lines.push(`- ${formatItemCheckEntry(entry)}`);
  });

  lines.push("");
  lines.push("The CHECK column must be empty before packing.");

  return lines.join("\n");
}

function hasPendingItemChecks(stored) {
  if (hasSpreadsheetUrl(stored)) {
    return Boolean(stored?.spreadsheetLastStatus?.itemChecks?.length);
  }
  return Boolean(stored?.workbookItemChecks?.length);
}

// ---------------------------------------------------------------------------
// Workbook tab mapping
// ---------------------------------------------------------------------------

function liveIndexFromTabName(name, positionIndex) {
  const trimmed = String(name || "").trim();
  const patterns = [/(?:live|screen)\s*[-_]?\s*(\d+)/i, /^(\d+)$/];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return parseInt(match[1], 10);
  }

  return positionIndex;
}

function isIgnoredWorkbookTab(tabName) {
  return /COST/i.test(String(tabName || ""));
}

function filterIgnoredTabItemChecks(itemChecks) {
  return (itemChecks || []).filter(
    entry => !isIgnoredWorkbookTab(entry.sheet)
  );
}

function mergeTabIntoMaps(maps, liveIndex, tabMap, warnings, tabName) {
  if (maps[liveIndex]) {
    warnings.push(
      `Tab "${tabName}" also maps to Live ${liveIndex}; rows were merged.`
    );
  }
  maps[liveIndex] = { ...(maps[liveIndex] || {}), ...tabMap };
}

function buildWorkbookParseResult(tabReports) {
  const maps = {};
  const warnings = [];
  const loadedTabs = [];
  const skippedTabs = [];
  const itemChecks = [];

  tabReports.forEach(report => {
    if (report.itemCheckRows?.length) {
      itemChecks.push({
        sheet: report.tabName,
        liveIndex: report.liveIndex,
        rows: report.itemCheckRows
      });
    }

    if (report.status === "loaded") {
      loadedTabs.push(report);
      mergeTabIntoMaps(maps, report.liveIndex, report.map, warnings, report.tabName);
      if (report.skippedRows > 0) {
        warnings.push(
          `Tab "${report.tabName}": skipped ${report.skippedRows} row(s) missing sale # or product name.`
        );
      }
      return;
    }

    skippedTabs.push(report);
    warnings.push(`Tab "${report.tabName}": ${report.reason}`);
  });

  return {
    maps,
    warnings,
    loadedTabs,
    skippedTabs,
    itemChecks,
    liveCount: Object.keys(maps).length
  };
}

function formatWorkbookStatusSummary({
  fileName,
  maps,
  warnings = [],
  updatedAt = null
}) {
  const lines = [];
  const liveCount = Object.keys(maps).length;
  const rowSummary = Object.entries(maps)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([index, map]) => `Live ${index}: ${Object.keys(map).length}`)
    .join(" | ");

  lines.push(`${fileName} - ${liveCount} live tab(s)`);
  if (rowSummary) lines.push(rowSummary);

  if (updatedAt) {
    lines.push(`Updated: ${new Date(updatedAt).toLocaleString()}`);
  }

  if (warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    warnings.slice(0, 5).forEach(warning => lines.push(`- ${warning}`));
    if (warnings.length > 5) {
      lines.push(`- ...and ${warnings.length - 5} more`);
    }
  }

  return lines.join("\n");
}

function formatSpreadsheetStatusSummary({
  rowCounts = {},
  warnings = [],
  updatedAt = null
}) {
  const lines = [];
  const liveCount = Object.keys(rowCounts).length;
  const rowSummary = Object.entries(rowCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([index, count]) => `Live ${index}: ${count}`)
    .join(" | ");

  lines.push(`Google Sheet - ${liveCount} live tab(s) (refreshes on each PDF)`);
  if (rowSummary) lines.push(rowSummary);

  if (updatedAt) {
    lines.push(`Last checked: ${new Date(updatedAt).toLocaleString()}`);
  }

  if (warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    warnings.slice(0, 5).forEach(warning => lines.push(`- ${warning}`));
    if (warnings.length > 5) {
      lines.push(`- ...and ${warnings.length - 5} more`);
    }
  }

  return lines.join("\n");
}

function getSetupStatus(stored) {
  if (hasSpreadsheetUrl(stored)) {
    if (hasPendingItemChecks(stored)) {
      return {
        mode: "spreadsheet-blocked",
        ready: false,
        label: "Item checks required in column C"
      };
    }
    return {
      mode: "spreadsheet",
      ready: true,
      label: "Google Sheet (live)"
    };
  }

  if (hasWorkbookMaps(stored) && hasPendingItemChecks(stored)) {
    return {
      mode: "workbook-blocked",
      ready: false,
      label: "Item checks required in column C"
    };
  }

  if (hasWorkbookMaps(stored)) {
    return {
      mode: "workbook",
      ready: true,
      label: stored.workbookFileName || "Saved workbook"
    };
  }

  if (hasLegacySheetUrls(stored)) {
    return {
      mode: "legacy-links",
      ready: true,
      label: "Google Sheet links"
    };
  }

  return {
    mode: "none",
    ready: false,
    label: "No product data loaded"
  };
}

// ---------------------------------------------------------------------------
// Live / screen detection (from PDF text)
// ---------------------------------------------------------------------------

function detectScreenNumber(allText, lastLine) {
  const liveMatch = allText.match(/LIVE\s*-\s*AS SEEN ON SCREEN\s+(\d+)\b/i);
  if (liveMatch) return parseInt(liveMatch[1], 10);

  const linePatterns = [/^SCREEN\s*(\d+)$/i, /^ON\s+SCREEN\s*(\d+)$/i];
  for (const pattern of linePatterns) {
    const match = lastLine.match(pattern);
    if (match) return parseInt(match[1], 10);
  }

  if (
    /\bSCREEN\s+(\d+)\b/i.test(allText) &&
    /\b(LIVE|AS\s+SEEN\s+ON)\b/i.test(allText)
  ) {
    const match = allText.match(/\bSCREEN\s+(\d+)\b/i);
    if (match) return parseInt(match[1], 10);
  }

  return null;
}

function getLiveSheetIndex(liveTitle, productLines) {
  const lines = (productLines || []).map(line =>
    line.replace(/\s+/g, " ").trim()
  );
  const allText = [liveTitle, ...lines]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const lastLine = lines[lines.length - 1] || "";

  const screenNumber = detectScreenNumber(allText, lastLine);
  if (screenNumber != null) return screenNumber;

  if (/LIVE\s*-\s*AS SEEN ON SCREEN\b/i.test(allText)) return 1;
  if (/LIVE\s*-\s*AS SEEN\b/i.test(allText)) return 1;

  return 1;
}

// ---------------------------------------------------------------------------
// Google Sheet live workbook (entire document as xlsx)
// ---------------------------------------------------------------------------

function normalizeSpreadsheetExportUrl(url) {
  if (!url) return "";

  const trimmed = url.trim();

  if (/format=xlsx|output=xlsx/i.test(trimmed)) {
    return trimmed;
  }

  const publishedMatch = trimmed.match(
    /^(https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^/]+)\/pub/i
  );
  if (publishedMatch) {
    return `${publishedMatch[1]}/pub?output=xlsx`;
  }

  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch || idMatch[1] === "e") {
    return trimmed;
  }

  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=xlsx`;
}

function extractSpreadsheetId(url) {
  const trimmed = (url || "").trim();
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return idMatch && idMatch[1] !== "e" ? idMatch[1] : null;
}

const spreadsheetFetchCache = {
  url: "",
  buffer: null,
  expiresAt: 0,
  promise: null
};

const SPREADSHEET_FETCH_CACHE_MS = 8000;

function scanItemCheckRowsFromCsvText(csv) {
  const rows = csvTextToRows(csv);
  const headerInfo = detectItemCheckColumnInfo(rows);
  return findColumnCheckRows(
    rows,
    headerInfo.columnIndex,
    headerInfo.headerRowIndex
  );
}

function isXlsxBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function fetchSpreadsheetXlsx(url) {
  const exportUrl = normalizeSpreadsheetExportUrl(url);
  const now = Date.now();

  if (
    spreadsheetFetchCache.buffer &&
    spreadsheetFetchCache.url === exportUrl &&
    now < spreadsheetFetchCache.expiresAt
  ) {
    return spreadsheetFetchCache.buffer;
  }

  if (spreadsheetFetchCache.promise && spreadsheetFetchCache.url === exportUrl) {
    return spreadsheetFetchCache.promise;
  }

  spreadsheetFetchCache.url = exportUrl;
  spreadsheetFetchCache.promise = (async () => {
    const separator = exportUrl.includes("?") ? "&" : "?";
    const fetchUrl = `${exportUrl}${separator}_=${Date.now()}`;
    const response = await fetch(fetchUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`SPREADSHEET_FETCH_FAILED:${response.status}`);
    }

    const buffer = await response.arrayBuffer();

    if (!isXlsxBuffer(buffer)) {
      throw new Error("SPREADSHEET_NOT_ACCESSIBLE");
    }

    spreadsheetFetchCache.buffer = buffer;
    spreadsheetFetchCache.expiresAt = Date.now() + SPREADSHEET_FETCH_CACHE_MS;
    spreadsheetFetchCache.promise = null;

    return buffer;
  })();

  try {
    return await spreadsheetFetchCache.promise;
  } catch (err) {
    spreadsheetFetchCache.promise = null;
    throw err;
  }
}

function formatSpreadsheetFetchError(err) {
  if (err?.message === "SPREADSHEET_NOT_ACCESSIBLE") {
    return [
      "Could not read that Google Sheet.",
      "",
      "Make sure the sheet is shared as:",
      "Anyone with the link can view",
      "",
      "Then paste the normal spreadsheet link from your browser."
    ].join("\n");
  }

  if (err?.message?.startsWith("SPREADSHEET_FETCH_FAILED:")) {
    const status = err.message.split(":")[1];
    if (status === "429") {
      return [
        "Google temporarily rate-limited sheet downloads.",
        "",
        "Wait about a minute, then try again.",
        "Avoid opening the popup and PDF at the same time repeatedly."
      ].join("\n");
    }
    return `Could not download the Google Sheet (HTTP ${status}). Check the link and sharing settings.`;
  }

  return String(err?.message || err);
}

// ---------------------------------------------------------------------------
// Google Sheet CSV loading (legacy fallback)
// ---------------------------------------------------------------------------

function normalizeSheetUrl(url) {
  if (!url) return url;

  const trimmed = url.trim();

  if (/output=csv|format=csv/i.test(trimmed)) {
    return trimmed;
  }

  const publishedMatch = trimmed.match(
    /^(https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^/]+)\/pub/i
  );
  if (publishedMatch) {
    return `${publishedMatch[1]}/pub?output=csv`;
  }

  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch || idMatch[1] === "e") {
    return trimmed;
  }

  let gid = "0";
  const gidMatch = trimmed.match(/[#&?]gid=(\d+)/);
  if (gidMatch) {
    gid = gidMatch[1];
  }

  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
}

function parseCsvLine(line) {
  const cols = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  cols.push(current);
  return cols;
}

function csvTextToRows(csv) {
  return csv.split(/\r?\n/).map(row => parseCsvLine(row));
}

function csvTextToSaleMap(csv) {
  return rowsToSaleMap(csvTextToRows(csv)).map;
}

async function fetchSheetCsv(url) {
  if (!url) return null;

  const csvUrl = normalizeSheetUrl(url);
  const response = await fetch(csvUrl);

  if (!response.ok) {
    console.warn("[TikTokPacker] Sheet fetch failed:", csvUrl, response.status);
    return null;
  }

  const csv = await response.text();

  if (csv.trimStart().startsWith("<")) {
    console.warn(
      "[TikTokPacker] Sheet URL returned HTML, not CSV. Use a published CSV link or shareable sheet URL:",
      csvUrl
    );
    return null;
  }

  return csv;
}

async function scanLegacyUrlsForItemChecks(urls) {
  const checks = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;

    const csv = await fetchSheetCsv(url);
    if (!csv) continue;

    const rows = csvTextToRows(csv);
    const headerInfo = detectItemCheckColumnInfo(rows);
    const itemCheckRows = findColumnCheckRows(
      rows,
      headerInfo.columnIndex,
      headerInfo.headerRowIndex
    );

    if (itemCheckRows.length > 0) {
      checks.push({
        sheet: `Live ${i + 1} sheet`,
        liveIndex: i + 1,
        rows: itemCheckRows
      });
    }
  }

  return checks;
}

async function fetchSheetData(url) {
  const csv = await fetchSheetCsv(url);
  if (!csv) return {};
  return csvTextToSaleMap(csv);
}

async function loadSheetMapsFromUrls(sheetUrls) {
  const urls = (Array.isArray(sheetUrls) ? sheetUrls : [sheetUrls]).filter(
    Boolean
  );

  if (urls.length === 0) {
    return {};
  }

  const paddedUrls = [...urls];
  while (paddedUrls.length < 2) {
    paddedUrls.push("");
  }

  const results = await Promise.all(
    paddedUrls.map((url, i) => {
      if (i < 2 || url) return fetchSheetData(url);
      return Promise.resolve({});
    })
  );

  const maps = {};
  const logCounts = {};

  results.forEach((map, i) => {
    const index = i + 1;
    maps[index] = map;
    if (i < 2 || paddedUrls[i]) {
      logCounts[`live${index}`] = Object.keys(map).length;
    }
  });

  console.log("[TikTokPacker] Sheet rows loaded:", logCounts);

  if (
    Object.keys(maps[1] || {}).length === 0 &&
    Object.keys(maps[2] || {}).length === 0
  ) {
    console.warn(
      "[TikTokPacker] Live 1 and Live 2 sheets are empty. Check URLs in the extension popup."
    );
  }

  return maps;
}

// ---------------------------------------------------------------------------
// Lookup + resolution
// ---------------------------------------------------------------------------

function lookupProduct(maps, sheetIndex, saleNumber) {
  const key = normalizeSaleNumber(saleNumber);
  return (maps[sheetIndex] || {})[key] || null;
}

function findSheetIndicesForSale(maps, saleNumber) {
  const key = normalizeSaleNumber(saleNumber);
  const indices = [];

  for (const [index, map] of Object.entries(maps || {})) {
    if ((map || {})[key]) {
      indices.push(Number(index));
    }
  }

  return indices.sort((a, b) => a - b);
}

function resolveSheetIndexForSale(maps, saleNumber, detectedIndex) {
  const matches = findSheetIndicesForSale(maps, saleNumber);

  if (matches.length === 0) {
    return detectedIndex;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.includes(detectedIndex)) {
    return detectedIndex;
  }

  return matches[0];
}

async function getPendingItemChecks(stored) {
  const data = await loadSheetDataFromStorage(stored);
  return data?.itemChecks || [];
}

async function assertNoPendingItemChecks(stored) {
  const itemChecks = await getPendingItemChecks(stored);
  if (itemChecks.length > 0) {
    const err = new Error("ITEM_CHECKS_REQUIRED");
    err.itemChecks = itemChecks;
    throw err;
  }
}

async function resolveSheetMaps(stored) {
  const data = await loadSheetDataFromStorage(stored);
  if (!data?.maps || Object.keys(data.maps).length === 0) {
    return null;
  }
  return data.maps;
}

function getMissingSetupMessage() {
  return [
    "No product data is loaded.",
    "",
    "Open the extension popup and either:",
    "1. Paste your Google Sheets link (recommended, live updates), or",
    "2. Upload an Excel workbook (.xlsx), or",
    "3. Save Live 1 and Live 2 Google Sheet links (legacy fallback).",
    "",
    "Sheet format: each tab = one live, column A = sale #, column B = product name."
  ].join("\n");
}
