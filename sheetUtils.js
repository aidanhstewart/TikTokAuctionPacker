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

function normalizeSheetUrl(url) {
  if (!url) return url;

  const trimmed = url.trim();

  if (/output=csv|format=csv/i.test(trimmed)) {
    return trimmed;
  }

  const publishedMatch = trimmed.match(
    /^(https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[^/]+)\/pub/i
  );
  if (publishedMatch) {
    return `${publishedMatch[1]}/pub?output=csv`;
  }

  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch || idMatch[1] === "e") {
    return trimmed;
  }

  let gid = "0";
  const gidMatch = trimmed.match(/[#&?]gid=(\d+)/);
  if (gidMatch) {
    gid = gidMatch[1];
  }

  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gid}`;
}

function parseCsvLine(line) {
  const cols = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cols.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  cols.push(current);
  return cols;
}

function normalizeSaleNumber(value) {
  if (!value) return "";

  return value
    .replace(/^\ufeff/, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

async function fetchSheetData(url) {
  if (!url) return {};

  const csvUrl = normalizeSheetUrl(url);
  const response = await fetch(csvUrl);

  if (!response.ok) {
    console.warn("[TikTokPacker] Sheet fetch failed:", csvUrl, response.status);
    return {};
  }

  const csv = await response.text();

  if (csv.trimStart().startsWith("<")) {
    console.warn(
      "[TikTokPacker] Sheet URL returned HTML, not CSV. Use a published CSV link or a shareable sheet URL:",
      csvUrl
    );
    return {};
  }

  const rows = csv.split(/\r?\n/);
  const map = {};

  rows.slice(1).forEach(row => {
    if (!row.trim()) return;

    const cols = parseCsvLine(row);
    const saleNumber = normalizeSaleNumber(cols[0]);
    const productName = cols[1]
      ? cols[1].replace(/\r/g, "").trim().replace(/^["']|["']$/g, "")
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

  console.log("[TikTokPacker] Sheet rows loaded:", {
    live1: Object.keys(map1).length,
    live2: Object.keys(map2).length,
    live3: sheetUrl3 ? Object.keys(map3).length : 0
  });

  if (Object.keys(map1).length === 0 && Object.keys(map2).length === 0) {
    console.warn(
      "[TikTokPacker] Both sheets are empty — check your URLs in the extension popup. " +
        "Paste the sheet link or a File → Publish to web → CSV URL."
    );
  }

  return maps;
}

function lookupProduct(maps, sheetIndex, saleNumber) {
  const key = normalizeSaleNumber(saleNumber);
  return (maps[sheetIndex] || {})[key] || null;
}
