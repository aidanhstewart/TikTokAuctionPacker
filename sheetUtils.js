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
  "workbookWarnings"
];

function getSheetStorageKeys() {
  return [...SHEET_URL_KEYS, "sheetUrl", ...WORKBOOK_STORAGE_KEYS];
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

  tabReports.forEach(report => {
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

function getSetupStatus(stored) {
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

function csvTextToSaleMap(csv) {
  const rows = csv.split(/\r?\n/);
  const dataRows = rows.map(row => parseCsvLine(row));
  return rowsToSaleMap(dataRows).map;
}

async function fetchSheetData(url) {
  if (!url) return {};

  const csvUrl = normalizeSheetUrl(url);
  const response = await fetch(csvUrl);

  if (!response.ok) {
    console.warn("[TikTokPacker] Sheet fetch failed:", csvUrl, response.status);
    return {};
  }

  const csv = await response.text();

  if (csv.trimStart().startsWith("<")) {
    console.warn(
      "[TikTokPacker] Sheet URL returned HTML, not CSV. Use a published CSV link or shareable sheet URL:",
      csvUrl
    );
    return {};
  }

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

async function resolveSheetMaps(stored) {
  const data =
    stored || (await chrome.storage.local.get(getSheetStorageKeys()));

  if (hasWorkbookMaps(data)) {
    console.log(
      "[TikTokPacker] Using workbook",
      data.workbookFileName || "(saved)",
      countMapRows(data.workbookMaps)
    );
    return data.workbookMaps;
  }

  const urls = getStoredSheetUrls(data);
  if (!urls[0] || !urls[1]) {
    return null;
  }

  return loadSheetMapsFromUrls(urls);
}

function getMissingSetupMessage() {
  return [
    "No product data is loaded.",
    "",
    "Open the extension popup and either:",
    "1. Upload your Excel workbook (.xlsx), or",
    "2. Save Live 1 and Live 2 Google Sheet links (legacy fallback).",
    "",
    "Workbook format: each tab = one live, column A = sale #, column B = product name."
  ].join("\n");
}
