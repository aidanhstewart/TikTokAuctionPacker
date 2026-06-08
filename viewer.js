// viewer.js

const THERMAL = {
  widthIn: 4,
  heightIn: 6,
  dpi: 600
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

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = targetW;
    canvas.height = targetH;
    canvas.className = "pageCanvas";

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetW, targetH);

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport,
      intent: "print"
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

      drawProductOverlay(context, bounds, productName);
    }
  }

  document.getElementById("printBtn").addEventListener("click", () => {
    flattenPagesForPrint();
    setTimeout(() => window.print(), 50);
  });

  window.addEventListener("afterprint", restorePagesAfterPrint);
})();

function drawProductOverlay(context, bounds, productName) {
  context.fillStyle = "#ffffff";
  context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);

  context.fillStyle = "#000000";
  context.textBaseline = "top";
  context.font = `bold ${bounds.fontSize}px Helvetica, Arial, sans-serif`;

  drawWrappedText(
    context,
    productName,
    bounds.left,
    bounds.top + 1,
    bounds.width,
    bounds.fontSize * bounds.lineHeight
  );
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(/\s+/);
  let line = "";
  let currentY = y;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;

    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line) {
    context.fillText(line, x, currentY);
  }
}

function flattenPagesForPrint() {
  document.querySelectorAll(".pageWrapper").forEach(wrapper => {
    if (wrapper.dataset.flattened === "1") return;

    const canvas = wrapper.querySelector("canvas");
    if (!canvas) return;

    const img = document.createElement("img");
    img.className = "printImage";
    img.src = canvas.toDataURL("image/png");
    img.alt = "Packing list";
    img.style.width = THERMAL.widthIn + "in";
    img.style.height = THERMAL.heightIn + "in";

    canvas.classList.add("screenOnly");
    wrapper.appendChild(img);
    wrapper.dataset.flattened = "1";
  });
}

function restorePagesAfterPrint() {
  document.querySelectorAll(".pageWrapper").forEach(wrapper => {
    wrapper.querySelectorAll(".printImage").forEach(img => img.remove());
    wrapper.querySelector("canvas")?.classList.remove("screenOnly");
    delete wrapper.dataset.flattened;
  });
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

  return {
    left: minX - pad,
    top: minY - pad,
    width: Math.max(maxX - minX + pad * 2, 0),
    height: maxY - minY + pad * 2,
    fontSize,
    lineHeight: 1.05
  };
}
