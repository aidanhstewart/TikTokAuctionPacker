// viewer.js — tuned for TSC thermal printers (203 DPI, 4×6 labels)

const THERMAL = {
  widthIn: 4,
  heightIn: 6,
  dpi: 203
};

const RENDER_SCALE = 2;
const MONO_THRESHOLD = 165;

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
  const renderW = targetW * RENDER_SCALE;
  const renderH = targetH * RENDER_SCALE;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = renderW / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement("div");
    wrapper.className = "pageWrapper";

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = renderW;
    canvas.height = renderH;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, renderW, renderH);
    context.imageSmoothingEnabled = false;

    wrapper.appendChild(canvas);
    container.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport,
      intent: "print"
    }).promise;

    const textContent = await page.getTextContent();
    const columnLayout = getTableColumnLayout(textContent);

    maskCoverableLiveTitles(context, textContent, viewport, columnLayout);

    const packingItems = parseTikTokPackingItems(textContent);
    const overlayItems = [];

    for (const {
      saleNumber,
      sheetIndex,
      saleItem,
      productItems,
      liveTitle
    } of packingItems) {
      if (!needsSheetOverlay(liveTitle)) {
        console.log("[TikTokPacker] marketplace row — left as-is", {
          page: pageNum,
          saleNumber,
          productTitle: liveTitle
        });
        continue;
      }

      const bounds = getLineItemBounds(
        productItems,
        saleItem,
        viewport,
        columnLayout
      );

      const productName = lookupProduct(maps, sheetIndex, saleNumber);

      console.log("[TikTokPacker]", {
        page: pageNum,
        saleNumber,
        sheetIndex,
        detectedTitle: liveTitle,
        lookedUpProduct: productName
      });

      overlayItems.push({ bounds, productName, sheetIndex });
    }

    maskSkuColumnHeader(context, textContent, viewport, columnLayout);

    const preview = attachPreviewCanvas(wrapper, canvas, targetW, targetH);
    const previewCtx = preview.getContext("2d", { alpha: false });

    for (const { bounds, productName, sheetIndex } of overlayItems) {
      drawLineItemOverlay(
        previewCtx,
        scaleOverlayBounds(bounds, RENDER_SCALE),
        productName,
        sheetIndex
      );
    }

    // Hi-res canvas is only needed to build the 1× preview; drop it to save GPU RAM.
    canvas.width = 0;
    canvas.height = 0;
    canvas.remove();
  }

  const printBtn = document.getElementById("printBtn");
  printBtn.addEventListener("click", async () => {
    printBtn.disabled = true;
    printBtn.textContent = "Preparing…";

    try {
      await flattenPagesForPrint();
      setTimeout(() => window.print(), 80);
    } finally {
      printBtn.disabled = false;
      printBtn.textContent = "Print";
    }
  });

  window.addEventListener("afterprint", restorePagesAfterPrint);
})();

function maskCoverableLiveTitles(context, textContent, viewport, layout) {
  if (layout.productColumnRightPdf == null) {
    return;
  }

  const productLeft = pdfXToViewport(
    viewport,
    layout.productColumnLeftPdf ?? 20
  );
  const productRight = pdfXToViewport(viewport, layout.productColumnRightPdf);
  const skuLeft =
    layout.skuColumnLeftPdf != null
      ? pdfXToViewport(viewport, layout.skuColumnLeftPdf)
      : productRight;
  const skuRight =
    layout.skuColumnRightPdf != null
      ? pdfXToViewport(viewport, layout.skuColumnRightPdf)
      : skuLeft;

  context.fillStyle = "#ffffff";

  for (const item of textContent.items) {
    if (!item.str || !isMaskableLiveTitle(item.str)) continue;

    const itemX = item.transform[4];
    const inProduct = itemX < layout.productColumnRightPdf;
    const inSku =
      layout.skuColumnLeftPdf != null &&
      itemX >= layout.skuColumnLeftPdf &&
      itemX < (layout.skuColumnRightPdf ?? Infinity) + 20;

    if (!inProduct && !inSku) continue;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const scaleY = Math.hypot(tx[2], tx[3]) || viewport.scale;
    const fontSize = scaleY || (item.height || 10) * viewport.scale;
    const top = tx[5] - fontSize * 0.82 - 2;
    const height = fontSize * 1.05 + 4;

    const left = inProduct ? productLeft : Math.max(skuLeft, productRight);
    const right = inProduct ? productRight : skuRight;

    context.fillRect(
      Math.round(left),
      Math.round(top),
      Math.round(Math.max(right - left, 0)),
      Math.round(height)
    );
  }
}

function attachPreviewCanvas(wrapper, hiResCanvas, targetW, targetH) {
  hiResCanvas.className = "hiResCanvas";
  hiResCanvas.style.display = "none";

  const preview = document.createElement("canvas");
  preview.width = targetW;
  preview.height = targetH;
  preview.className = "pageCanvas";

  const ctx = preview.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(hiResCanvas, 0, 0, targetW, targetH);

  wrapper.appendChild(preview);
  return preview;
}

function scaleOverlayBounds(bounds, renderScale) {
  const factor = 1 / renderScale;

  const scaleBox = box => {
    if (!box) return null;

    const scaled = {
      left: Math.round(box.left * factor),
      top: Math.round(box.top * factor),
      width: Math.round(box.width * factor),
      height: Math.round(box.height * factor)
    };

    if (box.productRight != null) {
      scaled.productRight = Math.round(box.productRight * factor);
    }

    if (box.screenExclude) {
      scaled.screenExclude = {
        top: Math.round(box.screenExclude.top * factor),
        bottom: Math.round(box.screenExclude.bottom * factor)
      };
    }

    return scaled;
  };

  return {
    product: {
      ...scaleBox(bounds.product),
      fontSize: bounds.product.fontSize * factor,
      lineHeight: bounds.product.lineHeight
    },
    overlayColumn: scaleBox(bounds.overlayColumn)
  };
}

function drawLineItemOverlay(context, bounds, productName, sheetIndex) {
  if (!bounds.overlayColumn) return;

  const overlay = bounds.overlayColumn;
  const overlayLeft = Math.round(overlay.left);
  const overlayTop = Math.round(overlay.top);
  const overlayWidth = Math.round(overlay.width);
  const overlayHeight = Math.round(overlay.height);
  const productRight = Math.round(overlay.productRight);

  if (overlayWidth <= 0 || overlayHeight <= 0) return;

  context.fillStyle = "#ffffff";

  const skuFillLeft = Math.max(productRight, overlayLeft);
  const skuFillWidth = overlayLeft + overlayWidth - skuFillLeft;
  if (skuFillWidth > 0) {
    context.fillRect(skuFillLeft, overlayTop, skuFillWidth, overlayHeight);
  }

  const productFillBottom = overlay.screenExclude
    ? Math.round(overlay.screenExclude.top)
    : overlayTop + overlayHeight;
  const productFillHeight = productFillBottom - overlayTop;
  const productFillWidth = productRight - overlayLeft;

  if (productFillHeight > 0 && productFillWidth > 0) {
    context.fillRect(overlayLeft, overlayTop, productFillWidth, productFillHeight);
  }

  const sheetTag = sheetIndex ? `S${sheetIndex}: ` : "";
  const overlayText = productName
    ? `${sheetTag}${productName}`
    : `${sheetTag}(no match)`;

  const padX = 2;
  const padY = 1;
  const maxWidth = Math.max(overlayWidth - padX * 2, 0);
  const lineHeightFactor = bounds.product.lineHeight;
  let fontSize = Math.max(8, Math.round(bounds.product.fontSize * 1.12));

  context.save();
  context.beginPath();
  context.rect(overlayLeft, overlayTop, overlayWidth, overlayHeight);
  context.clip();

  context.fillStyle = "#000000";
  context.textBaseline = "top";

  let lines = [];
  while (fontSize >= 8) {
    context.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
    lines = wrapTextLines(context, overlayText, maxWidth);
    const lineHeight = Math.round(fontSize * lineHeightFactor);
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= overlayHeight - padY * 2 || fontSize <= 8) {
      break;
    }

    fontSize -= 1;
  }

  const lineHeight = Math.round(fontSize * lineHeightFactor);
  const totalTextHeight = lines.length * lineHeight;
  const textY =
    overlayTop +
    Math.max(padY, Math.round((overlayHeight - totalTextHeight) / 2) - 4);

  for (let i = 0; i < lines.length; i++) {
    context.fillText(
      lines[i],
      overlayLeft + padX,
      textY + i * lineHeight
    );
  }

  context.restore();
}

function maskSkuColumnHeader(context, textContent, viewport, layout) {
  if (layout.skuColumnLeftPdf == null || layout.skuColumnRightPdf == null) {
    return;
  }

  const skuLeft = pdfXToViewport(viewport, layout.skuColumnLeftPdf);
  const skuRight = pdfXToViewport(viewport, layout.skuColumnRightPdf);

  context.fillStyle = "#ffffff";

  for (const item of textContent.items) {
    const text = item.str.trim();
    if (text !== "SKU") continue;
    if (item.transform[4] >= layout.skuColumnRightPdf + 30) continue;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const scaleY = Math.hypot(tx[2], tx[3]) || viewport.scale;
    const fontSize = scaleY || (item.height || 10) * viewport.scale;
    const top = tx[5] - fontSize * 0.82 - 2;
    const height = fontSize * 1.2 + 4;

    context.fillRect(
      Math.round(skuLeft),
      Math.round(top),
      Math.round(skuRight - skuLeft),
      Math.round(height)
    );
  }
}

function wrapTextLines(context, text, maxWidth) {
  if (maxWidth <= 0) return [text];

  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;

    if (context.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines.length ? lines : [text];
}

function toThermalMonochrome(context, width, height) {
  let imageData;

  try {
    imageData = context.getImageData(0, 0, width, height);
  } catch (err) {
    console.error("[TikTokPacker] Monochrome conversion failed:", err);
    return false;
  }

  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const luminance =
      0.2126 * data[i] +
      0.7152 * data[i + 1] +
      0.0722 * data[i + 2];
    const value = luminance < MONO_THRESHOLD ? 0 : 255;

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return true;
}

function createPrintCanvas(sourceCanvas) {
  const printCanvas = document.createElement("canvas");
  printCanvas.width = sourceCanvas.width;
  printCanvas.height = sourceCanvas.height;
  printCanvas.className = "printCanvas";

  const ctx = printCanvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0);

  if (!toThermalMonochrome(ctx, printCanvas.width, printCanvas.height)) {
    printCanvas.width = 0;
    printCanvas.height = 0;
    return null;
  }

  return printCanvas;
}

function yieldToBrowser() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function flattenPagesForPrint() {
  const wrappers = [...document.querySelectorAll(".pageWrapper")];

  for (const wrapper of wrappers) {
    if (wrapper.dataset.flattened === "1") continue;

    const pageCanvas = wrapper.querySelector(".pageCanvas");
    if (!pageCanvas) continue;

    const printCanvas = createPrintCanvas(pageCanvas);
    if (!printCanvas) continue;

    pageCanvas.classList.add("screenOnly");
    wrapper.appendChild(printCanvas);
    wrapper.dataset.flattened = "1";

    // Spread work across frames so large batches don't freeze the tab.
    await yieldToBrowser();
  }
}

function restorePagesAfterPrint() {
  document.querySelectorAll(".pageWrapper").forEach(wrapper => {
    wrapper.querySelectorAll(".printCanvas").forEach(canvas => {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    });
    wrapper.querySelectorAll(".pageCanvas").forEach(canvas => {
      canvas.classList.remove("screenOnly");
    });
    delete wrapper.dataset.flattened;
  });
}

function pdfXToViewport(viewport, pdfX) {
  return pdfjsLib.Util.transform(viewport.transform, [
    1, 0, 0, 1, pdfX, 0
  ])[4];
}

function getLineItemBounds(productItems, saleItem, viewport, layout) {
  let minY = Infinity;
  let maxY = -Infinity;
  let fontSizeTotal = 0;
  let fontSizeCount = 0;

  const productLeft =
    layout.productColumnLeftPdf != null
      ? pdfXToViewport(viewport, layout.productColumnLeftPdf)
      : pdfXToViewport(viewport, 20);

  const productRight =
    layout.productColumnRightPdf != null
      ? pdfXToViewport(viewport, layout.productColumnRightPdf)
      : Infinity;

  for (const item of productItems) {
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const scaleY = Math.hypot(tx[2], tx[3]) || viewport.scale;
    const fontSize = scaleY || (item.height || 10) * viewport.scale;
    const y = tx[5];
    const top = y - fontSize * 0.82;
    const bottom = y + fontSize * 0.1;

    minY = Math.min(minY, top);
    maxY = Math.max(maxY, bottom);
    fontSizeTotal += fontSize;
    fontSizeCount++;
  }

  const saleTx = pdfjsLib.Util.transform(viewport.transform, saleItem.transform);
  const saleFontSize =
    Math.hypot(saleTx[2], saleTx[3]) ||
    (saleItem.height || 10) * viewport.scale;
  const saleTop = saleTx[5] - saleFontSize * 0.82;
  const saleBottom = saleTx[5] + saleFontSize * 0.1;

  minY = Math.min(minY, saleTop);
  maxY = Math.max(maxY, saleBottom);

  const pad = 2;
  const fontSize = fontSizeCount
    ? fontSizeTotal / fontSizeCount
    : saleFontSize;

  const rowTop = minY - pad;
  const rowHeight = maxY - minY + pad * 2;

  const product = {
    left: productLeft,
    top: rowTop,
    width: Math.max(productRight - productLeft, 0),
    height: rowHeight,
    fontSize,
    lineHeight: 1.05
  };

  let overlayColumn = null;

  if (layout.skuColumnRightPdf != null) {
    const productRightViewport =
      layout.productColumnRightPdf != null
        ? pdfXToViewport(viewport, layout.productColumnRightPdf)
        : productRight;
    const skuRight = pdfXToViewport(viewport, layout.skuColumnRightPdf);

    let screenExclude = null;

    for (const item of productItems) {
      if (!isScreenIndicator(item.str)) continue;

      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const scaleY = Math.hypot(tx[2], tx[3]) || viewport.scale;
      const itemFontSize = scaleY || (item.height || 10) * viewport.scale;
      const screenTop = tx[5] - itemFontSize * 0.82 - 2;
      const screenBottom = tx[5] + itemFontSize * 0.15 + 2;

      if (!screenExclude) {
        screenExclude = { top: screenTop, bottom: screenBottom };
      } else {
        screenExclude.top = Math.min(screenExclude.top, screenTop);
        screenExclude.bottom = Math.max(screenExclude.bottom, screenBottom);
      }
    }

    overlayColumn = {
      left: productLeft,
      top: rowTop,
      width: Math.max(skuRight - productLeft, 0),
      height: rowHeight,
      productRight: productRightViewport,
      screenExclude
    };
  }

  return { product, overlayColumn };
}
