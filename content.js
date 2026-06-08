// content.js

(async function () {
  const isPdf =
    window.location.href.includes(".pdf") ||
    document.contentType === "application/pdf";

  if (!isPdf) return;

  const stored = await chrome.storage.local.get([
    "sheetUrl1",
    "sheetUrl2",
    "sheetUrl"
  ]);

  const sheetUrl1 = stored.sheetUrl1 || stored.sheetUrl;
  const sheetUrl2 = stored.sheetUrl2;

  if (!sheetUrl1 || !sheetUrl2) {
    alert("Save both Live 1 and Live 2 Google Sheet URLs in the extension popup.");
    return;
  }

  try {
    const maps = await loadSheetMaps(sheetUrl1, sheetUrl2);

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      chrome.runtime.getURL("pdfjs/pdf.worker.min.js");

    const pdf = await pdfjsLib.getDocument({
      url: window.location.href
    }).promise;

    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(" ");
      fullText += "\n" + pageText;
    }

    injectIntoPage(maps, fullText);
  } catch (err) {
    console.error(err);
    alert("Failed to process PDF.");
  }
})();

function injectIntoPage(maps, fullText) {
  const matches = matchTikTokPackingItems(fullText, maps);

  const existing = document.getElementById("tiktok-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "tiktok-overlay";

  overlay.innerHTML = `
    <div style="font-size:20px;font-weight:bold;margin-bottom:15px;">
      TikTok Shop Matches
    </div>
  `;

  let found = 0;

  matches.forEach(({ saleNumber, sheetIndex, liveTitle, productName }) => {
    found++;

    overlay.innerHTML += `
      <div style="background:#f5f5f5;padding:12px;border-radius:10px;margin-bottom:10px;border:1px solid #ddd;">
        <div style="font-weight:bold;font-size:16px;">
          Live ${sheetIndex} · Seller SKU ${saleNumber}
        </div>
        <div style="font-size:12px;color:#666;margin-top:4px;">
          ${liveTitle}
        </div>
        <div style="margin-top:4px;">
          ${productName}
        </div>
      </div>
    `;
  });

  if (found === 0) {
    overlay.innerHTML += `<div>No matching products found.</div>`;
  }

  overlay.style.position = "fixed";
  overlay.style.top = "20px";
  overlay.style.right = "20px";
  overlay.style.width = "340px";
  overlay.style.maxHeight = "80vh";
  overlay.style.overflowY = "auto";
  overlay.style.background = "white";
  overlay.style.padding = "16px";
  overlay.style.borderRadius = "14px";
  overlay.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
  overlay.style.zIndex = "2147483647";
  overlay.style.fontFamily = "Arial";
  overlay.style.fontSize = "14px";
  overlay.style.color = "black";
  overlay.style.border = "2px solid black";

  document.documentElement.appendChild(overlay);
}
