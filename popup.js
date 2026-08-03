// popup.js

const SETTINGS_FIELDS = {
  liveTitleScreenKeyword: { type: "text", path: ["liveTitle", "screenKeyword"] },
  strictLiveMatching: { type: "checkbox", path: ["lookup", "strictLiveMatching"] },
  workbookUseCustomColumns: { type: "checkbox", path: ["workbook", "useCustomColumns"] },
  saleColumn: { type: "text", path: ["workbook", "saleColumn"] },
  productColumn: { type: "text", path: ["workbook", "productColumn"] },
  itemCheckColumn: { type: "text", path: ["workbook", "itemCheckColumn"] },
  headerRows: { type: "number", path: ["workbook", "headerRows"] },
  ignoreTabPattern: { type: "text", path: ["workbook", "ignoreTabPattern"] },
  showLivePrefix: { type: "checkbox", path: ["overlay", "showLivePrefix"] },
  livePrefixFormat: { type: "text", path: ["overlay", "livePrefixFormat"] },
  noMatchText: { type: "text", path: ["overlay", "noMatchText"] },
  printerUseCustom: { type: "checkbox", path: ["printer", "useCustom"] },
  labelWidthIn: { type: "number", path: ["printer", "widthIn"] },
  labelHeightIn: { type: "number", path: ["printer", "heightIn"] },
  labelDpi: { type: "number", path: ["printer", "dpi"] },
  renderScale: { type: "number", path: ["printer", "renderScale"] },
  monoThreshold: { type: "number", path: ["printer", "monoThreshold"] },
  printHint: { type: "text", path: ["printer", "printHint"] },
  pdfUseCustom: { type: "checkbox", path: ["pdf", "useCustom"] },
  rowYTolerance: { type: "number", path: ["pdf", "rowYTolerance"] },
  sellerSkuXTolerance: { type: "number", path: ["pdf", "sellerSkuXTolerance"] },
  redirectEnabled: { type: "checkbox", path: ["redirect", "enabled"] },
  redirectHostPattern: { type: "text", path: ["redirect", "hostPattern"] },
  redirectExtraUrlContains: { type: "text", path: ["redirect", "extraUrlContains"] },
  redirectLocalPdfs: { type: "checkbox", path: ["redirect", "interceptLocalPdfs"] },
  itemChecksEnabled: { type: "checkbox", path: ["itemChecks", "enabled"] },
  itemChecksBlockPacking: { type: "checkbox", path: ["itemChecks", "blockPacking"] },
  debugMode: { type: "checkbox", path: ["debug"] }
};

const els = {
  mainView: document.getElementById("mainView"),
  settingsView: document.getElementById("settingsView"),
  openSettingsBtn: document.getElementById("openSettingsBtn"),
  backBtn: document.getElementById("backBtn"),
  sourceSpreadsheetBtn: document.getElementById("sourceSpreadsheetBtn"),
  sourceWorkbookBtn: document.getElementById("sourceWorkbookBtn"),
  spreadsheetPanel: document.getElementById("spreadsheetPanel"),
  workbookPanel: document.getElementById("workbookPanel"),
  spreadsheetUrl: document.getElementById("spreadsheetUrl"),
  saveSpreadsheetBtn: document.getElementById("saveSpreadsheetBtn"),
  reloadSpreadsheetBtn: document.getElementById("reloadSpreadsheetBtn"),
  clearSpreadsheetBtn: document.getElementById("clearSpreadsheetBtn"),
  workbookFile: document.getElementById("workbookFile"),
  workbookStatus: document.getElementById("workbookStatus"),
  setupMode: document.getElementById("setupMode"),
  reloadWorkbookBtn: document.getElementById("reloadWorkbookBtn"),
  clearWorkbookBtn: document.getElementById("clearWorkbookBtn"),
  exportConfigBtn: document.getElementById("exportConfigBtn"),
  importConfigBtn: document.getElementById("importConfigBtn"),
  importConfigFile: document.getElementById("importConfigFile"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  resetSettingsBtn: document.getElementById("resetSettingsBtn")
};

let popupBusy = false;

function setPopupBusy(isBusy) {
  popupBusy = isBusy;
  els.saveSpreadsheetBtn.disabled = isBusy;
  els.clearSpreadsheetBtn.disabled = isBusy;
  els.clearWorkbookBtn.disabled = isBusy;
  els.exportConfigBtn.disabled = isBusy;
  els.importConfigBtn.disabled = isBusy;
  els.saveSettingsBtn.disabled = isBusy;
  els.resetSettingsBtn.disabled = isBusy;
  if (isBusy) {
    els.reloadWorkbookBtn.disabled = true;
    els.reloadSpreadsheetBtn.disabled = true;
  }
}

function setWorkbookStatus(message, variant = "empty") {
  els.workbookStatus.textContent = message;
  els.workbookStatus.className = "status" + (variant ? ` ${variant}` : "");
}

function getSettingValueAtPath(settings, path) {
  let current = settings;
  for (const key of path) {
    current = current?.[key];
  }
  return current;
}

function setSettingValueAtPath(settings, path, value) {
  let current = settings;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = typeof path[i + 1] === "number" ? [] : {};
    }
    current = current[key];
  }
  current[path[path.length - 1]] = value;
}

function renderSettingsForm(settings) {
  for (const [id, field] of Object.entries(SETTINGS_FIELDS)) {
    const input = document.getElementById(id);
    if (!input) continue;

    const value = getSettingValueAtPath(settings, field.path);
    if (field.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value = value ?? "";
    }
  }

  syncSectionVisibility();
}

function readSettingsForm() {
  const settings = structuredClone(getActiveSettings());

  for (const [id, field] of Object.entries(SETTINGS_FIELDS)) {
    const input = document.getElementById(id);
    if (!input || input.disabled) continue;

    let value;
    if (field.type === "checkbox") {
      value = input.checked;
    } else if (field.type === "number") {
      value = input.value;
    } else {
      value = input.value.trim();
    }

    setSettingValueAtPath(settings, field.path, value);
  }

  return mergeSettings(settings);
}

function syncSectionVisibility() {
  document.querySelectorAll("[data-controls]").forEach(toggle => {
    const body = document.getElementById(toggle.dataset.controls);
    if (!body) return;

    const show = toggle.checked;
    body.classList.toggle("is-hidden", !show);
    body.hidden = !show;

    body.querySelectorAll("input, select, textarea").forEach(input => {
      if (input === toggle) return;
      input.disabled = !show;
    });
  });
}

function showMainView() {
  els.mainView.hidden = false;
  els.settingsView.hidden = true;
}

function showSettingsView() {
  els.mainView.hidden = true;
  els.settingsView.hidden = false;
  syncSectionVisibility();
}

function setSourceMode(mode) {
  const useSpreadsheet = mode === "spreadsheet";
  els.spreadsheetPanel.hidden = !useSpreadsheet;
  els.workbookPanel.hidden = useSpreadsheet;
  els.sourceSpreadsheetBtn.classList.toggle("active", useSpreadsheet);
  els.sourceWorkbookBtn.classList.toggle("active", !useSpreadsheet);
}

function wireSectionToggles() {
  document.querySelectorAll("[data-controls]").forEach(toggle => {
    toggle.addEventListener("change", syncSectionVisibility);
  });
}

function renderSetupMode(stored) {
  const setup = getSetupStatus(stored);
  els.setupMode.classList.toggle("ready", setup.ready);

  const itemCheckCol = getEffectiveWorkbookSettings().itemCheckColumn;
  const messages = {
    "workbook-blocked": `Blocked: item checks required in column ${itemCheckCol} before packing`,
    workbook: `Ready: ${setup.label}`,
    none: "Not ready: link a Google Sheet or upload a workbook"
  };

  els.setupMode.textContent = messages[setup.mode] || messages.none;
}

function renderWorkbookStatus(stored) {
  if (!hasWorkbookMaps(stored)) {
    setWorkbookStatus("No product data loaded.", "empty");
    els.reloadWorkbookBtn.disabled = true;
    els.reloadSpreadsheetBtn.disabled = true;
    return;
  }

  const sourceLabel = stored.spreadsheetUrl
    ? "Linked Google Spreadsheet"
    : stored.workbookFileName || "Saved workbook";

  const lines = [
    formatWorkbookStatusSummary({
      fileName: sourceLabel,
      maps: sanitizeWorkbookMaps(stored.workbookMaps),
      warnings: stored.workbookWarnings || [],
      updatedAt: stored.workbookUpdatedAt || null
    })
  ];

  if (stored.spreadsheetUrl) {
    lines.push("", "Product data refreshes automatically when you open a PDF.");
  } else if (stored.workbookFileData) {
    lines.push("", "Stored workbook refreshes automatically when you open a PDF.");
  }

  if (hasPendingItemChecks(stored)) {
    lines.push("", formatItemCheckBlockMessage(stored.workbookItemChecks));
  }

  const variant = hasPendingItemChecks(stored)
    ? "blocked"
    : stored.workbookWarnings?.length
      ? "warn"
      : "";

  setWorkbookStatus(lines.join("\n"), variant);
  els.reloadWorkbookBtn.disabled = popupBusy || Boolean(stored.spreadsheetUrl);
  els.reloadSpreadsheetBtn.disabled = popupBusy || !stored.spreadsheetUrl;
}

function formatPopupError(err) {
  if (err?.message === "STORAGE_QUOTA_EXCEEDED") {
    return getStorageQuotaMessage();
  }
  return String(err?.message || err || "Something went wrong.");
}

function getWorkbookHelpText() {
  const wb = getEffectiveWorkbookSettings();
  return [
    `Column ${wb.saleColumn} = sale #`,
    `Column ${wb.productColumn} = product name`,
    `Column ${wb.itemCheckColumn} = item checks (must be empty before packing)`,
    `${wb.headerRows} header row(s)`,
    wb.ignoreTabPattern
      ? `Tabs containing "${wb.ignoreTabPattern}" are ignored`
      : "No tab ignore pattern"
  ];
}

async function saveSettings() {
  if (popupBusy) return;

  setPopupBusy(true);
  try {
    const settings = readSettingsForm();
    await storageSet(buildSettingsPayload(settings));
    loadSettings(settings);
    renderSettingsForm(getActiveSettings());
    alert("Settings saved.");
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    renderSetupMode(stored);
  }
}

async function resetSettings() {
  if (popupBusy) return;
  if (!confirm("Reset all settings to defaults?")) return;

  setPopupBusy(true);
  try {
    const payload = buildSettingsPayload(DEFAULT_SETTINGS);
    await storageSet(payload);
    loadSettings(DEFAULT_SETTINGS);
    renderSettingsForm(getActiveSettings());
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    renderSetupMode(stored);
  }
}

async function persistWorkbookParseResult(result, meta) {
  if (result.liveCount === 0) {
    const tabDetails = (result.skippedTabs || [])
      .map(tab => `- Tab "${tab.tabName}": ${tab.reason}`)
      .slice(0, 6)
      .join("\n");

    alert(
      [
        "No product rows found.",
        "",
        "Each tab needs:",
        ...getWorkbookHelpText().map(line => `- ${line}`),
        "",
        tabDetails ? "Why tabs were skipped:\n" + tabDetails : "",
        "",
        "For Google Sheets, share the spreadsheet as 'Anyone with the link can view'."
      ].filter(Boolean).join("\n")
    );
    return false;
  }

  await storageSet({
    workbookMaps: result.maps,
    workbookFileName: meta.fileName,
    spreadsheetUrl: meta.spreadsheetUrl || "",
    workbookFileData: meta.workbookFileData || "",
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

  return true;
}

async function saveSpreadsheet(url, options = {}) {
  if (popupBusy) return;

  const trimmedUrl = String(url || "").trim();
  if (!trimmedUrl) {
    alert("Enter a Google Spreadsheet URL.");
    return;
  }

  setPopupBusy(true);
  setWorkbookStatus("Downloading spreadsheet...", "");

  try {
    loadSettings(readSettingsForm());

    const buffer = await fetchSpreadsheetWorkbookBuffer(trimmedUrl);
    const result = parseWorkbookBuffer(buffer);
    const saved = await persistWorkbookParseResult(result, {
      fileName: "Google Spreadsheet",
      spreadsheetUrl: trimmedUrl,
      workbookFileData: ""
    });

    if (saved) {
      els.spreadsheetUrl.value = trimmedUrl;
    }
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    renderWorkbookStatus(stored);
  }
}

async function saveWorkbook(file) {
  if (popupBusy) return;

  if (file.size > MAX_WORKBOOK_FILE_BYTES) {
    alert("That file is too large. Try removing unused tabs or rows, then upload again.");
    return;
  }

  setPopupBusy(true);
  setWorkbookStatus("Reading workbook...", "");

  try {
    loadSettings(readSettingsForm());

    const buffer = await file.arrayBuffer();
    const result = parseWorkbookBuffer(buffer);
    await persistWorkbookParseResult(result, {
      fileName: file.name,
      spreadsheetUrl: "",
      workbookFileData: canStoreWorkbookFileData(buffer.byteLength)
        ? arrayBufferToBase64(buffer)
        : ""
    });
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    renderWorkbookStatus(stored);
  }
}

async function loadPopupState() {
  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  loadSettings(stored);

  els.spreadsheetUrl.value = stored.spreadsheetUrl || "";

  renderSettingsForm(getActiveSettings());
  renderWorkbookStatus(stored);
  renderSetupMode(stored);

  if (stored.workbookFileData && !stored.spreadsheetUrl) {
    setSourceMode("workbook");
  } else {
    setSourceMode("spreadsheet");
  }
}

els.workbookFile.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    await saveWorkbook(file);
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    els.workbookFile.value = "";
  }
});

els.reloadWorkbookBtn.addEventListener("click", () => {
  if (!popupBusy) els.workbookFile.click();
});

els.saveSpreadsheetBtn.addEventListener("click", () => {
  saveSpreadsheet(els.spreadsheetUrl.value);
});

els.reloadSpreadsheetBtn.addEventListener("click", async () => {
  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  const url = stored.spreadsheetUrl || els.spreadsheetUrl.value.trim();
  if (!url) {
    alert("No linked spreadsheet to reload.");
    return;
  }
  saveSpreadsheet(url);
});

els.clearSpreadsheetBtn.addEventListener("click", async () => {
  if (popupBusy) return;

  setPopupBusy(true);
  try {
    await chrome.storage.local.remove(WORKBOOK_STORAGE_KEYS);
    els.workbookFile.value = "";
    els.spreadsheetUrl.value = "";
    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    renderWorkbookStatus(stored);
    renderSetupMode(stored);
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
  }
});

els.clearWorkbookBtn.addEventListener("click", async () => {
  if (popupBusy) return;

  setPopupBusy(true);
  try {
    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    if (stored.spreadsheetUrl) {
      await chrome.storage.local.remove(["workbookFileData", "workbookFileName"]);
      els.workbookFile.value = "";
    } else {
      await chrome.storage.local.remove(WORKBOOK_STORAGE_KEYS);
      els.workbookFile.value = "";
      els.spreadsheetUrl.value = "";
    }
    const updated = await chrome.storage.local.get(getSheetStorageKeys());
    renderWorkbookStatus(updated);
    renderSetupMode(updated);
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
  }
});

async function exportConfigBackup() {
  if (popupBusy) return;

  setPopupBusy(true);
  try {
    const stored = await chrome.storage.local.get(getSheetStorageKeys());
    const backup = buildConfigBackup(stored);
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `tiktok-packer-backup-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
  }
}

async function importConfigBackupFromFile(file) {
  if (popupBusy || !file) return;

  setPopupBusy(true);
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    await importConfigBackup(backup);
    await loadPopupState();
    alert("Backup imported successfully.");
  } catch (err) {
    console.error("[TikTokPacker]", err);
    alert(formatPopupError(err));
  } finally {
    setPopupBusy(false);
    els.importConfigFile.value = "";
  }
}

els.exportConfigBtn.addEventListener("click", exportConfigBackup);
els.importConfigBtn.addEventListener("click", () => els.importConfigFile.click());
els.importConfigFile.addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importConfigBackupFromFile(file);
});

els.saveSettingsBtn.addEventListener("click", saveSettings);
els.resetSettingsBtn.addEventListener("click", resetSettings);
els.openSettingsBtn.addEventListener("click", showSettingsView);
els.backBtn.addEventListener("click", showMainView);
els.sourceSpreadsheetBtn.addEventListener("click", () => setSourceMode("spreadsheet"));
els.sourceWorkbookBtn.addEventListener("click", () => setSourceMode("workbook"));

wireSectionToggles();
loadPopupState();
