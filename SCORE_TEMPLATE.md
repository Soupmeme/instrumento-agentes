# SCORE_TEMPLATE (Plantilla de partitura visual)

A blank visual score. It is for you to fill, in your own words, once you have chosen the song and written the scene table (SPEC 8.9). Nothing here is content: the song, the passages, the feelings and the choices of gesture are yours. A printable version of the same page is `SCORE_TEMPLATE.html` (A4 landscape).

The score is a list of **scenes** and **gestures**, not of keystrokes and not of parameters. It guides the performance and never automates it: the instrument changes only when you act. That is why there is no column for a parameter value; the scene already is a complete state of the world, and the gestures are the five things your hands can do.

## The piece (La pieza)

| Field (Campo) | Entry (Anotación) |
|---|---|
| Song (Canción) | |
| Artist (Artista) | |
| Length (Duración) | |
| Version or file played (Versión o archivo) | |
| Date of this score (Fecha de esta partitura) | |
| In one sentence, what I want the audience to feel (En una frase, lo que quiero que sienta el público) | |

## The scenes (Las escenas)

One row per scene of `src/scenes/scenes.json`, in the order they are played (the keys are Space, B, and 1 to 9). Write what each scene is *for*, in words you would say out loud while defending it.

| Key (Tecla) | Scene name (Nombre de la escena) | What this scene is (Qué es esta escena) | What the pen does here (Qué hace el pincel) | What the wheel does here (Qué hace la rueda) | What a click does here (Qué hace el clic) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |

## The score (La partitura)

One row per passage of the song. Fill the columns from left to right. Leave a cell empty if nothing happens there.

| # | Time or passage (Tiempo o pasaje) | What I hear (Lo que escucho) | Scene to be in (Escena en la que estoy) | Intended feeling (Sentimiento buscado) | Pen (Pincel) | Wheel level (Nivel de la rueda) | Accent hits (Acentos) | Stir (Remover) | Freeze (Congelar) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | |
| 2 | | | | | | | | | |
| 3 | | | | | | | | | |
| 4 | | | | | | | | | |
| 5 | | | | | | | | | |
| 6 | | | | | | | | | |
| 7 | | | | | | | | | |
| 8 | | | | | | | | | |
| 9 | | | | | | | | | |
| 10 | | | | | | | | | |
| 11 | | | | | | | | | |
| 12 | | | | | | | | | |

### What each column holds (Qué va en cada columna)

- **Time or passage:** a timestamp from the cue panel's clock (key C), or a name for the passage ("the second verse", "the drop"). The clock only shows you the time; it triggers nothing.
- **What I hear:** the music, in your words (an instrument comes in, the voice stops, the bass drops out).
- **Scene to be in:** the scene (by name or by its number) that holds this passage. Moving to it is one key: Space, B or a digit. If the passage needs no change of scene, repeat the one before.
- **Intended feeling:** what the picture should do to the listener here.
- **Pen:** where the pointer should be and what it should do on this passage (resting at an edge, circling, following a vein, staying out of the way). The pen's meaning belongs to the scene, so use the words of the scene table above.
- **Wheel level:** low, middle or high, or 0 to 1. One notch is about a twelfth of the range.
- **Accent hits:** where the clicks land, and roughly how many (none, one on the downbeat, a short run).
- **Stir:** where you hold the right button and drag, if at all.
- **Freeze:** passages where you hold the picture still (key F) and for how long.

## Rehearsal log (Registro de ensayos)

| Run (Ensayo) | Date (Fecha) | What went well (Qué salió bien) | What to change in the score (Qué cambiar en la partitura) | What to change in a scene (Qué cambiar en una escena) |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

## Before the performance (Antes de la presentación)

- [ ] The scene table matches `scenes.json` (open the cue panel, key C, and read the list).
- [ ] The song plays from the same file or link you will use in front of the class.
- [ ] I have walked the whole score at least once with the real song.
- [ ] I know where S (safe mode) is, in case the picture stutters.
- [ ] The help overlay (key H) is closed.
