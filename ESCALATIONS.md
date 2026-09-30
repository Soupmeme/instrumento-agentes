# ESCALATIONS

Open questions for Kiwi. Newest last. Work continues on other tasks while these are open.

## Open

1. **Language of LOGBOOK.md and SCORE_TEMPLATE.md.** SPEC section 11 says headings are bilingual (English with Spanish in parentheses) until you say otherwise. Default: bilingual. Confirm or choose one language.
2. **Song brief.** No SONG_BRIEF.md exists yet. Until it does, only engine milestones and PLACEHOLDER scenes are built (SPEC 8.9.9).
3. **Spotify embed sign-in (still open, needs a test in a normal browser).** Kiwi reports the embed does not prompt for sign-in inside the Claude app's built-in browser. Likely cause (unverified): that pane restricts the popup Spotify uses for login. Next step for Kiwi: run `npm run dev`, open http://localhost:5173 in regular Chrome, sign in to open.spotify.com in that same profile first, then paste a track link. If full tracks still do not play there, the fallback is the Web Playback SDK (needs a Spotify developer app, Client ID and redirect URI).

## Resolved

- **Embedded players and their terms** (2026-09-29): Kiwi decided player visibility is inconsequential, so P keeps fading the setup panel and the embed with it. No change.
- **CLAUDE.md wording for rule 2** (2026-09-29): Kiwi said not to change it. CLAUDE.md stays as is; the embed exception lives only in DECISIONS.md.
