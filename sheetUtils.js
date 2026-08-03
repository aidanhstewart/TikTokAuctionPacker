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
  "workbookItemChecks",
  "spreadsheetUrl",
  "workbookFileData"
];

const SHEET_FETCH_TIMEOUT_MS = 15000;
const MAX_WORKBOOK_FILE_BYTES = 15 * 1024 * 1024;
const MAX_STORED_WORKBOOK_FILE_BYTES = 4 * 1024 * 1024;
const MAX_LIVE_TITLE_PATTERNS = 6;

const LIVE_TITLE_PATTERN_KEYS = Array.from(
  { length: MAX_LIVE_TITLE_PATTERNS },
  (_, i) => `liveTitlePattern${i + 1}`
);

function getSheetStorageKeys() {
  return [
    SETTINGS_STORAGE_KEY,
    ...SHEET_URL_KEYS,
    "sheetUrl",
    "liveTitlePatterns",
    ...LIVE_TITLE_PATTERN_KEYS,
    ...WORKBOOK_STORAGE_KEYS
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
  return Boolean(sanitizeWorkbookMaps(stored?.workbookMaps));
}

function sanitizeWorkbookMaps(maps) {
  if (!maps || typeof maps !== "object" || Array.isArray(maps)) {
    return null;
  }

  const sanitized = {};

  for (const [key, map] of Object.entries(maps)) {
    const liveIndex = Number(key);
    if (!Number.isFinite(liveIndex) || liveIndex < 1) continue;
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;

    const cleanMap = {};
    for (const [saleNumber, productName] of Object.entries(map)) {
      const sale = normalizeSaleNumber(saleNumber);
      const product = normalizeProductName(productName);
      if (sale && product) {
        cleanMap[sale] = product;
      }
    }

    if (Object.keys(cleanMap).length > 0) {
      sanitized[liveIndex] = cleanMap;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function hasLegacySheetUrls(stored) {
  const urls = getStoredSheetUrls(stored || {});
  return Boolean(urls[0] && urls[1]);
}

function spreadsheetIdFromUrl(url) {
  const trimmed = String(url || "").trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match && match[1] !== "e" ? match[1] : null;
}

function spreadsheetExportXlsxUrl(url) {
  const id = spreadsheetIdFromUrl(url);
  if (!id) return null;
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}

async function fetchSpreadsheetWorkbookBuffer(url) {
  const exportUrl = spreadsheetExportXlsxUrl(url);
  if (!exportUrl) {
    throw new Error("Invalid Google Spreadsheet URL.");
  }

  const response = await fetchWithTimeout(exportUrl);
  if (!response.ok) {
    throw new Error(
      "Could not download spreadsheet. Share it as 'Anyone with the link can view'."
    );
  }

  const buffer = await response.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Spreadsheet download was empty.");
  }

  if (buffer.byteLength > MAX_WORKBOOK_FILE_BYTES) {
    throw new Error("Spreadsheet is too large. Try removing unused tabs or rows.");
  }

  const header = new Uint8Array(buffer.slice(0, 4));
  if (header[0] === 0x3c) {
    throw new Error(
      "Spreadsheet returned a web page, not Excel data. Check the URL and sharing settings."
    );
  }

  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

function canStoreWorkbookFileData(byteLength) {
  return byteLength > 0 && byteLength <= MAX_STORED_WORKBOOK_FILE_BYTES;
}

// ---------------------------------------------------------------------------
// Sale / product normalization
// ---------------------------------------------------------------------------

const MAX_AUCTION_SALE_DIGITS = 10;

function normalizeSaleNumber(value) {
  if (value == null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    const asInt = Math.trunc(value);
    return String(asInt === value ? asInt : value);
  }

  let text = String(value)
    .replace(/^\ufeff/, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");

  text = text.replace(/^#+/, "");
  text = text.replace(/^(?:sale|lot|sku)\s*#?\s*/i, "");

  if (/^\d+\.0+$/.test(text)) {
    text = String(parseInt(text, 10));
  }

  return text.trim();
}

function isAuctionSaleNumber(value) {
  const sale = normalizeSaleNumber(value);
  if (!sale || !/^\d+$/.test(sale)) return false;
  return sale.length <= MAX_AUCTION_SALE_DIGITS;
}

function getSaleLookupCandidates(saleNumber) {
  const primary = normalizeSaleNumber(saleNumber);
  const candidates = new Set();

  if (primary) candidates.add(primary);

  const digitsOnly = primary.replace(/\D/g, "");
  if (digitsOnly) candidates.add(digitsOnly);

  if (/^\d+$/.test(primary)) {
    candidates.add(String(parseInt(primary, 10)));
  }

  return [...candidates].filter(Boolean);
}

function normalizeProductName(value) {
  if (value == null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    const asInt = Math.trunc(value);
    return String(asInt === value ? asInt : value);
  }

  return String(value)
    .replace(/\r/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function getRowCell(row, index) {
  if (row == null || index == null || index < 0) return "";

  if (Array.isArray(row)) {
    const value = row[index];
    return value == null ? "" : value;
  }

  if (typeof row === "object") {
    const value = row[index] ?? row[String(index)];
    return value == null ? "" : value;
  }

  return "";
}

function rowHasAnyCell(row) {
  if (!row) return false;

  if (Array.isArray(row)) {
    return row.some(cell => normalizeProductName(cell) !== "");
  }

  if (typeof row === "object") {
    return Object.values(row).some(cell => normalizeProductName(cell) !== "");
  }

  return false;
}

function getRowMaxIndex(row) {
  if (!row) return 0;

  if (Array.isArray(row)) {
    return Math.max(0, row.length - 1);
  }

  if (typeof row === "object") {
    const keys = Object.keys(row)
      .map(key => Number(key))
      .filter(num => Number.isFinite(num));
    return keys.length ? Math.max(...keys) : 0;
  }

  return 0;
}

function indexToColumnLetter(index) {
  let n = index + 1;
  let result = "";

  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }

  return result || "A";
}

function looksLikeSaleNumber(value) {
  const sale = normalizeSaleNumber(value);
  if (!sale) return false;
  if (/^\d+$/.test(sale)) return true;
  if (/^sale\s*#?\s*\d+$/i.test(sale)) return true;
  return /^#?\d[\w-]*$/i.test(sale) && sale.length <= 24;
}

function looksLikeProductName(value) {
  const product = normalizeProductName(value);
  if (!product || product.length < 2) return false;
  return !/^(sale|product|name|sku|item|description|qty|quantity)$/i.test(product);
}

function detectWorkbookColumns(rows) {
  const maxScanRows = Math.min(rows.length, 40);
  const saleHeader = /sale|lot|sku|item\s*#|order\s*#/i;
  const productHeader = /product|description|item\s*name|title|name/i;

  for (let headerRow = 0; headerRow < Math.min(6, maxScanRows); headerRow++) {
    const row = rows[headerRow];
    if (!rowHasAnyCell(row)) continue;

    const maxCol = getRowMaxIndex(row);
    let saleCol = -1;
    let productCol = -1;

    for (let col = 0; col <= maxCol; col++) {
      const label = normalizeProductName(getRowCell(row, col)).toLowerCase();
      if (!label) continue;
      if (saleCol < 0 && saleHeader.test(label)) saleCol = col;
      if (productCol < 0 && productHeader.test(label) && !/^sale/.test(label)) {
        productCol = col;
      }
    }

    if (saleCol >= 0 && productCol >= 0 && saleCol !== productCol) {
      return {
        saleColumn: saleCol,
        productColumn: productCol,
        itemCheckColumn: Math.min(productCol + 1, maxCol),
        headerRows: headerRow + 1
      };
    }
  }

  let best = null;
  const maxCol = rows
    .slice(0, maxScanRows)
    .reduce((highest, row) => Math.max(highest, getRowMaxIndex(row)), 0);

  for (let saleCol = 0; saleCol <= maxCol; saleCol++) {
    for (let productCol = 0; productCol <= maxCol; productCol++) {
      if (saleCol === productCol) continue;

      let valid = 0;
      let headerRows = 1;

      for (let rowIndex = 0; rowIndex < maxScanRows; rowIndex++) {
        const row = rows[rowIndex];
        if (!rowHasAnyCell(row)) continue;

        const saleNumber = normalizeSaleNumber(getRowCell(row, saleCol));
        const productName = normalizeProductName(getRowCell(row, productCol));

        if (!saleNumber || !productName) continue;
        if (!looksLikeSaleNumber(saleNumber) || !looksLikeProductName(productName)) {
          continue;
        }
        if (productName.length <= saleNumber.length && /^\d+$/.test(saleNumber)) {
          continue;
        }

        valid += 1;
        if (valid === 1) headerRows = rowIndex;
      }

      if (valid >= 2 && (!best || valid > best.valid)) {
        best = {
          saleColumn: saleCol,
          productColumn: productCol,
          itemCheckColumn: Math.min(productCol + 1, maxCol),
          headerRows,
          valid
        };
      }
    }
  }

  if (!best) return null;

  const { valid, ...columns } = best;
  return columns;
}

function rowsToSaleMap(rows, columnOverride) {
  const cols = columnOverride || getWorkbookColumnIndices();
  const map = {};
  let skippedRows = 0;

  rows.slice(cols.headerRows).forEach(row => {
    if (!rowHasAnyCell(row)) return;

    const saleNumber = normalizeSaleNumber(getRowCell(row, cols.saleColumn));
    const productName = normalizeProductName(getRowCell(row, cols.productColumn));

    if (!saleNumber && !productName) return;

    if (!saleNumber || !productName) {
      skippedRows += 1;
      return;
    }

    map[saleNumber] = productName;
  });

  return { map, skippedRows };
}

function mapLooksLikeAccidentalRowNumbers(map) {
  const keys = Object.keys(map || {})
    .map(key => normalizeSaleNumber(key))
    .filter(key => /^\d+$/.test(key))
    .map(key => parseInt(key, 10))
    .sort((a, b) => a - b);

  if (keys.length < 2) return false;

  const sequentialFromOne = keys.every((value, index) => value === index + 1);
  return sequentialFromOne && keys[0] === 1 && keys[keys.length - 1] <= 25;
}

function scoreSaleMap(map) {
  const keys = Object.keys(map || {});
  if (keys.length === 0) return -1;

  let score = keys.length * 10;
  if (mapLooksLikeAccidentalRowNumbers(map)) score -= 100;

  const numericKeys = keys
    .map(key => parseInt(normalizeSaleNumber(key), 10))
    .filter(value => Number.isFinite(value));

  if (numericKeys.length > 0 && Math.max(...numericKeys) > 20) {
    score += 20;
  }

  return score;
}

function formatSaleNumberPreview(map, limit = 4) {
  const keys = Object.keys(map || {})
    .map(key => normalizeSaleNumber(key))
    .filter(Boolean)
    .sort((a, b) => {
      const aNum = Number(a);
      const bNum = Number(b);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
        return aNum - bNum;
      }
      return String(a).localeCompare(String(b));
    });

  if (keys.length === 0) return "none";
  const preview = keys.slice(0, limit).join(", ");
  return keys.length > limit ? `${preview}, ...` : preview;
}

function parseTabSaleMap(rows, workbookSettings) {
  const buildResult = (columnConfig, detectedColumns) => {
    const parsed = rowsToSaleMap(rows, columnConfig);
    return {
      ...parsed,
      columnConfig,
      detectedColumns,
      itemCheckRows: findColumnCheckRows(rows, undefined, columnConfig)
    };
  };

  if (workbookSettings.useCustomColumns) {
    return buildResult(getWorkbookColumnIndices(), null);
  }

  const defaultConfig = getWorkbookColumnIndices();
  let best = buildResult(defaultConfig, null);
  const detected = detectWorkbookColumns(rows);

  if (detected) {
    const candidate = buildResult(detected, {
      saleColumn: indexToColumnLetter(detected.saleColumn),
      productColumn: indexToColumnLetter(detected.productColumn),
      headerRows: detected.headerRows
    });

    if (scoreSaleMap(candidate.map) > scoreSaleMap(best.map)) {
      best = candidate;
    }
  }

  if (
    mapLooksLikeAccidentalRowNumbers(best.map) &&
    detected &&
    scoreSaleMap(rowsToSaleMap(rows, detected).map) > scoreSaleMap(best.map)
  ) {
    best = buildResult(detected, {
      saleColumn: indexToColumnLetter(detected.saleColumn),
      productColumn: indexToColumnLetter(detected.productColumn),
      headerRows: detected.headerRows
    });
  }

  return best;
}

function hasCellValue(value) {
  return normalizeProductName(value) !== "";
}

function findColumnCheckRows(rows, columnIndex, columnOverride) {
  const cols = columnOverride || getWorkbookColumnIndices();
  const index = columnIndex ?? cols.itemCheckColumn;
  const hits = [];

  rows.forEach((row, i) => {
    if (i < cols.headerRows) return;
    if (!rowHasAnyCell(row)) return;

    if (hasCellValue(getRowCell(row, index))) {
      hits.push(i + 1);
    }
  });

  return hits;
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

function formatItemCheckBlockMessage(itemChecks) {
  const column = getEffectiveWorkbookSettings().itemCheckColumn;
  const lines = [
    "Item checks are required before continuing.",
    "",
    `Clear column ${column} on these rows, then reload your workbook:`,
    ""
  ];

  itemChecks.forEach(entry => {
    lines.push(`- ${formatItemCheckEntry(entry)}`);
  });

  lines.push("");
  lines.push(`Column ${column} is used for pending item checks.`);

  return lines.join("\n");
}

function hasPendingItemChecks(stored) {
  if (!getActiveSettings().itemChecks.enabled) return false;
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
  const pattern = getEffectiveWorkbookSettings().ignoreTabPattern;
  if (!pattern) return false;
  return String(tabName || "").toUpperCase().includes(pattern.toUpperCase());
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
      if (report.detectedColumns) {
        warnings.push(
          `Tab "${report.tabName}": auto-detected columns ${report.detectedColumns.saleColumn}/${report.detectedColumns.productColumn} (${report.detectedColumns.headerRows} header row(s)).`
        );
      }
      if (report.suspiciousRowNumbers) {
        warnings.push(
          `Tab "${report.tabName}": sale numbers look like row numbers (1, 2, 3...). Check that column A is the TikTok Seller SKU, not a row counter.`
        );
      }
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

  const salePreview = Object.entries(maps)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([index, map]) => `Live ${index}: ${formatSaleNumberPreview(map)}`)
    .join(" | ");

  lines.push(`${fileName} - ${liveCount} live tab(s)`);
  if (rowSummary) lines.push(rowSummary);
  if (salePreview) {
    lines.push(`Sale #s loaded: ${salePreview}`);
    lines.push("These must match the Seller SKU numbers on the packing PDF.");
  }

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

function getSetupStatus(stored) {
  if (hasWorkbookMaps(stored) && hasPendingItemChecks(stored)) {
    return {
      mode: "workbook-blocked",
      ready: false,
      label: `Item checks required in column ${getActiveSettings().workbook.itemCheckColumn}`
    };
  }

  if (hasWorkbookMaps(stored)) {
    const label = stored.spreadsheetUrl
      ? "Linked Google Spreadsheet"
      : stored.workbookFileName || "Saved workbook";
    return {
      mode: "workbook",
      ready: true,
      label
    };
  }

  if (hasLegacySheetUrls(stored)) {
    return {
      mode: "workbook",
      ready: true,
      label: "Saved product data"
    };
  }

  return {
    mode: "none",
    ready: false,
    label: "No product data loaded"
  };
}

// ---------------------------------------------------------------------------
// Live title matching (screen keyword — always on)
// ---------------------------------------------------------------------------

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleContainsScreenKeyword(text) {
  const keyword = getScreenKeyword();
  if (!keyword) return false;
  return new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i").test(String(text || ""));
}

function detectScreenNumberFromKeyword(allText, lastLine) {
  const keyword = getScreenKeyword();
  if (!keyword) return null;

  const escaped = escapeRegex(keyword);
  const numberedRegex = new RegExp(`${escaped}\\s+(\\d+)\\b`, "gi");
  let numberedMatch;
  let lastNumber = null;

  while ((numberedMatch = numberedRegex.exec(allText)) !== null) {
    lastNumber = parseInt(numberedMatch[1], 10);
  }

  if (lastNumber != null) return lastNumber;

  const trimmedLine = normalizeTitleFragment(lastLine);
  if (trimmedLine) {
    const linePatterns = [
      new RegExp(`^${escaped}\\s*(\\d+)?$`, "i"),
      new RegExp(`^ON\\s+${escaped}\\s*(\\d+)?$`, "i")
    ];

    for (const pattern of linePatterns) {
      const match = trimmedLine.match(pattern);
      if (match) return match[1] ? parseInt(match[1], 10) : 1;
    }
  }

  if (titleContainsScreenKeyword(allText)) {
    return 1;
  }

  return null;
}

function normalizeLiveSearchText(liveTitle, productLines) {
  const lines = (productLines || []).map(line =>
    String(line).replace(/\s+/g, " ").trim()
  );

  return [liveTitle, ...lines]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLiveSheetIndex(liveTitle, productLines) {
  const lines = (productLines || []).map(line =>
    String(line).replace(/\s+/g, " ").trim()
  );
  const allText = normalizeLiveSearchText(liveTitle, lines);
  const lastLine = lines[lines.length - 1] || "";

  const screenNumber = detectScreenNumberFromKeyword(allText, lastLine);
  if (screenNumber != null) return screenNumber;

  if (isStrictLiveMatchingEnabled()) {
    return null;
  }

  const trailingNumber = allText.match(/\b(\d+)\s*$/);
  if (trailingNumber) return parseInt(trailingNumber[1], 10);

  return 1;
}

function rowTitleMatchesScreenKeyword(titleText, titleLines) {
  if (titleContainsScreenKeyword(titleText)) return true;

  return (titleLines || []).some(line => {
    const value = normalizeTitleFragment(line);
    return titleContainsScreenKeyword(value) || isScreenKeywordIndicator(value);
  });
}

function normalizeTitleFragment(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isLiveTitleText(text) {
  const value = normalizeTitleFragment(text);
  if (!value) return false;
  return /LIVE\s*-/i.test(value) || titleContainsScreenKeyword(value);
}

function isMaskableLiveTitleText(text) {
  const value = normalizeTitleFragment(text);
  if (!value) return false;

  if (isScreenKeywordIndicator(value)) return false;

  return /LIVE\s*-/i.test(value) || titleContainsScreenKeyword(value);
}

function isScreenKeywordIndicator(text) {
  const keyword = getScreenKeyword();
  if (!keyword) return false;

  const value = normalizeTitleFragment(text);
  const escaped = escapeRegex(keyword);

  return (
    new RegExp(`^${escaped}\\s*\\d*$`, "i").test(value) ||
    new RegExp(`^ON\\s+${escaped}\\s*\\d*$`, "i").test(value)
  );
}

function isLegacyScreenIndicator(text) {
  return isScreenKeywordIndicator(text);
}

function getPageDefaultLiveIndex(pageText) {
  return getLiveSheetIndex(pageText, []);
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

async function fetchWithTimeout(url, timeoutMs = SHEET_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchSheetCsv(url) {
  if (!url) return null;

  const csvUrl = normalizeSheetUrl(url);

  try {
    const response = await fetchWithTimeout(csvUrl);

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
  } catch (err) {
    const reason =
      err?.name === "AbortError"
        ? "timed out"
        : String(err?.message || err);
    console.warn("[TikTokPacker] Sheet fetch error:", csvUrl, reason);
    return null;
  }
}

async function scanLegacyUrlsForItemChecks(urls) {
  const checks = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;

    const csv = await fetchSheetCsv(url);
    if (!csv) continue;

    const rows = csvTextToRows(csv);
    const itemCheckRows = findColumnCheckRows(rows);

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

  results.forEach((map, i) => {
    maps[i + 1] = map;
  });

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
  return resolveProductLookup(maps, sheetIndex, saleNumber).productName;
}

function resolveProductLookup(maps, sheetIndex, saleNumber) {
  const candidates = getSaleLookupCandidates(saleNumber);
  const resolvedIndex = Number.isFinite(sheetIndex) && sheetIndex >= 1 ? sheetIndex : null;

  if (resolvedIndex == null) {
    return { productName: null, sheetIndex: null };
  }

  for (const key of candidates) {
    const productName = (maps[resolvedIndex] || {})[key] || null;
    if (productName) {
      return { productName, sheetIndex: resolvedIndex };
    }
  }

  if (isStrictLiveMatchingEnabled()) {
    return { productName: null, sheetIndex: resolvedIndex };
  }

  const entries = Object.entries(maps || {}).sort(
    ([a], [b]) => Number(a) - Number(b)
  );

  for (const key of candidates) {
    for (const [index, map] of entries) {
      if (map[key]) {
        return { productName: map[key], sheetIndex: Number(index) };
      }
    }
  }

  return { productName: null, sheetIndex: resolvedIndex };
}

async function getPendingItemChecks(stored) {
  if (!getActiveSettings().itemChecks.enabled) return [];

  const data =
    stored || (await chrome.storage.local.get(getSheetStorageKeys()));

  if (hasWorkbookMaps(data)) {
    return data.workbookItemChecks || [];
  }

  const urls = getStoredSheetUrls(data);
  if (!urls[0] || !urls[1]) {
    return [];
  }

  return scanLegacyUrlsForItemChecks(urls);
}

async function assertNoPendingItemChecks(stored) {
  if (!getActiveSettings().itemChecks.blockPacking) return;

  const itemChecks = await getPendingItemChecks(stored);
  if (itemChecks.length > 0) {
    const err = new Error("ITEM_CHECKS_REQUIRED");
    err.itemChecks = itemChecks;
    throw err;
  }
}

async function resolveSheetMaps(stored) {
  const data =
    stored || (await chrome.storage.local.get(getSheetStorageKeys()));

  const workbookMaps = sanitizeWorkbookMaps(data.workbookMaps);
  if (workbookMaps) {
    return workbookMaps;
  }

  const urls = getStoredSheetUrls(data);
  if (!urls[0] || !urls[1]) {
    return null;
  }

  return loadSheetMapsFromUrls(urls);
}

async function storageSet(values) {
  try {
    await chrome.storage.local.set(values);
  } catch (err) {
    const message = String(err?.message || err);
    if (/quota/i.test(message)) {
      throw new Error("STORAGE_QUOTA_EXCEEDED");
    }
    throw err;
  }
}

function getStorageQuotaMessage() {
  return [
    "Chrome storage is full.",
    "",
    "Clear the saved workbook or remove unused extension data, then try again."
  ].join("\n");
}

function getMissingSetupMessage() {
  return [
    "No product data is loaded.",
    "",
    "Open the extension popup and either:",
    "1. Link a Google Spreadsheet, or",
    "2. Upload an Excel workbook (.xlsx).",
    "",
    "Workbook format: each tab = one live, column A = sale #, column B = product name."
  ].join("\n");
}
