# ESCALATIONS

Open questions for Kiwi. Newest last. Work continues on other tasks while these are open.

## Open

3. **Embedded players and their terms.** Spotify and YouTube links are embedded with each vendor's official player, unmodified. Both vendors' terms expect the player to be visible while it plays. Pressing P fades the setup panel (and the player with it) so the audience sees only the artwork; that is convenient but arguably outside those terms. Suggested default: use a local file for the presented performance, and treat links as a rehearsal convenience. Confirm or tell me to keep the player always visible.
4. **Spotify embed sign-in (needs your check).** For full tracks, Kiwi must be signed in to Spotify (Premium) in the same browser profile. Chrome blocking third-party cookies can make the embed behave as logged out (30 second previews). I could not test a real sign-in (I do not enter credentials). If the embed only plays previews for you, the fallback is the Web Playback SDK, which needs you to register an app in the Spotify developer dashboard (Client ID and redirect URI). Tell me if you want that.
5. **CLAUDE.md wording.** Rule 2 says "music is played from a plain audio element". Embeds are an approved exception (DECISIONS.md). Want the rule text updated to say so?

1. **Language of LOGBOOK.md and SCORE_TEMPLATE.md.** SPEC section 11 says headings are bilingual (English with Spanish in parentheses) until you say otherwise. Default: bilingual. Confirm or choose one language.
2. **Song brief.** No SONG_BRIEF.md exists yet. Until it does, only engine milestones and PLACEHOLDER scenes are built (SPEC 8.9.9).
