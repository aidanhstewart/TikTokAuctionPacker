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
  workbookFile: () => document.getElementById("workbookFile"),
  workbookStatus: () => document.getElementById("workbookStatus"),
  setupMode: () => document.getElementById("setupMode"),
  reloadWorkbookBtn: () => document.getElementById("reloadWorkbookBtn")
};

function setWorkbookStatus(message, variant = "empty") {
  const status = els.workbookStatus();
  status.textContent = message;
  status.className = "status";
  if (variant) status.classList.add(variant);
}

function renderSetupMode(stored) {
  const setup = getSetupStatus(stored);
  const box = els.setupMode();
  box.classList.toggle("ready", setup.ready);

  if (setup.mode === "workbook") {
    box.textContent = `Ready: workbook mode (${setup.label})`;
    return;
  }

  if (setup.mode === "legacy-links") {
    box.textContent = "Ready: legacy Google Sheet links (no workbook loaded)";
    return;
  }

  box.textContent = "Not ready: upload a workbook or save Live 1 + Live 2 sheet links";
}

function renderWorkbookStatus(stored) {
  if (!hasWorkbookMaps(stored)) {
    setWorkbookStatus("No workbook loaded.", "empty");
    els.reloadWorkbookBtn().disabled = true;
    return;
  }

  const message = formatWorkbookStatusSummary({
    fileName: stored.workbookFileName || "Saved workbook",
    maps: stored.workbookMaps,
    warnings: stored.workbookWarnings || [],
    updatedAt: stored.workbookUpdatedAt || null
  });

  const variant =
    stored.workbookWarnings && stored.workbookWarnings.length > 0
      ? "warn"
      : "";

  setWorkbookStatus(message, variant);
  els.reloadWorkbookBtn().disabled = false;
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
    workbookWarnings: result.warnings
  });

  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  renderWorkbookStatus(stored);
  renderSetupMode(stored);
}

async function loadPopupState() {
  const stored = await chrome.storage.local.get(getSheetStorageKeys());
  const urls = getStoredSheetUrls(stored);

  SHEET_INPUT_IDS.forEach((id, i) => {
    document.getElementById(id).value = urls[i] || "";
  });

  renderWorkbookStatus(stored);
  renderSetupMode(stored);
}

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
  alert("Google Sheet links saved. These are only used when no workbook is loaded.");
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
