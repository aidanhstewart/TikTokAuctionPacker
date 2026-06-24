// workbookParser.js - parse Excel workbooks (requires XLSX, loaded in popup only)

function parseWorkbookBuffer(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const tabReports = [];
  let liveTabPosition = 0;

  workbook.SheetNames.forEach(tabName => {
    if (isIgnoredWorkbookTab(tabName)) {
      return;
    }

    liveTabPosition += 1;

    const sheet = workbook.Sheets[tabName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const liveIndex = liveIndexFromTabName(tabName, liveTabPosition);
    const itemCheckRows = findColumnCheckRows(rows, 2);
    const { map, skippedRows } = rowsToSaleMap(rows);

    if (Object.keys(map).length === 0) {
      tabReports.push({
        tabName,
        status: "skipped",
        reason: "no valid product rows (need column A = sale #, column B = product name)",
        liveIndex,
        skippedRows,
        itemCheckRows
      });
      return;
    }

    tabReports.push({
      tabName,
      status: "loaded",
      liveIndex,
      map,
      skippedRows,
      itemCheckRows,
      rowCount: Object.keys(map).length
    });
  });

  return buildWorkbookParseResult(tabReports);
}
