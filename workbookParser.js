// workbookParser.js - parse Excel workbooks (requires XLSX, loaded in popup only)

function parseWorkbookBuffer(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const tabReports = [];

  workbook.SheetNames.forEach((tabName, i) => {
    const sheet = workbook.Sheets[tabName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const { map, skippedRows } = rowsToSaleMap(rows);
    const liveIndex = liveIndexFromTabName(tabName, i + 1);

    if (Object.keys(map).length === 0) {
      tabReports.push({
        tabName,
        status: "skipped",
        reason: "no valid product rows (need column A = sale #, column B = product name)",
        liveIndex,
        skippedRows
      });
      return;
    }

    tabReports.push({
      tabName,
      status: "loaded",
      liveIndex,
      map,
      skippedRows,
      rowCount: Object.keys(map).length
    });
  });

  return buildWorkbookParseResult(tabReports);
}
