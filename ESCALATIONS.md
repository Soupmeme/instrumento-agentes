# ESCALATIONS

Open questions for Kiwi. Newest last. Work continues on other tasks while these are open.

## Open

1. **Language of LOGBOOK.md and SCORE_TEMPLATE.md.** SPEC section 11 says headings are bilingual (English with Spanish in parentheses) until you say otherwise. Default: bilingual. Confirm or choose one language.
2. **Song brief.** No SONG_BRIEF.md exists yet. Until it does, only engine milestones and PLACEHOLDER scenes are built (SPEC 8.9.9).
3. **License of this repository.** There is no LICENSE file. The extended Physarum shader, the preset matrix, the pen blend, the waves and the spawn bursts are adapted from Bleuje's web port, which is CC BY-NC-SA 3.0 (non-commercial, share-alike for adaptations). Credit is in the README and on screen. Which license (if any) the repository itself should carry is your decision; a share-alike license such as CC BY-NC-SA 3.0 would be consistent with the adapted parts. Suggested default: add no LICENSE file until you decide.
4. **Curated presets are my aesthetic choice.** The 8 starred presets (slots 0, 2, 4, 13, 14, 15, 19, 21) were picked by eye for being distinct, structured and stable. The song and its scenes should decide what is actually kept, so treat the list as a starting palette, not a decision.

## Resolved

- **Spotify embed sign-in** (2026-09-30): tested by Kiwi in regular Chrome. Clicking the player opened a separate tab and the Spotify desktop app, the player never changed, and only the 30 second preview played. Kiwi chose to drop Spotify and not pursue the Web Playback SDK. Local files, YouTube and direct links remain.
- **Embedded players and their terms** (2026-09-29): Kiwi decided player visibility is inconsequential, so P keeps fading the setup panel and the embed with it. No change.
- **CLAUDE.md wording for rule 2** (2026-09-29): Kiwi said not to change it. CLAUDE.md stays as is; the embed exception lives only in DECISIONS.md.
