// workbookParser.js - parse Excel workbooks (requires XLSX, loaded in popup only)

function parseWorkbookBuffer(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error("Workbook file is empty.");
  }

  if (arrayBuffer.byteLength > MAX_WORKBOOK_FILE_BYTES) {
    throw new Error("Workbook file is too large. Try removing unused tabs or rows.");
  }

  if (typeof XLSX === "undefined") {
    throw new Error("Excel parser failed to load. Reload the extension and try again.");
  }

  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, { type: "array" });
  } catch (err) {
    throw new Error(
      "Could not read that Excel file. Download it again as .xlsx from Google Sheets."
    );
  }

  if (!workbook?.SheetNames?.length) {
    throw new Error("That workbook has no tabs.");
  }

  const tabReports = [];
  let liveTabPosition = 0;

  workbook.SheetNames.forEach(tabName => {
    if (isIgnoredWorkbookTab(tabName)) {
      return;
    }

    liveTabPosition += 1;

    const sheet = workbook.Sheets[tabName];
    if (!sheet) {
      tabReports.push({
        tabName,
        status: "skipped",
        reason: "tab could not be read",
        liveIndex: liveTabPosition,
        skippedRows: 0,
        itemCheckRows: []
      });
      return;
    }

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const liveIndex = liveIndexFromTabName(tabName, liveTabPosition);
    const workbookSettings = getEffectiveWorkbookSettings();
    const parsed = parseTabSaleMap(rows, workbookSettings);
    const { map, skippedRows, itemCheckRows, detectedColumns } = parsed;

    if (Object.keys(map).length === 0) {
      const saleCol = workbookSettings.saleColumn;
      const productCol = workbookSettings.productColumn;
      tabReports.push({
        tabName,
        status: "skipped",
        reason: `no valid product rows (need column ${saleCol} = sale #, column ${productCol} = product name)`,
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
      rowCount: Object.keys(map).length,
      detectedColumns,
      suspiciousRowNumbers: mapLooksLikeAccidentalRowNumbers(map)
    });
  });

  return buildWorkbookParseResult(tabReports);
}

async function refreshWorkbookFromSource(stored) {
  const data = stored || (await chrome.storage.local.get(getSheetStorageKeys()));
  loadSettings(data);

  const cachedMaps = sanitizeWorkbookMaps(data.workbookMaps);
  const fallback = {
    maps: cachedMaps,
    refreshed: false,
    fromCache: true
  };

  let buffer = null;
  let fileName = data.workbookFileName || "Saved workbook";
  let spreadsheetUrl = data.spreadsheetUrl || "";
  let workbookFileData = data.workbookFileData || "";

  if (spreadsheetUrl) {
    try {
      buffer = await fetchSpreadsheetWorkbookBuffer(spreadsheetUrl);
      fileName = "Google Spreadsheet";
      workbookFileData = "";
    } catch (err) {
      console.warn("[TikTokPacker] Spreadsheet refresh failed; using cached maps.", err);
      return { ...fallback, error: err.message };
    }
  } else if (workbookFileData) {
    try {
      buffer = base64ToArrayBuffer(workbookFileData);
      spreadsheetUrl = "";
    } catch (err) {
      console.warn("[TikTokPacker] Stored workbook refresh failed; using cached maps.", err);
      return { ...fallback, error: err.message };
    }
  } else {
    return null;
  }

  try {
    const result = parseWorkbookBuffer(buffer);
    if (result.liveCount === 0) {
      console.warn("[TikTokPacker] Refresh found no product rows; using cached maps.");
      return fallback;
    }

    await storageSet({
      workbookMaps: result.maps,
      workbookFileName: fileName,
      spreadsheetUrl,
      workbookFileData,
      workbookUpdatedAt: Date.now(),
      workbookWarnings: result.warnings,
      workbookItemChecks: result.itemChecks
    });

    return {
      maps: sanitizeWorkbookMaps(result.maps),
      refreshed: true,
      fromCache: false
    };
  } catch (err) {
    console.warn("[TikTokPacker] Workbook refresh parse failed; using cached maps.", err);
    return { ...fallback, error: err.message };
  }
}

const CONFIG_BACKUP_VERSION = 1;

function buildConfigBackup(stored) {
  const data = stored || {};

  return {
    version: CONFIG_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    extensionSettings: mergeSettings(data[SETTINGS_STORAGE_KEY] || {}),
    spreadsheetUrl: data.spreadsheetUrl || "",
    workbookFileName: data.workbookFileName || "",
    workbookFileData: data.workbookFileData || "",
    workbookMaps: data.workbookMaps || null,
    workbookUpdatedAt: data.workbookUpdatedAt || null
  };
}

async function importConfigBackup(backup) {
  if (!backup || typeof backup !== "object") {
    throw new Error("Invalid backup file.");
  }

  if (backup.version !== CONFIG_BACKUP_VERSION) {
    throw new Error("Unsupported backup version.");
  }

  const payload = {
    [SETTINGS_STORAGE_KEY]: mergeSettings(backup.extensionSettings || {})
  };

  if (backup.spreadsheetUrl) payload.spreadsheetUrl = backup.spreadsheetUrl;
  if (backup.workbookFileName) payload.workbookFileName = backup.workbookFileName;
  if (backup.workbookFileData) payload.workbookFileData = backup.workbookFileData;
  if (backup.workbookMaps) payload.workbookMaps = backup.workbookMaps;
  if (backup.workbookUpdatedAt) payload.workbookUpdatedAt = backup.workbookUpdatedAt;

  await storageSet(payload);
  loadSettings(payload);
  return payload;
}

function formatDataSourceLabel(stored) {
  if (stored?.spreadsheetUrl) return "Google Spreadsheet";
  if (stored?.workbookFileName) return stored.workbookFileName;
  return "Product data";
}

function formatDataFreshnessText(stored, refreshMeta = {}) {
  const label = formatDataSourceLabel(stored);
  const updatedAt = stored?.workbookUpdatedAt;

  if (refreshMeta.fromCache && refreshMeta.error) {
    return `${label}: using cached data (refresh failed)`;
  }

  if (refreshMeta.fromCache && !updatedAt) {
    return `${label}: cached copy`;
  }

  if (updatedAt) {
    const when = new Date(updatedAt).toLocaleString();
    if (refreshMeta.refreshed === false && refreshMeta.fromCache) {
      return `${label}: cached ${when}`;
    }
    return `${label}: refreshed ${when}`;
  }

  return label;
}
