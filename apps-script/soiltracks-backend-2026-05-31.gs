var SOILTRACKS_ID = "10-2QSreupS-8sdtx3V5fDrZ4uqAHnwHMOuvGVRKL9u8";
var MASTER_CUSTOMERS_ID = "1ZLuqBz61IXa5CEQieNQbhTLxH6EJYGmxJiXjeyaswa0";

function doGet(e) {
  var action = (e.parameter || {}).action;
  if (action === 'getData') return jsonResponse(getDashboardData());
  if (action === 'getApiKey') {
    var key = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
    if (!key) return jsonResponse({ success: false, error: "ANTHROPIC_API_KEY not set" });
    return jsonResponse({ success: true, key: key });
  }
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("SoilTracks - Lawns Plants & Pests")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    if (action === "saveSample")       return jsonResponse(saveSample(payload.data));
    if (action === "deleteSample")     return jsonResponse(deleteSample(payload.id));
    if (action === "shortcutText")     return jsonResponse(handleShortcutText(payload.text));
    if (action === "parseReport")      return jsonResponse(parseReport(payload.text));
    if (action === "scanPhoto")        return jsonResponse(scanPhoto(payload.imageBase64, payload.mimeType));
    if (action === "renameCustomer")   return jsonResponse(renameCustomer(payload.oldName, payload.newName));
    if (action === "archiveCustomer")  return jsonResponse(archiveCustomer(payload.name, payload.archived));
    return jsonResponse({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function getSamplesSheet() {
  var ss = SpreadsheetApp.openById(SOILTRACKS_ID);
  var sheet = ss.getSheetByName("Samples");
  if (!sheet) {
    sheet = ss.insertSheet("Samples");
    sheet.appendRow([
      "ID","CustomerName","Field","Year",
      "Phosphorus_ppm","Potassium_ppm",
      "LimestoneLbs","RecN","RecP","RecK",
      "pH","P_lbA","Acidity","K_meq","Mg_meq","Ca_meq","CEC",
      "SatK","SatMg","SatCa",
      "Notes","DateAdded"
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getDashboardData() {
  return { success: true, customers: getAllCustomers(), samples: getAllSamples() };
}

function getAllCustomers() {
  var ss = SpreadsheetApp.openById(MASTER_CUSTOMERS_ID);
  var sheet = ss.getSheetByName("Customers");
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      if (h === "Archived") {
        obj.Archived = (row[i] === "Yes" || row[i] === true || row[i] === "TRUE");
      } else if (row[i] !== "") {
        obj[h] = row[i];
      }
    });
    return obj;
  }).filter(function(c) { return c.Name; });
}

function getMasterSheet() {
  var ss = SpreadsheetApp.openById(MASTER_CUSTOMERS_ID);
  var sheet = ss.getSheetByName("Customers");
  if (!sheet) throw new Error("Customers sheet not found in master spreadsheet");
  return sheet;
}

function ensureArchivedColumn(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = headers.indexOf("Archived");
  if (idx === -1) {
    // Add Archived column at end
    var newCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, newCol).setValue("Archived");
    return newCol - 1; // 0-based index
  }
  return idx;
}

function renameCustomer(oldName, newName) {
  try {
    if (!oldName || !newName) return { success: false, error: "Missing name" };
    // Rename in Customers sheet
    var custSheet = getMasterSheet();
    var custData = custSheet.getDataRange().getValues();
    var custHeaders = custData[0];
    var nameCol = custHeaders.indexOf("Name");
    if (nameCol === -1) return { success: false, error: "Name column not found in Customers sheet" };
    var renamed = false;
    for (var i = 1; i < custData.length; i++) {
      if (String(custData[i][nameCol]).trim() === String(oldName).trim()) {
        custSheet.getRange(i + 1, nameCol + 1).setValue(newName);
        renamed = true;
        break;
      }
    }
    // Rename in Samples sheet (CustomerName column)
    var sampSheet = getSamplesSheet();
    var sampData = sampSheet.getDataRange().getValues();
    var sampHeaders = sampData[0];
    var custNameCol = sampHeaders.indexOf("CustomerName");
    if (custNameCol !== -1) {
      for (var j = 1; j < sampData.length; j++) {
        if (String(sampData[j][custNameCol]).trim() === String(oldName).trim()) {
          sampSheet.getRange(j + 1, custNameCol + 1).setValue(newName);
        }
      }
    }
    return { success: true, renamed: renamed };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function archiveCustomer(name, archived) {
  try {
    var sheet = getMasterSheet();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var nameCol = headers.indexOf("Name");
    if (nameCol === -1) return { success: false, error: "Name column not found" };
    var archCol = ensureArchivedColumn(sheet);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][nameCol]).trim() === String(name).trim()) {
        sheet.getRange(i + 1, archCol + 1).setValue(archived ? "Yes" : "");
        return { success: true };
      }
    }
    return { success: false, error: "Customer not found: " + name };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function getAllSamples() {
  var sheet = getSamplesSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { if (row[i] !== "") obj[h] = row[i]; });
    return obj;
  });
}

function saveSample(data) {
  var sheet = getSamplesSheet();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!data.ID) {
    data.ID = Utilities.getUuid();
    data.DateAdded = new Date().toISOString();
    var row = headers.map(function(h) {
      var v = data[h];
      return (v !== undefined && v !== null) ? v : "";
    });
    Logger.log("Headers: " + JSON.stringify(headers));
    Logger.log("Row: " + JSON.stringify(row));
    sheet.appendRow(row);
  }
  return { success: true, id: data.ID };
}

function deleteSample(id) {
  var sheet = getSamplesSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(id)) { sheet.deleteRow(i + 1); break; }
  }
  return { success: true };
}

// Parse report text with AI — returns extracted data WITHOUT saving
function parseReport(text) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY not set" };

  var prompt = 'You are reading OCR text from a Penn State Extension Soil Test Report. The OCR may be messy.\n\n'
    + 'RETURN ONLY THIS JSON:\n'
    + '{"CustomerName":"","Field":"","Year":null,"Phosphorus_ppm":null,"Potassium_ppm":null,"LimestoneLbs":null,"RecN":"","RecP":"","RecK":"","pH":null,"P_lbA":null,"Acidity":null,"K_meq":null,"Mg_meq":null,"Ca_meq":null,"CEC":null,"SatK":null,"SatMg":null,"SatCa":null}\n\n'
    + 'TOP OF REPORT:\n'
    + '• CustomerName = name after "SOIL TEST REPORT FOR:"\n'
    + '• Field = value after "FIELD ID"\n'
    + '• Year = 4-digit year from DATE line\n'
    + '• Phosphorus_ppm = Phosphorus number next to "ppm" in SOIL NUTRIENT LEVELS\n'
    + '• Potassium_ppm = Potassium number next to "ppm" in SOIL NUTRIENT LEVELS\n\n'
    + 'RECOMMENDATIONS:\n'
    + '• LimestoneLbs = limestone lb/1000 sq ft. Use 0 if NONE.\n'
    + '• RecN = nitrogen rec as printed (e.g. "1 to 4"). "NONE" if none.\n'
    + '• RecP = P2O5 rec. "NONE" if none.\n'
    + '• RecK = K2O rec. "NONE" if none.\n\n'
    + 'LABORATORY RESULTS TABLE (bottom):\n'
    + 'Columns: 1pH | 2P lb/A | 3Acidity | 2K | 2Mg | 2Ca | 4CEC | K | Mg | Ca\n'
    + '• pH = 1st (e.g. 6.9)\n• P_lbA = 2nd (e.g. 200)\n• Acidity = 3rd meq/100g (e.g. 0.00)\n'
    + '• K_meq = 4th meq/100g (e.g. 0.70)\n• Mg_meq = 5th (e.g. 1.99)\n• Ca_meq = 6th (e.g. 9.49)\n'
    + '• CEC = 7th (e.g. 12.2)\n• SatK = 8th % (e.g. 5.8)\n• SatMg = 9th % (e.g. 16.4)\n• SatCa = 10th % (e.g. 77.9)\n\n'
    + 'Copy numbers exactly. Return ONLY JSON.\n\nOCR TEXT:\n' + text;

  var response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    return { success: false, error: "Claude API error " + response.getResponseCode() + ": " + response.getContentText().substring(0, 200) };
  }

  try {
    var result = JSON.parse(response.getContentText());
    var txt = result.content[0].text;
    var cleaned = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    var match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { success: false, error: "No JSON in AI response" };
    return { success: true, data: JSON.parse(match[0]) };
  } catch (err) {
    return { success: false, error: "Parse error: " + err.message };
  }
}

// Photo scan: try Drive OCR (free), fall back to Claude vision if rate limited
function scanPhoto(imageBase64, mimeType) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY not set" };

  // Try Google Drive OCR first (free)
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(imageBase64), mimeType || "image/jpeg", "soil_scan.jpg");
    var file = Drive.Files.insert({ title: "st_" + Date.now(), mimeType: mimeType || "image/jpeg" }, blob, { ocr: true, ocrLanguage: "en" });
    var doc = DocumentApp.openById(file.id);
    var text = doc.getBody().getText();
    DriveApp.getFileById(file.id).setTrashed(true);
    if (text.trim().length >= 30) {
      Logger.log("Drive OCR success, parsing with AI...");
      return parseReport(text);
    }
  } catch (ocrErr) {
    Logger.log("Drive OCR failed: " + ocrErr.message + " — falling back to Claude vision");
  }

  // Fallback: send image directly to Claude
  try {
    var prompt = 'Read this Penn State Soil Test Report photo. Return ONLY JSON:\n'
      + '{"CustomerName":"","Field":"","Year":null,"Phosphorus_ppm":null,"Potassium_ppm":null,"LimestoneLbs":null,"RecN":"","RecP":"","RecK":"","pH":null,"P_lbA":null,"Acidity":null,"K_meq":null,"Mg_meq":null,"Ca_meq":null,"CEC":null,"SatK":null,"SatMg":null,"SatCa":null}\n\n'
      + 'CustomerName=name after SOIL TEST REPORT FOR. Field=FIELD ID. Year=4-digit from DATE.\n'
      + 'Phosphorus_ppm=Phosphorus ppm. Potassium_ppm=Potassium ppm.\n'
      + 'LimestoneLbs=limestone lb/1000ft², 0 if NONE. RecN/RecP/RecK=as printed, "NONE" if none.\n'
      + 'Lab row: pH=1st, P_lbA=2nd, Acidity=3rd, K_meq=4th, Mg_meq=5th, Ca_meq=6th, CEC=7th, SatK=8th, SatMg=9th, SatCa=10th.\n'
      + 'Copy numbers exactly. Return ONLY JSON.';
    var response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 } },
        { type: "text", text: prompt }
      ]}] }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) return { success: false, error: "API error " + response.getResponseCode() };
    var result = JSON.parse(response.getContentText());
    var txt = result.content[0].text;
    var cleaned = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    var match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { success: false, error: "No JSON in response" };
    return { success: true, data: JSON.parse(match[0]) };
  } catch (err) {
    return { success: false, error: "Scan error: " + err.message };
  }
}

function handleShortcutText(text) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY not set" };

  var prompt = 'You are reading OCR text from a Penn State Extension Soil Test Report.\n\n'
    + 'RETURN ONLY THIS JSON:\n'
    + '{"CustomerName":"","Field":"","Year":null,'
    + '"Phosphorus_ppm":null,"Potassium_ppm":null,'
    + '"LimestoneLbs":null,"RecN":"","RecP":"","RecK":"",'
    + '"pH":null,"P_lbA":null,"Acidity":null,"K_meq":null,"Mg_meq":null,"Ca_meq":null,"CEC":null,'
    + '"SatK":null,"SatMg":null,"SatCa":null}\n\n'
    + 'WHERE TO FIND VALUES:\n\n'
    + 'TOP SECTION of report:\n'
    + '• CustomerName = name after "SOIL TEST REPORT FOR:"\n'
    + '• Field = value after "FIELD ID"\n'
    + '• Year = 4-digit year from the DATE line\n'
    + '• Phosphorus_ppm = the Phosphorus number next to "ppm" in SOIL NUTRIENT LEVELS (e.g. 100)\n'
    + '• Potassium_ppm = the Potassium number next to "ppm" in SOIL NUTRIENT LEVELS (e.g. 274)\n\n'
    + 'RECOMMENDATIONS SECTION:\n'
    + '• LimestoneLbs = limestone lb/1000 sq ft number. Use 0 if NONE.\n'
    + '• RecN = nitrogen recommendation (e.g. "1 to 4"). Use "NONE" if none.\n'
    + '• RecP = P2O5 recommendation. Use "NONE" if none.\n'
    + '• RecK = K2O recommendation. Use "NONE" if none.\n\n'
    + 'LABORATORY RESULTS TABLE (bottom of report):\n'
    + 'Column headers are: 1pH | 2P lb/A | 3Acidity | 2K | 2Mg | 2Ca | 4CEC | K | Mg | Ca\n'
    + 'The data row below has 10 numbers in that order:\n'
    + '• pH = 1st number (e.g. 6.9)\n'
    + '• P_lbA = 2nd number (e.g. 200)\n'
    + '• Acidity = 3rd number in meq/100g (e.g. 0.00)\n'
    + '• K_meq = 4th number in meq/100g (e.g. 0.70)\n'
    + '• Mg_meq = 5th number in meq/100g (e.g. 1.99)\n'
    + '• Ca_meq = 6th number in meq/100g (e.g. 9.49)\n'
    + '• CEC = 7th number in meq/100g (e.g. 12.2)\n'
    + '• SatK = 8th number, K% saturation (e.g. 5.8)\n'
    + '• SatMg = 9th number, Mg% saturation (e.g. 16.4)\n'
    + '• SatCa = 10th number, Ca% saturation (e.g. 77.9)\n\n'
    + 'IMPORTANT: The OCR text may be messy. Numbers might run together. Use the expected format to separate them. Return ONLY JSON.\n\n'
    + 'OCR TEXT:\n' + text;

  var response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    payload: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return { success: false, error: "Claude API error " + response.getResponseCode() };
  try {
    var result = JSON.parse(response.getContentText());
    var txt = result.content[0].text;
    var cleaned = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    var match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { success: false, error: "No JSON in response" };
    var data = JSON.parse(match[0]);
    var saveResult = autoSaveSample(data);
    return { success: true, data: data, saved: saveResult };
  } catch (err) { return { success: false, error: "Parse error: " + err.message }; }
}

function autoSaveSample(data) {
  try {
    var custName = data.CustomerName || "Unknown";
    var year = data.Year || new Date().getFullYear();
    var allCustomers = getAllCustomers();
    var custNameMatched = null;
    var needle = custName.toLowerCase().trim();

    for (var i = 0; i < allCustomers.length; i++) {
      var hay = (allCustomers[i].Name || "").toLowerCase().trim();
      if (hay === needle || hay.indexOf(needle) !== -1 || needle.indexOf(hay) !== -1) {
        custNameMatched = allCustomers[i].Name;
        break;
      }
    }

    if (!custNameMatched) {
      return { success: false, error: "Customer not found: " + custName, needsCustomer: true };
    }

    var sample = {
      CustomerName: custNameMatched, Field: data.Field || "", Year: year,
      Phosphorus_ppm: data.Phosphorus_ppm, Potassium_ppm: data.Potassium_ppm,
      LimestoneLbs: data.LimestoneLbs, RecN: data.RecN, RecP: data.RecP, RecK: data.RecK,
      pH: data.pH, P_lbA: data.P_lbA, Acidity: data.Acidity,
      K_meq: data.K_meq, Mg_meq: data.Mg_meq, Ca_meq: data.Ca_meq, CEC: data.CEC,
      SatK: data.SatK, SatMg: data.SatMg, SatCa: data.SatCa,
      Notes: "Auto-saved"
    };
    var result = saveSample(sample);
    return { success: true, id: result.id, customer: custNameMatched, year: year };
  } catch (err) { return { success: false, error: err.message }; }
}

function testSetup() {
  try {
    var custs = getAllCustomers();
    Logger.log("Customers: " + custs.length);
    if (custs.length > 0) Logger.log("First: " + custs[0].Name);
    var sheet = getSamplesSheet();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    Logger.log("Sample headers: " + JSON.stringify(headers));
    Logger.log("Samples: " + getAllSamples().length);
    var key = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
    Logger.log(key ? "API key found." : "NO API KEY");
  } catch(e) { Logger.log("Error: " + e.toString()); }
}
