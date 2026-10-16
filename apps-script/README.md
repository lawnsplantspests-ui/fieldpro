# Apps Script (the server side of FieldPro)

FieldPro's data lives in Google Sheets, and the code that reads and writes
those sheets lives in Google Apps Script. Google does not version it the way
GitHub does, so the code is kept here too. A backend with its own folder
(`fieldpro/`) is linked to its Apps Script project with
[clasp](https://github.com/google/clasp), Google's command-line tool, so the
folder *is* what runs in Google. The loose `.gs` files are copies kept by hand.

There are **two** separate backends:

| Backend | Deployment id starts | Sheet | Used by |
|---|---|---|---|
| FieldPro main (`fieldpro/`, script `13xMt14q…`) | `AKfycbwXMubOtc75…` | not yet recorded | Customers, programs, routes, ponds, treatment sync |
| SoilTracks | `AKfycbywck7W0oDi…` | `10-2QSreupS-8sdtx3V5fDrZ4uqAHnwHMOuvGVRKL9u8` | The Soil page only |

SoilTracks also *reads* the LPP Log sheet (`1ZLuqBz…`) for the customer list,
but only writes to its own `Samples` tab.

| File | What it is |
|---|---|
| `fieldpro/Code.gs` | The FieldPro main backend (linked with clasp) |
| `soiltracks-backend.gs` | The SoilTracks backend as of 2026-05-31 |
| `nightly-backup-soiltracks.gs` | Dated nightly copy of the SoilTracks sheet |
| `nightly-backup-fieldpro.gs` | Dated nightly copy of the FieldPro sheet |

`nightly-backup-soiltracks.gs` is ready to run as-is.
`nightly-backup-fieldpro.gs` still needs `BACKUP_SHEET_ID` filled in — the
FieldPro Apps Script project has that id near the top of its own main file.

## How FieldPro stores its FP_ tabs

Each `FP_` tab holds one JSON list. Since 2026-10-11 (script v14) it is split
down column A (A1, A2, …) in pieces of at most 40,000 characters, each starting
with `~`, because Google Sheets refuses any cell over 50,000 characters. To read
one by hand: drop the leading `~` from each cell and join them in order. Tabs
still holding plain JSON in A1 (the old layout) read the same.

## Not covered by these backups

SoilTracks reads an `ANTHROPIC_API_KEY` from **Script Properties**
(Project Settings → Script Properties). That value lives only inside the Apps
Script project — copying this `.gs` file or the spreadsheet does not preserve
it. If the project is ever deleted and rebuilt, the key has to be pasted in
again.

## Whenever an Apps Script changes

**Linked with clasp** (`fieldpro/`): change the file here, then from that folder

    clasp push                      # upload the code (replaces every file in the Google project)
    clasp redeploy <deployment id>  -d "what changed"   # the existing deployment, so its URL stays the same

`clasp list-deployments` shows the deployment ids; use the long-lived one the
app calls (not `@HEAD`). Always edit here, not in the online editor: a push
overwrites the Google copy, so an online-only edit would be lost. If one was
made anyway, `clasp pull` first. clasp is signed in as lawnsplantspests@gmail.com
(`clasp show-authorized-user`).

**Not linked yet:** paste the new version in here as a `.gs` file and commit,
so there is always a copy that isn't inside Google. To link one: make a folder,
`clasp clone <script id>` into it (the id is in the script editor under Project
Settings; a script attached to a sheet is found from the sheet's Extensions →
Apps Script), compare with the copy here, then move the copy in as its main file.

## Wrong-password limit (2026-10-14)

Live in FieldPro main since deployment version 16 (2026-10-15); SoilTracks
still runs the old check until its project is updated. Both backend copies limit password guessing: after 50 wrong passwords in an hour
from anyone, password checks pause for an hour (the app shows "Try again in
about N minutes"). Phones that have already unlocked with the current password
keep working during a pause. One device gets 10 wrong tries an hour. The
remembered devices sit in Script Properties as `KNOWN_DEVICES` (hashed); it is
safe to delete that property, and changing `APP_KEY` forgets them all anyway.
Settings are the `PW_…` lines near the top of the script.
