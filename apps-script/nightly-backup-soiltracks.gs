/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   NIGHTLY BACKUP  â€”  paste this into the Apps Script project,
   then run setupNightlyBackup() ONE time.

   What it does every night around 2am:
     1. Makes a complete dated copy of the spreadsheet
     2. Puts it in a Google Drive folder called "LPP App Backups"
     3. Deletes copies older than the newest 30

   Restoring = open the dated copy, File > Make a copy.
   Nothing in this file touches your live data. It only reads.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

// ---- SETTINGS -------------------------------------------------
// If the top of your main script has a sheet ID, paste the same
// one here. If your script uses getActiveSpreadsheet(), you can
// leave this as '' and it will figure it out on its own.
var BACKUP_SHEET_ID = '';

var BACKUP_LABEL    = 'SoilTracks';        // name shown on each copy
var BACKUP_FOLDER   = 'LPP App Backups'; // Drive folder name
var BACKUP_KEEP     = 30;                // how many to keep
// ---------------------------------------------------------------


/** Run this ONCE. Installs the nightly schedule. */
function setupNightlyBackup() {
  // Remove any older copy of this same schedule so it can't double up
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runNightlyBackup') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('runNightlyBackup')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();

  // Take one right now so you can see it worked
  var file = runNightlyBackup();
  Logger.log('Nightly backup is on. First copy: ' + file.getName());
  return file.getName();
}


/** Makes one dated copy. Runs automatically; safe to run by hand. */
function runNightlyBackup() {
  var ss     = _backupGetSpreadsheet_();
  var folder = _backupGetFolder_(BACKUP_FOLDER);
  var stamp  = Utilities.formatDate(new Date(),
                 Session.getScriptTimeZone(), 'yyyy-MM-dd HH-mm');
  var name   = BACKUP_LABEL + ' backup ' + stamp;

  var copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  _backupPrune_(folder);
  return copy;
}


/** Deletes the oldest copies once there are more than BACKUP_KEEP. */
function _backupPrune_(folder) {
  var mine = [];
  var it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_LABEL + ' backup ') === 0) {
      mine.push(f);
    }
  }

  mine.sort(function (a, b) {
    return b.getDateCreated() - a.getDateCreated(); // newest first
  });

  for (var i = BACKUP_KEEP; i < mine.length; i++) {
    mine[i].setTrashed(true);
  }
}


function _backupGetFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}


function _backupGetSpreadsheet_() {
  if (BACKUP_SHEET_ID) return SpreadsheetApp.openById(BACKUP_SHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error(
    'Put this project\'s sheet ID in BACKUP_SHEET_ID at the top of ' +
    'nightly-backup.gs. It is the long code in the sheet\'s web address, ' +
    'between /d/ and /edit.'
  );
}

