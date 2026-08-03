// background.js — intercept TikTok packing-list PDFs and open the extension viewer

importScripts("settings.js");

const VIEWER_PATH = "viewer.html";
const REDIRECT_TTL_MS = 10000;
const MAX_TRACKED_REDIRECTS = 200;

/** @type {Map<string, number>} */
const redirectedTabs = new Map();

function stripUrlParams(url) {
  return url.split("?")[0].split("#")[0].toLowerCase();
}

function isPdfUrl(url) {
  if (!url) return false;
  const path = stripUrlParams(url);
  return path.endsWith(".pdf") || path.includes(".pdf");
}

function urlMatchesHostPattern(url, pattern) {
  if (!pattern) return true;

  try {
    return new RegExp(pattern, "i").test(url);
  } catch {
    return url.toLowerCase().includes(pattern.toLowerCase());
  }
}

function isTikTokPackingPdf(url) {
  const redirect = getActiveSettings().redirect;

  if (!url || url.startsWith("chrome-extension://")) return false;
  if (url.includes(VIEWER_PATH)) return false;

  if (redirect.interceptLocalPdfs && url.startsWith("file://") && isPdfUrl(url)) {
    return true;
  }

  if (!urlMatchesHostPattern(url, redirect.hostPattern)) return false;

  return (
    isPdfUrl(url) ||
    (redirect.extraUrlContains && url.includes(redirect.extraUrlContains)) ||
    /\/easesafe\/oec_fulfillment/i.test(url)
  );
}

function pruneRedirectedTabs() {
  const now = Date.now();
  for (const [key, expiresAt] of redirectedTabs) {
    if (expiresAt <= now) redirectedTabs.delete(key);
  }

  if (redirectedTabs.size <= MAX_TRACKED_REDIRECTS) return;

  const overflow = redirectedTabs.size - MAX_TRACKED_REDIRECTS;
  const keys = [...redirectedTabs.keys()];
  for (let i = 0; i < overflow; i++) {
    redirectedTabs.delete(keys[i]);
  }
}

function wasRecentlyRedirected(tabId, pdfUrl) {
  pruneRedirectedTabs();
  const key = `${tabId}:${pdfUrl}`;
  const expiresAt = redirectedTabs.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    redirectedTabs.delete(key);
    return false;
  }
  return true;
}

function markRedirected(tabId, pdfUrl) {
  pruneRedirectedTabs();
  redirectedTabs.set(`${tabId}:${pdfUrl}`, Date.now() + REDIRECT_TTL_MS);
}

function buildViewerUrl(pdfUrl) {
  return (
    chrome.runtime.getURL(VIEWER_PATH) + "?pdf=" + encodeURIComponent(pdfUrl)
  );
}

function redirectToViewer(tabId, pdfUrl) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  if (!pdfUrl || wasRecentlyRedirected(tabId, pdfUrl)) return;

  markRedirected(tabId, pdfUrl);

  chrome.tabs.update(tabId, { url: buildViewerUrl(pdfUrl) }, () => {
    if (chrome.runtime.lastError) {
      redirectedTabs.delete(`${tabId}:${pdfUrl}`);
      console.warn("[TikTokPacker] Redirect failed:", chrome.runtime.lastError.message);
    }
  });
}

function handleNavigation(tabId, url) {
  if (!getActiveSettings().redirect.enabled) return;
  if (!isTikTokPackingPdf(url)) return;
  redirectToViewer(tabId, url);
}

function withSettings(callback) {
  chrome.storage.local.get(SETTINGS_STORAGE_KEY, stored => {
    loadSettings(stored);
    callback();
  });
}

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  withSettings(() => handleNavigation(details.tabId, details.url));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading") return;
  if (!tab?.url) return;
  withSettings(() => handleNavigation(tabId, tab.url));
});

chrome.tabs.onRemoved.addListener(tabId => {
  for (const key of redirectedTabs.keys()) {
    if (key.startsWith(`${tabId}:`)) {
      redirectedTabs.delete(key);
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_STORAGE_KEY]) return;
  loadSettings({ [SETTINGS_STORAGE_KEY]: changes[SETTINGS_STORAGE_KEY].newValue });
});

withSettings(() => {});
