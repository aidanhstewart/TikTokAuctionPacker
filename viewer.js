// viewer.js

(async function () {
  const params = new URLSearchParams(window.location.search);
  const pdfUrl = params.get("pdf");

  if (!pdfUrl) {
    alert("No PDF URL supplied.");
    return;
  }

  const stored = await chrome.storage.local.get([
    "sheetUrl1",
    "sheetUrl2",
    "sheetUrl"
  ]);

  const sheetUrl1 = stored.sheetUrl1 || stored.sheetUrl;
  const sheetUrl2 = stored.sheetUrl2;

  if (!sheetUrl1) {
    alert("No Live 1 Google Sheet URL saved.");
    return;
  }

  if (!sheetUrl2) {
    alert("No Live 2 Google Sheet URL saved.");
    return;
  }

  const maps = await loadSheetMaps(sheetUrl1, sheetUrl2);

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    chrome.runtime.getURL("pdfjs/pdf.worker.min.js");

  const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
  const container = document.getElementById("pdfContainer");

  const scale = 2.8;
  const displayScale = 1.4;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    const viewport = page.getViewport({ scale });
    const displayViewport = page.getViewport({ scale: displayScale });

    const wrapper = document.createElement("div");
    wrapper.className = "pageWrapper";
    wrapper.style.width = displayViewport.width + "px";
    wrapper.style.height = displayViewport.height + "px";

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    canvas.style.width = displayViewport.width + "px";
    canvas.style.height = displayViewport.height + "px";

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    const textContent = await page.getTextContent();
    const packingItems = parseTikTokPackingItems(textContent);

    for (const {
      saleNumber,
      sheetIndex,
      productItems
    } of packingItems) {
      const productName = lookupProduct(maps, sheetIndex, saleNumber);
      if (!productName) continue;

      const bounds = getProductNameBounds(
        productItems,
        viewport,
        scale,
        displayScale
      );

      const mask = document.createElement("div");
      mask.className = "overlayMask";
      mask.style.left = bounds.left + "px";
      mask.style.top = bounds.top + "px";
      mask.style.width = bounds.width + "px";
      mask.style.height = bounds.height + "px";

      const overlay = document.createElement("div");
      overlay.className = "overlayText";
      overlay.style.left = bounds.left + "px";
      overlay.style.top = bounds.top + "px";
      overlay.style.width = bounds.width + "px";
      overlay.style.height = bounds.height + "px";
      overlay.innerText = productName;

      wrapper.appendChild(mask);
      wrapper.appendChild(overlay);
    }
  }

  document.getElementById("printBtn").addEventListener("click", () => {
    window.print();
  });
})();

function getProductNameBounds(productItems, viewport, renderScale, displayScale) {
  const ratio = displayScale / renderScale;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of productItems) {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const x = tx[4] * ratio;
    const y = tx[5] * ratio;
    const fontSize = (item.height || 10) * renderScale * ratio;
    const width = Math.max(
      item.width || 0,
      item.str.length * fontSize * 0.48
    ) * renderScale * ratio;
    const top = y - fontSize * 0.92;
    const bottom = y + fontSize * 0.12;

    minX = Math.min(minX, x);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, bottom);
  }

  const pad = 5;

  return {
    left: minX - pad,
    top: minY - pad,
    width: Math.max(maxX - minX + pad * 2, 200),
    height: Math.max(maxY - minY + pad * 2, 14)
  };
}
