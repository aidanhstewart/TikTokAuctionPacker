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
  const scale = 2.5;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement("div");
    wrapper.className = "pageWrapper";
    wrapper.style.width = viewport.width + "px";
    wrapper.style.height = viewport.height + "px";

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport,
      transform:
        pixelRatio !== 1
          ? [pixelRatio, 0, 0, pixelRatio, 0, 0]
          : undefined
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

      const bounds = getProductNameBounds(productItems, viewport);

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
      overlay.style.fontSize = bounds.fontSize + "px";
      overlay.style.lineHeight = bounds.lineHeight;
      overlay.innerText = productName;

      wrapper.appendChild(mask);
      wrapper.appendChild(overlay);
    }
  }

  document.getElementById("printBtn").addEventListener("click", () => {
    window.print();
  });
})();

function getProductNameBounds(productItems, viewport) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let fontSizeTotal = 0;
  let fontSizeCount = 0;

  for (const item of productItems) {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const scaleX = Math.hypot(tx[0], tx[1]) || viewport.scale;
    const scaleY = Math.hypot(tx[2], tx[3]) || viewport.scale;
    const fontSize = scaleY || (item.height || 10) * viewport.scale;
    const x = tx[4];
    const y = tx[5];
    const width = Math.max((item.width || 0) * scaleX, fontSize * 0.45);
    const top = y - fontSize * 0.82;
    const bottom = y + fontSize * 0.1;

    minX = Math.min(minX, x);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, bottom);
    fontSizeTotal += fontSize;
    fontSizeCount++;
  }

  const pad = 2;
  const fontSize = fontSizeCount
    ? fontSizeTotal / fontSizeCount
    : 10 * viewport.scale;

  return {
    left: minX - pad,
    top: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    fontSize,
    lineHeight: 1.05
  };
}
