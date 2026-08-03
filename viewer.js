// viewer.js - TSC thermal printers (configurable label size / DPI)

let textLayerObserver = null;

function createMatchStats() {
  return { matched: 0, unmatched: [] };
}

function shouldCountPackingItem(item, overlay) {
  if (!item?.saleNumber || !isAuctionSaleNumber(item.saleNumber)) {
    return false;
  }

  if (!overlay?.bounds?.overlayColumn) {
    return false;
  }

  if (isStrictLiveMatchingEnabled()) {
    return Number.isFinite(item.sheetIndex) && item.sheetIndex >= 1;
  }

  return true;
}

function getPrinterSettings() {
  return getEffectivePrinterSettings();
}

function getRenderScale() {
  return getPrinterSettings().renderScale;
}

function getMonoThreshold() {
  return getPrinterSettings().monoThreshold;
}

function getLabelWidthPx() {
  const printer = getPrinterSettings();
  return printer.widthIn * printer.dpi;
}

function getLabelHeightPx() {
  const printer = getPrinterSettings();
  return printer.heightIn * printer.dpi;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

(async function initViewer() {
  let pdf = null;

  try {
    setViewerLoading(true);
    hideViewerError();

    if (typeof pdfjsLib === "undefined") {
      throw new Error("PDF_LIBRARY_MISSING");
    }

    const pdfUrl = getPdfUrlFromQuery();
    const { maps, stored, refreshMeta } = await loadProductMaps();
    updateToolbarMeta(stored, refreshMeta);
    configurePdfWorker();
    pdf = await loadPdfDocument(pdfUrl);

    const matchStats = createMatchStats();
    const renderedPages = await renderAllPages(pdf, maps, matchStats);
    if (renderedPages === 0) {
      throw new Error("NO_PAGES_RENDERED");
    }

    showMatchSummary(matchStats);

    wirePrintButton();
    enablePrintButton();
  } catch (err) {
    console.error("[TikTokPacker]", err);
    showViewerError(formatViewerError(err));
  } finally {
    if (pdf) {
      try {
        pdf.destroy();
      } catch (destroyErr) {
        console.warn("[TikTokPacker] PDF cleanup failed:", destroyErr);
      }
    }
    setViewerLoading(false);
  }
})();

function getPdfUrlFromQuery() {
  const raw = new URLSearchParams(window.location.search).get("pdf");
  if (!raw) {
    throw new Error("NO_PDF_URL");
  }

  let pdfUrl;
  try {
    pdfUrl = decodeURIComponent(raw);
  } catch {
    pdfUrl = raw;
  }

  if (
    !pdfUrl.startsWith("http://") &&
    !pdfUrl.startsWith("https://") &&
    !pdfUrl.startsWith("file://") &&
    !pdfUrl.startsWith("blob:")
  ) {
    throw new Error("INVALID_PDF_URL");
  }

  return pdfUrl;
}

async function loadProductMaps() {
  let stored = await chrome.storage.local.get(getSheetStorageKeys());
  loadSettings(stored);
  applyViewerSettings();

  let refreshMeta = { refreshed: false, fromCache: false };

  if (stored.spreadsheetUrl || stored.workbookFileData) {
    setViewerLoading(true, "Refreshing product data...");
    const refreshResult = await refreshWorkbookFromSource(stored);
    if (refreshResult) {
      refreshMeta = refreshResult;
      stored = await chrome.storage.local.get(getSheetStorageKeys());
    }
  }

  await assertNoPendingItemChecks(stored);
  const maps = await resolveSheetMaps(stored);
  if (!maps) {
    throw new Error("NO_PRODUCT_DATA");
  }

  return { maps, stored, refreshMeta };
}

function updateToolbarMeta(stored, refreshMeta) {
  const el = document.getElementById("dataFreshness");
  if (!el) return;

  el.textContent = formatDataFreshnessText(stored, refreshMeta);
  el.classList.toggle("is-stale", Boolean(refreshMeta.fromCache && refreshMeta.error));
}

function showMatchSummary(stats) {
  const banner = document.getElementById("matchSummary");
  if (!banner) return;

  const total = stats.matched + stats.unmatched.length;
  if (total === 0) {
    banner.hidden = true;
    return;
  }

  const lines = [`${stats.matched} matched · ${stats.unmatched.length} no match`];

  if (stats.unmatched.length > 0) {
    const seen = new Set();
    const saleList = stats.unmatched
      .filter(entry => {
        const key = `${entry.page}:${entry.saleNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(entry => {
        const live = entry.sheetIndex ? ` (Live ${entry.sheetIndex})` : "";
        return `#${entry.saleNumber}${live}`;
      })
      .join(", ");
    lines.push(`Missing sale numbers: ${saleList}`);
  }

  banner.textContent = lines.join("\n");
  banner.hidden = false;
  banner.classList.toggle("has-errors", stats.unmatched.length > 0);
}

function configurePdfWorker() {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    chrome.runtime.getURL("pdfjs/pdf.worker.min.js");
}

function applyViewerSettings() {
  const printer = getPrinterSettings();
  const root = document.documentElement;

  root.style.setProperty("--label-width", `${printer.widthIn}in`);
  root.style.setProperty("--label-height", `${printer.heightIn}in`);

  const hint = document.querySelector(".printHint");
  if (hint) hint.textContent = printer.printHint;
}

function wirePrintButton() {
  const printBtn = document.getElementById("printBtn");
  if (!printBtn || printBtn.dataset.wired === "1") return;
  printBtn.dataset.wired = "1";
  printBtn.addEventListener("click", () => {
    setTimeout(() => window.print(), 80);
  });
}

function enablePrintButton() {
  const printBtn = document.getElementById("printBtn");
  if (printBtn) printBtn.disabled = false;
}

function setViewerLoading(isLoading, message) {
  const banner = document.getElementById("loadingBanner");
  if (!banner) return;
  banner.hidden = !isLoading;
  if (message) {
    banner.textContent = message;
  } else if (!isLoading) {
    banner.textContent = "Loading packing list...";
  }
}

function hideViewerError() {
  const banner = document.getElementById("errorBanner");
  if (banner) banner.hidden = true;
}

function formatViewerError(err) {
  if (err?.message === "NO_PDF_URL") {
    return "No PDF URL was provided to the viewer.";
  }

  if (err?.message === "INVALID_PDF_URL") {
    return "The PDF URL in the viewer link is not valid. Try reopening the packing list from TikTok Seller Center.";
  }

  if (err?.message === "PDF_LIBRARY_MISSING") {
    return "The PDF viewer failed to load. Reload the extension in chrome://extensions and try again.";
  }

  if (err?.message === "NO_PAGES_RENDERED") {
    return [
      "Could not render any pages from this PDF.",
      "",
      "The file may be corrupted, password-protected, or not a supported packing list."
    ].join("\n");
  }

  if (err?.message === "PDF_EMPTY") {
    return "The PDF file is empty or could not be read.";
  }

  if (err?.message === "NO_PRODUCT_DATA") {
    return getMissingSetupMessage();
  }

  if (err?.message === "ITEM_CHECKS_REQUIRED") {
    return formatItemCheckBlockMessage(err.itemChecks || []);
  }

  if (err?.message === "LOCAL_FILE_BLOCKED") {
    return [
      "Could not read the local PDF file.",
      "",
      "In chrome://extensions, open this extension and enable:",
      "Allow access to file URLs",
      "",
      "Then reopen the PDF."
    ].join("\n");
  }

  if (err?.message?.startsWith("Failed to load PDF")) {
    return [
      err.message,
      "",
      "The link may have expired. Reopen the packing list from TikTok Seller Center and try again."
    ].join("\n");
  }

  if (err?.message?.startsWith("Failed to read local PDF")) {
    return [
      err.message,
      "",
      "Check that the file still exists and that file URL access is enabled for this extension."
    ].join("\n");
  }

  return [
    "Failed to process this packing-list PDF.",
    "",
    String(err?.message || err),
    "",
    "Try reopening the PDF. If it keeps failing, check the browser console for details."
  ].join("\n");
}

function showViewerError(message) {
  const banner = document.getElementById("errorBanner");
  const printBtn = document.getElementById("printBtn");
  if (banner) {
    banner.textContent = message;
    banner.hidden = false;
  } else {
    alert(message);
  }
  if (printBtn) printBtn.disabled = true;
}

// ---------------------------------------------------------------------------
// PDF loading
// ---------------------------------------------------------------------------

async function loadPdfDocument(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load PDF (${response.status})`);
    }

    const data = await response.arrayBuffer();
    if (!data.byteLength) {
      throw new Error("PDF_EMPTY");
    }

    return pdfjsLib.getDocument({ data }).promise;
  } catch (err) {
    if (url.startsWith("file://") && String(err).includes("Failed to fetch")) {
      throw new Error("LOCAL_FILE_BLOCKED");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

async function renderAllPages(pdf, maps, matchStats) {
  const container = document.getElementById("pdfContainer");
  if (!container) {
    throw new Error("Viewer container is missing.");
  }

  container.replaceChildren();

  const targetW = getLabelWidthPx();
  const targetH = getLabelHeightPx();
  const renderW = targetW * getRenderScale();
  const renderH = targetH * getRenderScale();
  let renderedPages = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    try {
      await renderPage({
        pdf,
        pageNum,
        maps,
        matchStats,
        container,
        targetW,
        targetH,
        renderW,
        renderH
      });
      renderedPages += 1;
    } catch (err) {
      console.error(`[TikTokPacker] Page ${pageNum} failed:`, err);
      appendPageError(container, pageNum, err);
    }
  }

  setupTextLayerObserver(container);
  return renderedPages;
}

function appendPageError(container, pageNum, err) {
  const box = document.createElement("div");
  box.className = "pageError";
  box.textContent = `Page ${pageNum} could not be rendered.\n${String(err?.message || err)}`;
  container.appendChild(box);
}

function setupTextLayerObserver(container) {
  if (textLayerObserver) {
    textLayerObserver.disconnect();
    textLayerObserver = null;
  }

  if (typeof ResizeObserver === "undefined") return;

  textLayerObserver = new ResizeObserver(() => {
    container.querySelectorAll(".pageContent").forEach(syncTextLayerScale);
  });
  textLayerObserver.observe(container);
}

async function renderPage({
  pdf,
  pageNum,
  maps,
  matchStats,
  container,
  targetW,
  targetH,
  renderW,
  renderH
}) {
  const page = await pdf.getPage(pageNum);

  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = renderW / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement("div");
    wrapper.className = "pageWrapper";
    container.appendChild(wrapper);

    const canvas = createRenderCanvas(renderW, renderH);
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true
    });

    await page.render({
      canvasContext: context,
      viewport,
      intent: "print"
    }).promise;

    const textContent = await page.getTextContent();
    const columnLayout = getTableColumnLayout(textContent);
    const searchOverlays = [];

    maskCoverableLiveTitles(context, textContent, viewport, columnLayout);

    const packingItems = parseTikTokPackingItems(textContent);
    let pageHasUnmatched = false;

    for (const item of packingItems) {
      if (!isAuctionSaleNumber(item.saleNumber)) {
        continue;
      }

      const overlay = buildLineItemOverlay(item, maps, viewport, columnLayout, pageNum);
      if (overlay) {
        const countInStats = shouldCountPackingItem(item, overlay);

        if (countInStats) {
          if (overlay.productName) {
            matchStats.matched += 1;
          } else {
            pageHasUnmatched = true;
            matchStats.unmatched.push({
              saleNumber: item.saleNumber,
              sheetIndex: overlay.sheetIndex,
              page: pageNum
            });
          }
        }

        drawLineItemOverlay(
          context,
          overlay.bounds,
          overlay.productName,
          overlay.sheetIndex
        );
        searchOverlays.push({
          text: overlay.searchText,
          bounds: overlay.bounds
        });
      }
    }

    if (pageHasUnmatched) {
      wrapper.classList.add("pageWrapper--unmatched");
    }

    maskSkuColumnHeader(context, textContent, viewport, columnLayout);

    const pageContent = attachPreviewCanvas(wrapper, canvas, targetW, targetH);
    attachSearchTextLayer(
      pageContent,
      textContent,
      viewport,
      searchOverlays,
      targetW,
      targetH
    );
  } finally {
    try {
      page.cleanup();
    } catch (cleanupErr) {
      console.warn("[TikTokPacker] Page cleanup failed:", cleanupErr);
    }
  }
}

function createRenderCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  return canvas;
}

function buildLineItemOverlay(item, maps, viewport, columnLayout, pageNum) {
  const {
    saleNumber,
    sheetIndex,
    saleItem,
    productItems,
    liveTitle
  } = item;

  if (!saleItem || !saleNumber) {
    return null;
  }

  const bounds = getLineItemBounds(
    productItems,
    saleItem,
    viewport,
    columnLayout
  );
  const lookup = resolveProductLookup(maps, sheetIndex, saleNumber);
  const productName = lookup.productName;
  const resolvedSheetIndex = lookup.sheetIndex;

  if (isDebugEnabled()) {
    console.log("[TikTokPacker]", {
      page: pageNum,
      saleNumber,
      sheetIndex: resolvedSheetIndex,
      detectedTitle: liveTitle,
      lookedUpProduct: productName
    });
  }

  return {
    bounds,
    productName,
    sheetIndex: resolvedSheetIndex,
    searchText: productName
      ? formatMatchedProductLabel(resolvedSheetIndex, productName)
      : formatNoMatchLabel(resolvedSheetIndex)
  };
}

// ---------------------------------------------------------------------------
// Masking + overlays
// ---------------------------------------------------------------------------

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

function drawLineItemOverlay(context, bounds, productName, sheetIndex) {
  if (!bounds.overlayColumn) return;

  const overlay = bounds.overlayColumn;
  const overlayLeft = Math.round(overlay.left);
  const overlayTop = Math.round(overlay.top);
  const overlayWidth = Math.round(overlay.width);
  const overlayHeight = Math.round(overlay.height);
  const productRight = Math.round(overlay.productRight);

  if (overlayWidth <= 0 || overlayHeight <= 0) return;

  if (!productName) {
    context.save();
    context.fillStyle = "rgba(254, 202, 202, 0.55)";
    context.fillRect(overlayLeft, overlayTop, overlayWidth, overlayHeight);
    context.strokeStyle = "#ef4444";
    context.lineWidth = 2;
    context.strokeRect(
      overlayLeft + 1,
      overlayTop + 1,
      Math.max(overlayWidth - 2, 0),
      Math.max(overlayHeight - 2, 0)
    );
    context.restore();
  }

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

  const overlayText = productName
    ? formatMatchedProductLabel(sheetIndex, productName)
    : formatNoMatchLabel(sheetIndex);

  const padX = 2;
  const padY = 1;
  const maxWidth = Math.max(overlayWidth - padX * 2, 0);
  const lineHeightFactor = bounds.product.lineHeight;
  let fontSize = Math.round(bounds.product.fontSize * 1.12);

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
    const totalHeight = lines.length * fontSize * lineHeightFactor;

    if (totalHeight <= overlayHeight - padY * 2 || fontSize <= 8) {
      break;
    }

    fontSize -= 1;
  }

  const lineHeight = fontSize * lineHeightFactor;
  const totalTextHeight = lines.length * lineHeight;
  const textY =
    overlayTop +
    Math.max(padY, (overlayHeight - totalTextHeight) / 2 - 7);

  for (let i = 0; i < lines.length; i++) {
    context.fillText(
      lines[i],
      Math.round(overlayLeft + padX),
      Math.round(textY + i * lineHeight)
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

// ---------------------------------------------------------------------------
// Preview + search text layer
// ---------------------------------------------------------------------------

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
}

function attachPreviewCanvas(wrapper, hiResCanvas, targetW, targetH) {
  const preview = buildPageBitmap(hiResCanvas);
  preview.className = "pageCanvas";

  const pageContent = document.createElement("div");
  pageContent.className = "pageContent";
  pageContent.appendChild(preview);

  wrapper.appendChild(pageContent);
  releaseCanvas(hiResCanvas);

  return pageContent;
}

function appendSearchSpan(layer, text, left, top, fontSize) {
  const span = document.createElement("span");
  span.textContent = text;
  span.style.left = `${left}px`;
  span.style.top = `${top}px`;
  span.style.fontSize = `${Math.max(fontSize, 1)}px`;
  layer.appendChild(span);
}

function attachSearchTextLayer(
  pageContent,
  textContent,
  renderViewport,
  searchOverlays,
  targetW,
  targetH
) {
  const coordScale = targetW / renderViewport.width;
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  textLayer.setAttribute("aria-hidden", "true");
  textLayer.style.width = `${targetW}px`;
  textLayer.style.height = `${targetH}px`;

  for (const item of textContent.items) {
    if (!item.str || !item.str.trim()) continue;

    const tx = pdfjsLib.Util.transform(renderViewport.transform, item.transform);
    const fontHeight =
      Math.hypot(tx[2], tx[3]) ||
      (item.height || 12) * renderViewport.scale;

    appendSearchSpan(
      textLayer,
      item.str,
      tx[4] * coordScale,
      (tx[5] - fontHeight) * coordScale,
      fontHeight * coordScale
    );
  }

  for (const { text, bounds } of searchOverlays) {
    if (!text || !bounds?.overlayColumn) continue;

    const col = bounds.overlayColumn;
    appendSearchSpan(
      textLayer,
      text,
      col.left * coordScale,
      col.top * coordScale,
      bounds.product.fontSize * coordScale * 1.12
    );
  }

  pageContent.appendChild(textLayer);
  syncTextLayerScale(pageContent);
}

function syncTextLayerScale(pageContent) {
  const preview = pageContent.querySelector(".pageCanvas");
  const textLayer = pageContent.querySelector(".textLayer");
  if (!preview || !textLayer) return;

  const displayW = preview.getBoundingClientRect().width;
  if (!displayW || !preview.width) return;

  const scale = displayW / preview.width;
  textLayer.style.transform = `scale(${scale})`;
  textLayer.style.transformOrigin = "top left";
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

// ---------------------------------------------------------------------------
// Thermal bitmap conversion
// ---------------------------------------------------------------------------

function buildPageBitmap(sourceCanvas) {
  const targetW = getLabelWidthPx();
  const targetH = getLabelHeightPx();
  const ctx = sourceCanvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });

  toThermalMonochrome(ctx, sourceCanvas.width, sourceCanvas.height);

  if (sourceCanvas.width === targetW && sourceCanvas.height === targetH) {
    return sourceCanvas;
  }

  return downscaleMonochrome(sourceCanvas, targetW, targetH);
}

function downscaleMonochrome(sourceCanvas, targetW, targetH) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const scaleX = sw / targetW;
  const scaleY = sh / targetH;
  const srcData = sourceCanvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, sw, sh).data;

  const output = document.createElement("canvas");
  output.width = targetW;
  output.height = targetH;

  const outCtx = output.getContext("2d", { alpha: false });
  const outData = outCtx.createImageData(targetW, targetH);

  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(Math.floor((y + 1) * scaleY), sh);

    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(Math.floor((x + 1) * scaleX), sw);
      let black = false;

      for (let sy = y0; sy < y1 && !black; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          if (srcData[(sy * sw + sx) * 4] < 128) {
            black = true;
            break;
          }
        }
      }

      const value = black ? 0 : 255;
      const i = (y * targetW + x) * 4;
      outData.data[i] = value;
      outData.data[i + 1] = value;
      outData.data[i + 2] = value;
      outData.data[i + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return output;
}

function toThermalMonochrome(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const luminance =
      0.2126 * data[i] +
      0.7152 * data[i + 1] +
      0.0722 * data[i + 2];
    const value = luminance < getMonoThreshold() ? 0 : 255;

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
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
