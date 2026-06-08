// background.js

function isTikTokPackingPdf(url) {
  if (!url || url.startsWith("chrome-extension://")) return false;
  if (url.includes("viewer.html")) return false;
  if (!/tiktok/i.test(url)) return false;

  return (
    url.includes(".pdf") ||
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
