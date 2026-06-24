// background.js

function isPdfUrl(url) {
  if (!url) return false;
  const path = url.split("?")[0].split("#")[0].toLowerCase();
  return /\.pdf(\.pdf)?$/i.test(path) || path.includes(".pdf");
}

function isTikTokPackingPdf(url) {
  if (!url || url.startsWith("chrome-extension://")) return false;
  if (url.includes("viewer.html")) return false;

  // Local file:// PDFs (for testing packing slips saved to disk)
  if (url.startsWith("file://") && isPdfUrl(url)) return true;

  if (!/tiktok/i.test(url)) return false;

  return (
    isPdfUrl(url) ||
    url.includes("oec_fulfillment_doc") ||
    /\/easesafe\/oec_fulfillment/i.test(url)
  );
}

function redirectToViewer(tabId, pdfUrl) {
  const viewerUrl =
    chrome.runtime.getURL("viewer.html") +
    "?pdf=" +
    encodeURIComponent(pdfUrl);

  chrome.tabs.update(tabId, { url: viewerUrl });
}

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  if (!isTikTokPackingPdf(details.url)) return;

  redirectToViewer(details.tabId, details.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url) return;
  if (!isTikTokPackingPdf(tab.url)) return;

  redirectToViewer(tabId, tab.url);
});
