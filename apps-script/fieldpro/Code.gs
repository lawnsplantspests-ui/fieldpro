// ═══════════════════════════════════════════════════════════════
// FIELDPRO — Standalone Apps Script (CORRECTED)
// 
// Uses doPost (not doGet) — same CORS-safe pattern as your LPP app
// Reads from your EXISTING Customers + Services tabs
// Stores FieldPro-specific data in FP_ tabs as JSON blobs
//
// SETUP:
// 1. Replace YOUR_SHEET_ID below with your LPP App Log Sheet ID
// 2. Deploy → New Deployment → Web App
//    - Execute as: Me
//    - Who has access: Anyone
// 3. Copy the URL into FieldPro's API_URL
// ═══════════════════════════════════════════════════════════════

// ⬇️ Your LPP App Log spreadsheet ID ⬇️
const SHEET_ID = '1ZLuqBz61IXa5CEQieNQbhTLxH6EJYGmxJiXjeyaswa0';

// ── App password ──────────────────────────────────────────────────────────────────────────
// This web app is reachable by anyone who has its URL, and the URL is in the apps' public code.
// So every request must carry the app password, kept in Project Settings → Script properties as
// APP_KEY (never in this code). If APP_KEY is missing, everything is refused (fails closed).
//
// Wrong-password limit: without one, anyone with the URL could try passwords forever. Apps Script
// does not reveal the caller's IP, so the main limit is shared by every caller: after PW_MAX_FAILS
// wrong passwords within PW_WINDOW_SEC, password checks stop for PW_LOCK_SEC and each request gets
// "too_many_attempts" without its password being looked at, so guessing during the pause learns
// nothing. The apps also send a random device id kept in the browser. A device that has unlocked
// with the current password is remembered (KNOWN_DEVICES in Script properties, hashed together with
// APP_KEY, so changing the password forgets them all) and keeps working through a pause, so a
// stranger's guessing can't lock the real phones out. One device gets PW_DEVICE_FAILS wrong tries
// per window before it alone is paused. A request with no password at all is refused but not counted.
var PW_MAX_FAILS = 50;
var PW_DEVICE_FAILS = 10;
var PW_WINDOW_SEC = 3600;
var PW_LOCK_SEC = 3600;
var KNOWN_DEVICES_MAX = 40;

// null when the request may go ahead; otherwise { message:'unauthorized' }
// or { message:'too_many_attempts', retryAfter:<seconds> }.
function appKeyRefusal_(key, device) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  // Trimmed on both sides: a space or line break pasted into the property must not lock the apps out.
  var want = all.APP_KEY ? String(all.APP_KEY).trim() : '';
  if (!want) return { message:'unauthorized' };
  key = typeof key === 'string' ? key.trim() : '';
  device = (typeof device === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(device)) ? device : '';

  var cache = CacheService.getScriptCache();
  var now = Date.now();
  var tag = device ? sha256Hex_(want + '|' + device).slice(0, 32) : '';
  var known = all.KNOWN_DEVICES ? String(all.KNOWN_DEVICES).split(',') : [];
  var isKnown = !!tag && known.indexOf(tag) >= 0;

  var until = tag ? Number(cache.get('pw_dlock_' + tag)) || 0 : 0;
  if (until <= now && !isKnown) until = Number(cache.get('pw_lock')) || 0;
  if (until > now) return { message:'too_many_attempts', retryAfter:Math.ceil((until - now) / 1000) };

  if (!key) return { message:'unauthorized' };
  if (sameText_(key, want)) {
    if (tag && !isKnown) {
      known.push(tag);
      props.setProperty('KNOWN_DEVICES', known.slice(-KNOWN_DEVICES_MAX).join(','));
    }
    return null;
  }

  // Wrong password. The lock keeps simultaneous guesses from overwriting each other's count.
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(5000);
  try {
    countFailure_(cache, now, 'pw_fails', 'pw_lock', PW_MAX_FAILS);
    if (tag) countFailure_(cache, now, 'pw_dfails_' + tag, 'pw_dlock_' + tag, PW_DEVICE_FAILS);
  } finally {
    if (locked) lock.releaseLock();
  }
  return { message:'unauthorized' };
}

function countFailure_(cache, now, countKey, lockKey, max) {
  var c = null;
  try { c = JSON.parse(cache.get(countKey) || 'null'); } catch (e) {}
  if (!c || now - c.t0 >= PW_WINDOW_SEC * 1000) c = { n:0, t0:now };
  c.n++;
  if (c.n >= max) {
    cache.put(lockKey, String(now + PW_LOCK_SEC * 1000), PW_LOCK_SEC);
    cache.remove(countKey);
  } else {
    var left = Math.ceil((c.t0 + PW_WINDOW_SEC * 1000 - now) / 1000);
    cache.put(countKey, JSON.stringify(c), Math.max(1, left));
  }
}

// Compares hashes, so the time taken says nothing about how much of a guess was right.
function sameText_(a, b) {
  var x = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
  var y = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function(b){ return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// ═══════════════════════════════════════════
// doPost — THE CRITICAL FUNCTION
// Must be doPost (not doGet) for Safari/iPhone CORS to work
// ═══════════════════════════════════════════
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var refused = appKeyRefusal_(data.key, data.device);
    if (refused) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: refused.message, retryAfter: refused.retryAfter }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var action = data.action;
    var result;

    switch (action) {
      case 'fpGetAll':
        result = fpGetAll();
        break;
      case 'fpSaveAll':
        result = fpSaveAll(data.data);
        break;
      case 'fpSyncLog':
        result = fpSyncLog(data);
        break;
      case 'fpAddCustomers':
        result = fpAddCustomers(data.customers);
        break;
      case 'fpAddProduct':
        result = fpAddProduct(data.product);
        break;
      case 'eqLogGet':
        result = eqLogGet();
        break;
      case 'eqLogSave':
        result = eqLogSave(data.entry);
        break;
      case 'eqLogDelete':
        result = eqLogDelete(data.id);
        break;
      default:
        result = { status: 'error', message: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ═══════════════════════════════════════════
// fpGetAll — Returns customers, services/products, and FP data
// ═══════════════════════════════════════════
function fpGetAll() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Read EXISTING Customers tab ──
  var customers = [];
  var custSheet = ss.getSheetByName('Customers');
  if (custSheet) {
    var custData = custSheet.getDataRange().getValues();
    if (custData.length > 1) {
      var headers = custData[0];
      for (var i = 1; i < custData.length; i++) {
        var row = custData[i];
        if (!row[0] && !row[1]) continue; // Skip empty rows
        var cust = {};
        for (var c = 0; c < headers.length; c++) {
          var val = row[c];
          // Format dates
          if (val instanceof Date) {
            val = val.toISOString();
          }
          cust[String(headers[c])] = val !== null && val !== undefined ? String(val) : '';
        }
        customers.push(cust);
      }
    }
  }

  // ── Read EXISTING Services tab (JSON in B2, continuing in B3 … if long) ──
  var services = null;
  var svcVal = getServicesText_(ss);
  if (svcVal) {
    try { services = JSON.parse(svcVal); } catch(e) { services = null; }
  }

  // ── Read FieldPro-specific data from FP_ tabs ──
  var programs = getJsonTab(ss, 'FP_Programs');
  var customerPrograms = getJsonTab(ss, 'FP_CustPrograms');
  var routes = getJsonTab(ss, 'FP_Routes');
  var products = getJsonTab(ss, 'FP_Products');
  var ponds = getJsonTab(ss, 'FP_Ponds');
  var pondVisits = getJsonTab(ss, 'FP_PondVisits');
  var lawnVisits = getJsonTab(ss, 'FP_LawnVisits');
  var phcVisits = getJsonTab(ss, 'FP_PhcVisits');
  var soilSamples = getJsonTab(ss, 'FP_SoilSamples');
  var baitStations = getJsonTab(ss, 'FP_BaitStations');

  return {
    status: 'ok',
    customers: customers,
    services: services,
    programs: programs || [],
    customerPrograms: customerPrograms || [],
    routes: routes || [],
    products: products || [],
    ponds: ponds || [],
    pondVisits: pondVisits || [],
    lawnVisits: lawnVisits || [],
    phcVisits: phcVisits || [],
    soilSamples: soilSamples || [],
    baitStations: baitStations || []
  };
}

// ═══════════════════════════════════════════
// fpSaveAll — Saves FieldPro data to FP_ tabs
// Does NOT modify Customers or Services tabs (those belong to LPP)
// ═══════════════════════════════════════════
function fpSaveAll(data) {
  // One save at a time: two devices saving at once could otherwise interleave
  // their pieces of the same tab.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fpSaveAll_(data);
  } finally {
    lock.releaseLock();
  }
}

function fpSaveAll_(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  if (data.programs !== undefined) setJsonTab(ss, 'FP_Programs', data.programs);
  if (data.customerPrograms !== undefined) setJsonTab(ss, 'FP_CustPrograms', data.customerPrograms);
  if (data.routes !== undefined) setJsonTab(ss, 'FP_Routes', data.routes);
  if (data.products !== undefined) setJsonTab(ss, 'FP_Products', data.products);
  if (data.ponds !== undefined) setJsonTab(ss, 'FP_Ponds', data.ponds);
  if (data.pondVisits !== undefined) setJsonTab(ss, 'FP_PondVisits', data.pondVisits);
  if (data.lawnVisits !== undefined) setJsonTab(ss, 'FP_LawnVisits', data.lawnVisits);
  if (data.phcVisits !== undefined) setJsonTab(ss, 'FP_PhcVisits', data.phcVisits);
  if (data.soilSamples !== undefined) setJsonTab(ss, 'FP_SoilSamples', data.soilSamples);
  if (data.baitStations !== undefined) setJsonTab(ss, 'FP_BaitStations', data.baitStations);

  return { status: 'ok' };
}

// ═══════════════════════════════════════════
// fpSyncLog — Reads LPP log entries for auto-completing rounds
// ═══════════════════════════════════════════
function fpSyncLog(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheets = ss.getSheets();
  var allRecords = [];
  var fetchAll = data.fetchAll || false;

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var now = new Date();
  var currentTab = MONTHS[now.getMonth()] + '_' + now.getFullYear();
  var prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var prevTab = MONTHS[prevMonth.getMonth()] + '_' + prevMonth.getFullYear();

  for (var i = 0; i < sheets.length; i++) {
    var sheetName = sheets[i].getName();

    // Only process monthly log tabs (Mon_YYYY format)
    if (!sheetName.match(/^[A-Z][a-z]{2}_\d{4}$/)) continue;

    // Filter to current + previous month unless fetchAll
    if (!fetchAll && sheetName !== currentTab && sheetName !== prevTab) continue;

    var sheet = sheets[i];
    var sheetData = sheet.getDataRange().getValues();
    if (sheetData.length < 2) continue;

    var headers = sheetData[0];
    for (var r = 1; r < sheetData.length; r++) {
      var row = sheetData[r];
      if (!row[0] && !row[2]) continue; // Skip empty rows

      var record = { _tab: sheetName };
      for (var c = 0; c < headers.length; c++) {
        var header = String(headers[c]).trim();
        var value = row[c];

        // Format dates as strings
        if (value instanceof Date) {
          if (header === 'Date') {
            var yyyy = value.getFullYear();
            var mm = String(value.getMonth() + 1).padStart(2, '0');
            var dd = String(value.getDate()).padStart(2, '0');
            value = yyyy + '-' + mm + '-' + dd;
          } else if (header === 'Time') {
            var hh = String(value.getHours()).padStart(2, '0');
            var mi = String(value.getMinutes()).padStart(2, '0');
            value = hh + ':' + mi;
          }
        }

        record[header] = value !== null && value !== undefined ? String(value) : '';
      }
      allRecords.push(record);
    }
  }

  return {
    status: 'ok',
    success: true,
    count: allRecords.length,
    synced: new Date().toISOString(),
    records: allRecords
  };
}

// ═══════════════════════════════════════════
// HELPERS: Read/Write JSON to FP_ tabs
//
// Google Sheets refuses any cell over 50,000 characters, so the JSON is cut
// into pieces of at most CHUNK_SIZE characters and written down column A
// (A1, A2, A3 …). Reading joins them back together. A tab saved by the old
// one-cell version (plain JSON in A1) still reads exactly the same.
//
// Every piece starts with CHUNK_MARK so Sheets always keeps it as plain text:
// a piece that happened to begin with "=", "+", "-" or look like a number or
// date would otherwise be turned into a formula, number or date.
// ═══════════════════════════════════════════
var CHUNK_SIZE = 40000;
var CHUNK_MARK = '~';

function getJsonTab(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    // Auto-create the tab if it doesn't exist
    sheet = ss.insertSheet(tabName);
    return null;
  }
  var last = sheet.getLastRow();
  if (last < 1) return null;
  var val = sheet.getRange(1, 1, last, 1).getValues().map(function(r) {
    var s = (r[0] === null || r[0] === undefined) ? '' : String(r[0]);
    return s.charAt(0) === CHUNK_MARK ? s.slice(1) : s;
  }).join('');
  if (!val) return null;
  try { return JSON.parse(val); } catch(e) { return null; }
}

function setJsonTab(ss, tabName, data) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  var json = JSON.stringify(data);
  var pieces = [];
  var i = 0;
  while (i < json.length) {
    var end = Math.min(i + CHUNK_SIZE, json.length);
    // Never split an emoji (or other two-part character) across two cells
    var code = json.charCodeAt(end - 1);
    if (end < json.length && code >= 0xD800 && code <= 0xDBFF) end--;
    pieces.push([CHUNK_MARK + json.slice(i, end)]);
    i = end;
  }
  // Blank any leftover pieces from a longer earlier save in this same single
  // write, so a read can never join new pieces onto stale ones.
  var rows = Math.max(pieces.length, sheet.getLastRow());
  while (pieces.length < rows) pieces.push(['']);
  sheet.getRange(1, 1, rows, 1).setValues(pieces);
}

// ═══════════════════════════════════════════
// Services tab (shared with the LPP Log backend, which reads and writes it
// the same way): JSON in column B of the DATA rows — B2, then B3, B4 … in
// pieces of at most CHUNK_SIZE once it outgrows one cell. While it fits, B2
// is written exactly as before. Pieces after the first start with CHUNK_MARK.
// ═══════════════════════════════════════════
var SERVICES_MIN_ROWS = 12;

function getServicesText_(ss) {
  var sheet = ss.getSheetByName('Services');
  if (!sheet || sheet.getLastRow() < 1) return '';
  var rows = sheet.getDataRange().getValues();
  var text = '';
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === 'DATA' && rows[i][1]) {
      var piece = String(rows[i][1]);
      text += piece.charAt(0) === CHUNK_MARK ? piece.slice(1) : piece;
    }
  }
  return text;
}

function setServicesText_(ss, text) {
  var sheet = ss.getSheetByName('Services') || ss.insertSheet('Services');
  var rows = [['Key', 'Value']];
  var i = 0;
  while (i < text.length) {
    var end = Math.min(i + CHUNK_SIZE, text.length);
    // Never split an emoji (or other two-part character) across two cells
    var code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xD800 && code <= 0xDBFF) end--;
    rows.push(['DATA', (i ? CHUNK_MARK : '') + text.slice(i, end)]);
    i = end;
  }
  // One write that also blanks any leftover pieces (at least SERVICES_MIN_ROWS
  // rows), so LPP Log saving at the same moment can't leave a stale piece behind.
  var n = Math.max(rows.length, sheet.getLastRow(), SERVICES_MIN_ROWS);
  while (rows.length < n) rows.push(['', '']);
  sheet.getRange(1, 1, n, 2).setValues(rows);
}

// ═══════════════════════════════════════════
// fpAddCustomers — Appends new customers to the shared Customers tab
// ═══════════════════════════════════════════
function fpAddCustomers(customers) {
  if (!customers || !customers.length) return { status: 'ok', added: 0 };
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Customers');
  if (!sheet) return { status: 'error', message: 'Customers tab not found' };

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var added = 0;

  // Get existing IDs to avoid duplicates
  var existingData = sheet.getDataRange().getValues();
  var idCol = headers.indexOf('ID');
  var existingIds = {};
  for (var i = 1; i < existingData.length; i++) {
    if (existingData[i][idCol]) existingIds[String(existingData[i][idCol])] = true;
  }

  customers.forEach(function(cust) {
    var custId = String(cust.ID || cust.customerId || '');
    if (existingIds[custId]) return; // Skip duplicates

    var row = headers.map(function(h) {
      return cust[h] !== undefined ? cust[h] : '';
    });
    sheet.appendRow(row);
    added++;
  });

  return { status: 'ok', added: added };
}

// ═══════════════════════════════════════════
// fpAddProduct — Adds a product to the Services tab JSON blob
// so the LPP app can see it too
// ═══════════════════════════════════════════
function fpAddProduct(product) {
  if (!product || !product.serviceName) return { status: 'error', message: 'Missing product data' };
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Services');
  if (!sheet) return { status: 'error', message: 'Services tab not found' };

  var val = getServicesText_(ss);
  var services = {};
  if (val) {
    try { services = JSON.parse(val); } catch(e) {}
  }

  // Add or update the service entry
  var svcName = product.serviceName;
  if (!services[svcName]) {
    services[svcName] = {
      appSite: product.appSite || '',
      notes: product.notes || '',
      products: []
    };
  }

  // Add the product to the service
  services[svcName].products.push({
    product: product.name || '',
    activeIng: product.activeIngredient || '',
    epa: product.epaReg || '',
    rate: product.rate || '',
    totalMixed: product.totalMixed || '',
    method: product.method || '',
    targetPest: product.targetPest || ''
  });

  // Write back
  setServicesText_(ss, JSON.stringify(services));

  return { status: 'ok' };
}

// ═══════════════════════════════════════════
// Equipment Log — the repair & maintenance book
// Unlike the FP_ tabs this is one readable row per entry, so it can be
// filtered, printed or corrected right in the sheet. Each save touches only
// its own row (found by ID). Deleting only stamps the Deleted column — the
// row stays, and the app hides it.
// ═══════════════════════════════════════════
var EQ_LOG_TAB = 'Equipment Log';
var EQ_LOG_COLS = ['ID', 'Date', 'Machine', 'Machine ID', 'Type', 'Work done', 'Task keys',
                   'Hours', 'Parts', 'Cost', 'Done by', 'Notes', 'Logged', 'Deleted'];
var EQ_LOG_FIELDS = ['id', 'date', 'machine', 'machineId', 'type', 'work', 'tasks',
                     'hours', 'parts', 'cost', 'doneBy', 'notes', 'logged', 'deleted'];

function eqLogSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(EQ_LOG_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(EQ_LOG_TAB);
    sheet.getRange(1, 1, 1, EQ_LOG_COLS.length).setValues([EQ_LOG_COLS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Plain text, so Sheets never turns a date or a part number into something else
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, EQ_LOG_COLS.length).setNumberFormat('@');
  }
  return sheet;
}

function eqLogCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function eqLogGet() {
  var sheet = eqLogSheet_();
  var last = sheet.getLastRow();
  var entries = [];
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, EQ_LOG_COLS.length).getValues().forEach(function(r) {
      if (!r[0]) return;
      var e = {};
      EQ_LOG_FIELDS.forEach(function(f, i) { e[f] = eqLogCell_(r[i]); });
      entries.push(e);
    });
  }
  return { status: 'ok', entries: entries };
}

function eqLogSave(entry) {
  if (!entry || !entry.id || !entry.machineId || !entry.date) return { status: 'error', message: 'Entry needs an id, machine and date' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = eqLogSheet_();
    var row = eqLogFindRow_(sheet, entry.id);
    if (!entry.logged) entry.logged = new Date().toISOString();
    var values = [EQ_LOG_FIELDS.map(function(f) { return eqLogCell_(entry[f]); })];
    if (row) {
      values[0][13] = String(sheet.getRange(row, 14).getValue() || '');   // an edit never clears or sets Deleted
    } else {
      values[0][13] = '';
      row = sheet.getLastRow() + 1;
    }
    sheet.getRange(row, 1, 1, EQ_LOG_COLS.length).setNumberFormat('@').setValues(values);
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

function eqLogDelete(id) {
  if (!id) return { status: 'error', message: 'No id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = eqLogSheet_();
    var row = eqLogFindRow_(sheet, id);
    if (row) sheet.getRange(row, 14).setValue(new Date().toISOString());
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

function eqLogFindRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
