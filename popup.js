// popup.js

const SHEET_INPUT_IDS = [
  "sheetUrl1",
  "sheetUrl2",
  "sheetUrl3",
  "sheetUrl4",
  "sheetUrl5",
  "sheetUrl6"
];

const els = {
  spreadsheetUrl: () => document.getElementById("spreadsheetUrl"),
  spreadsheetStatus: () => document.getElementById("spreadsheetStatus"),
  workbookFile: () => document.getElementById("workbookFile"),
  workbookStatus: () => document.getElementById("workbookStatus"),
  setupMode: () => document.getElementById("setupMode"),
  reloadWorkbookBtn: () => document.getElementById("reloadWorkbookBtn")
};

function setStatusBox(element, message, variant = "empty") {
  element.textContent = message;
  element.className = "status";
  if (variant) element.classList.add(variant);
}

function setSpreadsheetStatus(message, variant = "empty") {
  setStatusBox(els.spreadsheetStatus(), message, variant);
}

function setWorkbookStatus(message, variant = "empty") {
  setStatusBox(els.workbookStatus(), message, variant);
}

function renderSetupMode(stored) {
  const setup = getSetupStatus(stored);
  const box = els.setupMode();
  box.classList.toggle("ready", setup.ready);

  if (setup.mode === "spreadsheet-blocked") {
    box.textContent = "Blocked: item checks required in column C before packing";
    return;
  }

  if (setup.mode === "spreadsheet") {
    box.textContent = "Ready: live Google Sheet (updates on each PDF)";
    return;
  }

  if (setup.mode === "workbook-blocked") {
    box.textContent = "Blocked: item checks required in column C before packing";
    return;
  }

  if (setup.mode === "workbook") {
    box.textContent = `Ready: workbook mode (${setup.label})`;
    return;
  }

  if (setup.mode === "legacy-links") {
    box.textContent = "Ready: legacy Google Sheet links";
    return;
  }

  box.textContent = "Not ready: save a Google Sheet link or upload a workbook";
}

function renderSpreadsheetStatus(stored) {
  if (!hasSpreadsheetUrl(stored)) {
    setSpreadsheetStatus("No Google Sheet linked.", "empty");
    return;
  }

  const status = stored.spreadsheetLastStatus || {};
  const lines = [
    formatSpreadsheetStatusSummary({
      rowCounts: status.rowCounts || {},
      warnings: status.warnings || [],
      updatedAt: status.updatedAt || null
    })
  ];

  if (hasPendingItemChecks(stored)) {
    lines.push("");
    lines.push(formatItemCheckBlockMessage(status.itemChecks || []));
  }

  const variant = hasPendingItemChecks(stored)
    ? "blocked"
    : status.warnings && status.warnings.length > 0
      ? "warn"
      : "";

  setSpreadsheetStatus(lines.join("\n"), variant);
}

function renderWorkbookStatus(stored) {
  if (!hasWorkbookMaps(stored)) {
    setWorkbookStatus("No workbook loaded.", "empty");
    els.reloadWorkbookBtn().disabled = true;
    return;
  }

  const lines = [
    formatWorkbookStatusSummary({
      fileName: stored.workbookFileName || "Saved workbook",
      maps: stored.workbookMaps,
      warnings: stored.workbookWarnings || [],
      updatedAt: stored.workbookUpdatedAt || null
    })
  ];

  if (!hasSpreadsheetUrl(stored) && hasPendingItemChecks(stored)) {
    lines.push("");
    lines.push(formatItemCheckBlockMessage(stored.workbookItemChecks));
  }

  const variant =
    !hasSpreadsheetUrl(stored) && hasPendingItemChecks(stored)
      ? "blocked"
      : stored.workbookWarnings && stored.workbookWarnings.length > 0
        ? "warn"
        : "";

  setWorkbookStatus(lines.join("\n"), variant);
  els.reloadWorkbookBtn().disabled = false;
}

async function saveSpreadsheetUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) {
    alert("Paste your Google Sheets link first.");
    return;
  }

  setSpreadsheetStatus("Checking Google Sheet...", "");

  try {
    const buffer = await fetchSpreadsheetXlsx(trimmed);
    const result = parseWorkbookBuffer(buffer);

    if (result.liveCount === 0) {
      alert(
        [
          "No product rows found in that Google Sheet.",
          "",
          "Each tab needs:",
          "- Column A = sale #",
          "- Column B = product name",
          "- Row 1 = header"
        ].join("\n")
      );
      setSpreadsheetStatus("No product rows found in that sheet.", "warn");
      return;
    }

    await chrome.storage.local.set({
      spreadsheetUrl: trimmed,
      spreadsheetLastStatus: {
        liveCount: result.liveCount,
        updatedAt: Date.now(),
        warnings: result.warnings,
        itemChecks: result.itemChecks,
        rowCounts: countMapRows(result.maps)
      }
    });

    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    renderSpreadsheetStatus(stored);
    renderSetupMode(stored);

    if (result.itemChecks.length > 0) {
      alert(formatItemCheckBlockMessage(result.itemChecks));
    }
  } catch (err) {
    console.error(err);
    const message = formatSpreadsheetFetchError(err);
    setSpreadsheetStatus(message, "blocked");
    alert(message);
  }
}

async function saveWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const result = parseWorkbookBuffer(buffer);

  if (result.liveCount === 0) {
    alert(
      [
        "No product rows found.",
        "",
        "Each tab needs:",
        "- Column A = sale #",
        "- Column B = product name",
        "- Row 1 = header",
        "",
        "In Google Sheets use File > Download > Microsoft Excel (.xlsx)."
      ].join("\n")
    );
    return;
  }

  await chrome.storage.local.set({
    workbookMaps: result.maps,
    workbookFileName: file.name,
    workbookUpdatedAt: Date.now(),
    workbookWarnings: result.warnings,
    workbookItemChecks: result.itemChecks
  });

  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  renderWorkbookStatus(stored);
  renderSetupMode(stored);

  if (result.itemChecks.length > 0) {
    alert(formatItemCheckBlockMessage(result.itemChecks));
  }
}

async function refreshSpreadsheetStatus(stored) {
  if (!hasSpreadsheetUrl(stored)) return stored;

  try {
    const data = await loadSheetDataFromStorage(stored);
    if (!data) return stored;

    await chrome.storage.local.set({
      spreadsheetLastStatus: {
        liveCount: data.liveCount,
        updatedAt: Date.now(),
        warnings: data.warnings || [],
        itemChecks: data.itemChecks || [],
        rowCounts: countMapRows(data.maps)
      }
    });

    return await chrome.storage.local.get(getSheetStorageKeys());
  } catch (err) {
    console.warn("[TikTokPacker] Could not refresh spreadsheet status:", err);
    return stored;
  }
}

async function loadPopupState() {
  let stored = await chrome.storage.local.get(getSheetStorageKeys());
  const urls = getStoredSheetUrls(stored);

  els.spreadsheetUrl().value = stored.spreadsheetUrl || "";
  SHEET_INPUT_IDS.forEach((id, i) => {
    document.getElementById(id).value = urls[i] || "";
  });

  renderSpreadsheetStatus(stored);
  renderWorkbookStatus(stored);
  renderSetupMode(stored);

  const lastChecked = stored.spreadsheetLastStatus?.updatedAt || 0;
  const shouldRefresh =
    hasSpreadsheetUrl(stored) && Date.now() - lastChecked > 60000;

  if (shouldRefresh) {
    setSpreadsheetStatus("Checking CHECK column on live tabs...", "");
    stored = await refreshSpreadsheetStatus(stored);
    renderSpreadsheetStatus(stored);
    renderSetupMode(stored);
  }
}

document.getElementById("saveSpreadsheetBtn").addEventListener("click", async () => {
  await saveSpreadsheetUrl(els.spreadsheetUrl().value);
});

document.getElementById("clearSpreadsheetBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(SPREADSHEET_STORAGE_KEYS);
  els.spreadsheetUrl().value = "";
  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  renderSpreadsheetStatus(stored);
  renderSetupMode(stored);
});

document.getElementById("workbookFile").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    await saveWorkbook(file);
  } catch (err) {
    console.error(err);
    alert("Could not read that Excel file. Try downloading again as .xlsx from Google Sheets.");
  }
});

document.getElementById("reloadWorkbookBtn").addEventListener("click", () => {
  els.workbookFile().click();
});

document.getElementById("clearWorkbookBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(WORKBOOK_STORAGE_KEYS);
  els.workbookFile().value = "";
  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  renderWorkbookStatus(stored);
  renderSetupMode(stored);
});

document.getElementById("saveBtn").addEventListener("click", async () => {
  const values = {};
  for (const id of SHEET_INPUT_IDS) {
    values[id] = document.getElementById(id).value.trim();
  }

  if (!values.sheetUrl1 || !values.sheetUrl2) {
    alert("Please enter both Live 1 and Live 2 Google Sheet links.");
    return;
  }

  await chrome.storage.local.set(values);
  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  renderSetupMode(stored);
  alert("Google Sheet links saved. These are only used when no sheet link or workbook is loaded.");
});

document.getElementById("clearLinksBtn").addEventListener("click", async () => {
  const clearValues = {};
  SHEET_INPUT_IDS.forEach(id => {
    clearValues[id] = "";
    document.getElementById(id).value = "";
  });
  await chrome.storage.local.set(clearValues);
  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  renderSetupMode(stored);
});

loadPopupState();
