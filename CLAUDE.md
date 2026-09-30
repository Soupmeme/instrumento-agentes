# CLAUDE.md (Unidad 6: Autonomous Agents instrument)

Read SPEC.md in full before writing any code. This file holds only the rules that must never be forgotten.

## What this project is
A WebGPU visual instrument, performed live by one human (Kiwi) to interpret a song. It is a university deliverable (course "Simulacion", Unit 6, Universidad Pontificia Bolivariana). Kiwi will present it live in full screen and defend every design choice in front of a professor. Understandability matters as much as visual quality.

## Hard constraints (never violate, never "improve" around them)
1. The ONLY behavior families allowed to drive agents are: steering behaviors (Reynolds), flocking, flow fields, and Physarum. No particle life, no reaction-diffusion, no boids-like rules that are not steering/flocking, no physics engines, no neural anything.
2. NO audio analysis. No AnalyserNode, no FFT, no beat detection, no amplitude mapping, no timeline that auto-changes state. Music is played from a plain audio element. All changes come from the human's input.
3. Everything runs on the GPU (WebGPU compute + render). No CPU per-agent loops except in the small reference/test implementations.
4. Real time, full screen, target 60 fps.
5. Every control must have a perceptible, explainable effect on perception, rules, or environment.
6. Performance model is scenes plus a few live gestures (SPEC.md section 8). Mouse and keyboard only. The performer never touches raw parameters live, no modifier keys or chords for live use, no live inputs beyond the set in 8.2 without escalating. Scenes are data (scenes.json), each a complete regime of the world. The song and the real scene content and score belong to Kiwi: ship only clearly marked PLACEHOLDER scenes.
7. Song intake: real scene content comes only from Kiwi's SONG_BRIEF.md, processed by the protocol in SPEC.md 8.9 (completeness check, ask, push back once, translate, get his approval of the scene table). A thin brief means questions in ESCALATIONS.md and placeholder scenes, never guessed content.
8. No em dashes in any prose you write (docs, comments, commit messages, logbook). Use commas, colons or parentheses.

## Autonomy rules
You are expected to work autonomously. Decide these yourself without asking: file layout, tooling, WGSL details, buffer layouts, workgroup sizes, parameter values and tuning, naming, refactors, debug overlays, small UI details, palette choices, performance tuning, test design.
Log every non-trivial autonomous decision in DECISIONS.md (date, decision, alternatives considered, why). Kiwi must be able to defend them.

Escalate (write the question in ESCALATIONS.md, then keep working on other tasks, do not block) only for: choosing the song, writing visual-score content, adding any behavior family beyond the four allowed, adding a large dependency, changing the control philosophy, anything that touches a hard constraint, deployment domain or account decisions.

## Working style
- Work in milestones (SPEC.md section 12). Commit at each milestone with a clear message.
- Prefer readable code over clever code. Comment the WHY of every rule, and what each agent perceives and how it computes its action.
- Never claim GPU behavior was tested unless it ran on a real WebGPU adapter. State test coverage limits explicitly.
- Keep EXPLAINER.md, LOGBOOK.md and DECISIONS.md current as you go, not at the end.
