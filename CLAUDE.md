# FieldPro

## Commits
- Always stage and commit the `.claude/` folder along with the other changes (e.g. `git add index.html .claude CLAUDE.md`).
- Commit straight to `main` and push when asked.
- Bump `APP_BUILD` in `index.html` whenever the page changes, and end the commit message with `build <APP_BUILD>`.

## Shared code: fix every copy
- SoilTracks exists twice: FieldPro's Soil page (`index.html`, the `st-` functions) and the standalone app in `../soiltracks` (repo lawnsplantspests-ui/soiltracks, live at lawnsplantspests-ui.github.io/soiltracks). Any fix or feature in one goes into the other in the same change (Devon, 2026-11-05).
- The app-password code is shared by FieldPro, LPP Log (`../lpp-log`) and the standalone SoilTracks. Change it in all of them together.
