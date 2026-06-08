// viewer.js

const THERMAL = {
  widthIn: 4,
  heightIn: 6,
  dpi: 300
};

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

  const targetW = THERMAL.widthIn * THERMAL.dpi;
  const targetH = THERMAL.heightIn * THERMAL.dpi;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = targetW / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement("div");
    wrapper.className = "pageWrapper";
    wrapper.style.width = THERMAL.widthIn + "in";
    wrapper.style.height = THERMAL.heightIn + "in";

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = targetW;
    canvas.height = targetH;
    canvas.style.width = THERMAL.widthIn + "in";
    canvas.style.height = THERMAL.heightIn + "in";

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetW, targetH);

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    const textContent = await page.getTextContent();
    const columnLayout = getTableColumnLayout(textContent);
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
        columnLayout.skuColumnLeftPdf
      );

      const mask = document.createElement("div");
      mask.className = "overlayMask";
      mask.style.left = pxToIn(bounds.left);
      mask.style.top = pxToIn(bounds.top);
      mask.style.width = pxToIn(bounds.width);
      mask.style.height = pxToIn(bounds.height);

      const overlay = document.createElement("div");
      overlay.className = "overlayText";
      overlay.style.left = pxToIn(bounds.left);
      overlay.style.top = pxToIn(bounds.top);
      overlay.style.width = pxToIn(bounds.width);
      overlay.style.height = pxToIn(bounds.height);
      overlay.style.fontSize = pxToIn(bounds.fontSize);
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

function pxToIn(px) {
  return px / THERMAL.dpi + "in";
}

function getProductNameBounds(productItems, viewport, skuColumnLeftPdf) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let fontSizeTotal = 0;
  let fontSizeCount = 0;

  let productColumnRight = Infinity;

  if (skuColumnLeftPdf != null) {
    const edge = pdfjsLib.Util.transform(viewport.transform, [
      1, 0, 0, 1, skuColumnLeftPdf, 0
    ]);
    productColumnRight = edge[4];
  }

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

  maxX = Math.min(maxX, productColumnRight);

  const pad = 2;
  const fontSize = fontSizeCount
    ? fontSizeTotal / fontSizeCount
    : 10 * viewport.scale;

  const left = minX - pad;
  const width = Math.max(maxX - minX + pad * 2, 0);

  return {
    left,
    top: minY - pad,
    width,
    height: maxY - minY + pad * 2,
    fontSize,
    lineHeight: 1.05
  };
}
