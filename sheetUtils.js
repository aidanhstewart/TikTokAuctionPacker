// sheetUtils.js

function getLiveSheetIndex(liveTitle, productLines) {
  const lines = (productLines || []).map(line =>
    line.replace(/\s+/g, " ").trim()
  );
  const allText = [liveTitle, ...lines]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (/LIVE\s*-\s*AS SEEN ON SCREEN\s+3\b/i.test(allText)) return 3;
  if (/^SCREEN\s*3$/i.test(lines[lines.length - 1] || "")) return 3;
  if (/^ON\s+SCREEN\s*3$/i.test(lines[lines.length - 1] || "")) return 3;
  if (
    /\bSCREEN\s*3\b/i.test(allText) &&
    /\b(LIVE|AS\s+SEEN\s+ON)\b/i.test(allText)
  ) {
    return 3;
  }

  if (/LIVE\s*-\s*AS SEEN ON SCREEN\s+2\b/i.test(allText)) return 2;
  if (/^SCREEN\s*2$/i.test(lines[lines.length - 1] || "")) return 2;
  if (/^ON\s+SCREEN\s*2$/i.test(lines[lines.length - 1] || "")) return 2;
  if (
    /\bSCREEN\s*2\b/i.test(allText) &&
    /\b(LIVE|AS\s+SEEN\s+ON)\b/i.test(allText)
  ) {
    return 2;
  }

  if (/LIVE\s*-\s*AS SEEN ON SCREEN\b/i.test(allText)) return 1;
  if (/LIVE\s*-\s*AS SEEN\b/i.test(allText)) return 1;

  return 1;
}

async function fetchSheetData(url) {
  if (!url) return {};

  const response = await fetch(url);
  const csv = await response.text();
  const rows = csv.split("\n");
  const map = {};

  rows.slice(1).forEach(row => {
    const cols = row.split(",");

    const saleNumber = cols[0]
      ? cols[0].replace(/\r/g, "").trim()
      : "";

    const productName = cols[1]
      ? cols[1].replace(/\r/g, "").trim()
      : "";

    if (saleNumber && productName) {
      map[saleNumber] = productName;
    }
  });

  return map;
}

async function loadSheetMaps(sheetUrl1, sheetUrl2, sheetUrl3) {
  const fetches = [
    fetchSheetData(sheetUrl1),
    fetchSheetData(sheetUrl2)
  ];

  if (sheetUrl3) {
    fetches.push(fetchSheetData(sheetUrl3));
  }

  const [map1, map2, map3] = await Promise.all(fetches);

  const maps = { 1: map1, 2: map2 };
  if (sheetUrl3) {
    maps[3] = map3;
  }

  return maps;
}

function lookupProduct(maps, sheetIndex, saleNumber) {
  return (maps[sheetIndex] || {})[saleNumber] || null;
}
