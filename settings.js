// settings.js — shared defaults, storage, and active runtime settings

const SETTINGS_STORAGE_KEY = "extensionSettings";

const DEFAULT_SETTINGS = {
  liveTitle: {
    screenKeyword: "SCREEN"
  },
  workbook: {
    useCustomColumns: false,
    saleColumn: "A",
    productColumn: "B",
    itemCheckColumn: "C",
    headerRows: 1,
    ignoreTabPattern: "COST"
  },
  overlay: {
    showLivePrefix: true,
    livePrefixFormat: "S{n}:",
    noMatchText: "no match"
  },
  printer: {
    useCustom: false,
    widthIn: 4,
    heightIn: 6,
    dpi: 203,
    renderScale: 2,
    monoThreshold: 165,
    printHint: "TSC: 4x6 label, scale 100%, no fit-to-page"
  },
  pdf: {
    useCustom: false,
    rowYTolerance: 6,
    sellerSkuXTolerance: 40,
    legacyTitleHint: "AS SEEN ON SCREEN"
  },
  redirect: {
    enabled: true,
    hostPattern: "tiktok",
    extraUrlContains: "oec_fulfillment_doc",
    interceptLocalPdfs: false
  },
  itemChecks: {
    enabled: true,
    blockPacking: true
  },
  lookup: {
    strictLiveMatching: false
  },
  debug: false
};

let activeSettings = structuredClone(DEFAULT_SETTINGS);

function structuredClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clampNumber(value, min, max, fallback) {
  if (value === "" || value == null) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeColumnLetter(value, fallback) {
  const letter = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return letter || fallback;
}

function normalizeString(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeBool(value, fallback) {
  if (value === true || value === false) return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function mergeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const liveTitle = input.liveTitle || {};
  const workbook = input.workbook || {};
  const overlay = input.overlay || {};
  const printer = input.printer || {};
  const pdf = input.pdf || {};
  const redirect = input.redirect || {};
  const itemChecks = input.itemChecks || {};
  const lookup = input.lookup || {};

  return {
    liveTitle: {
      screenKeyword: normalizeString(
        liveTitle.screenKeyword ||
          (/^live\s*-/i.test(String(liveTitle.matchText || "").trim())
            ? ""
            : liveTitle.matchText),
        DEFAULT_SETTINGS.liveTitle.screenKeyword
      )
    },
    workbook: {
      useCustomColumns: normalizeBool(workbook.useCustomColumns, false),
      saleColumn: normalizeColumnLetter(workbook.saleColumn, "A"),
      productColumn: normalizeColumnLetter(workbook.productColumn, "B"),
      itemCheckColumn: normalizeColumnLetter(workbook.itemCheckColumn, "C"),
      headerRows: clampNumber(workbook.headerRows, 0, 20, 1),
      ignoreTabPattern: normalizeString(workbook.ignoreTabPattern, "COST")
    },
    overlay: {
      showLivePrefix: normalizeBool(overlay.showLivePrefix, true),
      livePrefixFormat: normalizeString(overlay.livePrefixFormat, "S{n}:"),
      noMatchText: normalizeString(overlay.noMatchText, "no match")
    },
    printer: {
      useCustom: normalizeBool(printer.useCustom, false),
      widthIn: clampNumber(printer.widthIn, 1, 12, 4),
      heightIn: clampNumber(printer.heightIn, 1, 12, 6),
      dpi: clampNumber(printer.dpi, 72, 600, 203),
      renderScale: clampNumber(printer.renderScale, 1, 4, 2),
      monoThreshold: clampNumber(printer.monoThreshold, 0, 255, 165),
      printHint: normalizeString(
        printer.printHint,
        DEFAULT_SETTINGS.printer.printHint
      )
    },
    pdf: {
      useCustom: normalizeBool(pdf.useCustom, false),
      rowYTolerance: clampNumber(pdf.rowYTolerance, 1, 30, 6),
      sellerSkuXTolerance: clampNumber(pdf.sellerSkuXTolerance, 5, 120, 40),
      legacyTitleHint: normalizeString(
        pdf.legacyTitleHint,
        "AS SEEN ON SCREEN"
      )
    },
    redirect: {
      enabled: normalizeBool(redirect.enabled, true),
      hostPattern:
        normalizeString(redirect.hostPattern, "tiktok") || "tiktok",
      extraUrlContains: normalizeString(
        redirect.extraUrlContains,
        "oec_fulfillment_doc"
      ),
      interceptLocalPdfs: normalizeBool(redirect.interceptLocalPdfs, true)
    },
    itemChecks: {
      enabled: normalizeBool(itemChecks.enabled, true),
      blockPacking: normalizeBool(itemChecks.blockPacking, true)
    },
    lookup: {
      strictLiveMatching: normalizeBool(
        lookup.strictLiveMatching,
        DEFAULT_SETTINGS.lookup.strictLiveMatching
      )
    },
    debug: normalizeBool(input.debug, false)
  };
}

function migrateLiveTitleSettings(migrated) {
  const existing = migrated.liveTitle || {};
  let screenKeyword = String(existing.screenKeyword || "").trim();

  if (screenKeyword) {
    migrated.liveTitle = { screenKeyword };
    return;
  }

  const legacyMatchText = String(existing.matchText || "").trim();
  if (legacyMatchText && !/^live\s*-/i.test(legacyMatchText)) {
    screenKeyword = legacyMatchText;
  }

  if (!screenKeyword) {
    const patterns = migrated.liveTitlePatterns;
    if (Array.isArray(patterns)) {
      const nonEmpty = patterns
        .map(pattern => String(pattern || "").trim())
        .filter(Boolean);
      if (nonEmpty.length > 0) {
        screenKeyword = nonEmpty[0];
      }
    }
  }

  if (!screenKeyword) {
    for (let i = 1; i <= 6; i++) {
      const legacy = String(migrated[`liveTitlePattern${i}`] || "").trim();
      if (legacy) {
        screenKeyword = legacy;
        break;
      }
    }
  }

  if (!screenKeyword) {
    const legacyHint = String(migrated.pdf?.legacyTitleHint || "").trim();
    if (legacyHint) {
      const words = legacyHint.split(/\s+/);
      screenKeyword = words[words.length - 1] || DEFAULT_SETTINGS.liveTitle.screenKeyword;
    }
  }

  migrated.liveTitle = {
    screenKeyword: screenKeyword || DEFAULT_SETTINGS.liveTitle.screenKeyword
  };
}

function migrateStoredSettings(stored) {
  const migrated = stored?.[SETTINGS_STORAGE_KEY]
    ? structuredClone(stored[SETTINGS_STORAGE_KEY])
    : {};

  if (!stored?.[SETTINGS_STORAGE_KEY] && Array.isArray(stored?.liveTitlePatterns)) {
    migrated.liveTitlePatterns = stored.liveTitlePatterns;
  }

  migrateLiveTitleSettings(migrated);
  return mergeSettings(migrated);
}

function setActiveSettings(settings) {
  activeSettings = mergeSettings(settings);
  return activeSettings;
}

function getActiveSettings() {
  return activeSettings;
}

function isSettingsObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.liveTitle || value.workbook || value.printer || value.pdf || value.redirect || value.lookup)
  );
}

function loadSettings(stored) {
  if (isSettingsObject(stored)) {
    return setActiveSettings(stored);
  }
  return setActiveSettings(migrateStoredSettings(stored || {}));
}

function columnLetterToIndex(letter) {
  const col = normalizeColumnLetter(letter, "A");
  let index = 0;

  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64);
  }

  // Excel columns are 1-based; sheet rows from XLSX are 0-based arrays.
  return index - 1;
}

function getScreenKeyword() {
  return normalizeString(
    getActiveSettings().liveTitle.screenKeyword,
    DEFAULT_SETTINGS.liveTitle.screenKeyword
  );
}

function isStrictLiveMatchingEnabled() {
  return Boolean(getActiveSettings().lookup.strictLiveMatching);
}

function getEffectiveWorkbookSettings() {
  const workbook = getActiveSettings().workbook;
  if (!workbook.useCustomColumns) {
    return DEFAULT_SETTINGS.workbook;
  }
  return workbook;
}

function getEffectivePrinterSettings() {
  const printer = getActiveSettings().printer;
  if (!printer.useCustom) {
    return DEFAULT_SETTINGS.printer;
  }
  return printer;
}

function getEffectivePdfSettings() {
  const pdf = getActiveSettings().pdf;
  if (!pdf.useCustom) {
    return DEFAULT_SETTINGS.pdf;
  }
  return pdf;
}

function formatOverlayPrefix(sheetIndex) {
  const overlay = getActiveSettings().overlay;
  if (!overlay.showLivePrefix || !sheetIndex) return "";

  return overlay.livePrefixFormat.replace(/\{n\}/gi, String(sheetIndex));
}

function joinOverlayLabel(sheetIndex, text) {
  const prefix = formatOverlayPrefix(sheetIndex);
  if (!prefix) return text;
  return `${prefix.trimEnd()} ${text}`;
}

function formatNoMatchLabel(sheetIndex) {
  return joinOverlayLabel(sheetIndex, getActiveSettings().overlay.noMatchText);
}

function formatMatchedProductLabel(sheetIndex, productName) {
  return joinOverlayLabel(sheetIndex, productName);
}

function getWorkbookColumnIndices() {
  const workbook = getEffectiveWorkbookSettings();
  return {
    saleColumn: columnLetterToIndex(workbook.saleColumn),
    productColumn: columnLetterToIndex(workbook.productColumn),
    itemCheckColumn: columnLetterToIndex(workbook.itemCheckColumn),
    headerRows: workbook.headerRows
  };
}

function buildSettingsPayload(settings) {
  return {
    [SETTINGS_STORAGE_KEY]: mergeSettings(settings)
  };
}

function isDebugEnabled() {
  return Boolean(getActiveSettings().debug);
}
