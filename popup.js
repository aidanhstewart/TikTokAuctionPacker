// popup.js

document.getElementById("saveBtn").addEventListener("click", async () => {
  const sheetUrl1 = document.getElementById("sheetUrl1").value.trim();
  const sheetUrl2 = document.getElementById("sheetUrl2").value.trim();

  if (!sheetUrl1 || !sheetUrl2) {
    alert("Please enter both Google Sheet links.");
    return;
  }

  await chrome.storage.local.set({
    sheetUrl1,
    sheetUrl2
  });

  alert("Google Sheet links saved.");
});

chrome.storage.local.get(["sheetUrl1", "sheetUrl2", "sheetUrl"]).then(stored => {
  document.getElementById("sheetUrl1").value = stored.sheetUrl1 || stored.sheetUrl || "";
  document.getElementById("sheetUrl2").value = stored.sheetUrl2 || "";
});
