# Apps Script (the server side of FieldPro)

FieldPro's data lives in Google Sheets, and the code that reads and writes
those sheets lives in Google Apps Script — **not** in this repo automatically.
Google does not version it the way GitHub does, so copies are kept here by hand.

There are **two** separate backends:

| Backend | Deployment id starts with | Used by |
|---|---|---|
| FieldPro main | `AKfycbwXMubOtc75…` | Customers, programs, routes, ponds, treatment sync |
| SoilTracks | `AKfycbywck7W0oDi…` | The Soil page only |

| File | What it is |
|---|---|
| `nightly-backup-fieldpro.gs` | Dated nightly copy of the FieldPro sheet |
| `nightly-backup-soiltracks.gs` | Dated nightly copy of the SoilTracks sheet |

Set `BACKUP_SHEET_ID` at the top of each one before running
`setupNightlyBackup()` — it's the long code in the sheet's web address,
between `/d/` and `/edit`.

## Whenever an Apps Script changes

Paste the new version in here as a `.gs` file and commit, so there is always a
copy that isn't inside Google.
