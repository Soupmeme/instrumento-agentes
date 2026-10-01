// The scene section of the rehearsal panel (SPEC 8.7): pick a scene, capture the live state into
// a scene, export and import the scene list as JSON, restore the autosave, and rehearse a
// transition with a readout of what is changing. All rehearsal-time: none of it is part of the
// live vocabulary, and the panel is hidden in performance.

import type { Director } from './scenes/director';
import { loadAutosave, parseSceneFile, pickTextFile, sceneFileText, downloadText } from './scenes/storage';

export interface SceneToolsDeps {
  director: () => Director | null;
  /** Called after the scene list was replaced or a capture changed it, so the cue panel and autosave can follow. */
  onScenesChanged: () => void;
  /** Rebuild the parameter sliders from the live parameters (a scene switch moved them). */
  refreshSliders: () => void;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

export class SceneTools {
  private select = document.createElement('select');
  private status = document.createElement('p');
  private readout = document.createElement('pre');

  constructor(container: HTMLElement, private deps: SceneToolsDeps) {
    const heading = document.createElement('h3');
    heading.className = 'tune-group';
    heading.textContent = 'Scenes';
    container.append(heading);

    const pick = document.createElement('label');
    pick.className = 'tune-row tune-select';
    const name = document.createElement('span');
    name.className = 'tune-name';
    name.textContent = 'scene';
    this.select.addEventListener('change', () => {
      this.deps.director()?.goto(Number(this.select.value));
      this.select.blur();
      this.deps.refreshSliders();
      this.showChanges();
    });
    pick.append(name, this.select);
    pick.title = 'Switch to a scene (a normal transition). The performer uses Space, B and the number keys instead.';
    container.append(pick);

    const row1 = this.buttons(container, [
      ['Capture into this scene', () => this.capture(false), 'Overwrite the current scene with the live state. Put the wheel at the scene\'s entry value first: the snapshot takes the state as it is.'],
      ['Capture as new scene', () => this.capture(true), 'Append the live state as a new scene that copies the current scene\'s pen, wheel, accent and entry settings.'],
    ]);
    row1.className = 'tune-buttons tune-wrap';
    this.buttons(container, [
      ['Export JSON', () => this.export(), 'Download all scenes as a JSON file you can edit by hand.'],
      ['Import JSON', () => void this.import(), 'Replace the scenes with a JSON file. Bad values are clamped or dropped and listed here.'],
      ['Restore autosave', () => this.restore(), 'Reload the scenes saved automatically in this browser the last time you edited.'],
    ]).className = 'tune-buttons tune-wrap';
    this.buttons(container, [
      ['Rehearse: next scene', () => this.rehearse(), 'Switch to the next scene and list which parameters the transition changes, biggest first.'],
    ]);
    this.status.className = 'tune-hint';
    this.readout.className = 'tune-readout';
    container.append(this.status, this.readout);
    this.refresh();
  }

  private buttons(container: HTMLElement, defs: [string, () => void, string][]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'tune-buttons';
    for (const [label, fn, hint] of defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = hint;
      b.addEventListener('click', () => {
        fn();
        b.blur(); // a focused button would swallow the live keys (Space would press it again)
      });
      box.append(b);
    }
    container.append(box);
    return box;
  }

  private say(message: string): void {
    this.status.textContent = message;
  }

  /** Rebuild the scene list (after a switch, a capture, an import). */
  refresh(): void {
    const d = this.deps.director();
    this.select.replaceChildren();
    d?.scenes.forEach((s, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${i + 1}  ${s.name}`;
      this.select.append(o);
    });
    if (d) this.select.value = String(d.index);
    const saved = loadAutosave();
    this.say(saved ? `Autosave from ${new Date(saved.savedAt).toLocaleTimeString()} available.` : 'No autosave yet (edits are saved in this browser as you make them).');
  }

  private showChanges(): void {
    const d = this.deps.director();
    if (!d) return;
    const top = d.lastChanges.slice(0, 14).map((c) => `${c.key.padEnd(18)} ${fmt(c.from)} -> ${fmt(c.to)}`);
    const more = d.lastChanges.length - top.length;
    this.readout.textContent = top.length
      ? `Changing for "${d.scene?.name}" (${d.scene?.entry.seconds}s, ${d.scene?.entry.easing}):\n${top.join('\n')}${more > 0 ? `\n... and ${more} smaller` : ''}`
      : 'Nothing changes.';
  }

  private capture(asNew: boolean): void {
    const d = this.deps.director();
    const s = d?.capture(asNew);
    if (!d || !s) return this.say('Could not capture.');
    this.deps.onScenesChanged();
    this.refresh();
    this.say(asNew ? `Captured as scene ${d.index + 1}: ${s.name}.` : `Scene ${d.index + 1} now holds the live state.`);
  }

  private export(): void {
    const d = this.deps.director();
    if (!d) return;
    downloadText('scenes.json', sceneFileText(d.scenes));
    this.say(`Exported ${d.scenes.length} scenes. To keep them as the starting scenes, replace src/scenes/scenes.json with the file.`);
  }

  private async import(): Promise<void> {
    const d = this.deps.director();
    const text = await pickTextFile();
    if (!d || text === null) return;
    const { scenes, problems } = parseSceneFile(text);
    if (!scenes.length) return this.say(`Nothing imported. ${problems.slice(0, 4).join(' ')}`);
    d.setScenes(scenes, 0);
    d.goto(0);
    this.deps.onScenesChanged();
    this.deps.refreshSliders();
    this.refresh();
    this.say(`Imported ${scenes.length} scenes.${problems.length ? ` ${problems.length} problems: ${problems.slice(0, 3).join(' ')}` : ''}`);
  }

  private restore(): void {
    const d = this.deps.director();
    const saved = loadAutosave();
    if (!d || !saved) return this.say('No autosave to restore.');
    d.setScenes(saved.scenes, 0);
    d.goto(0);
    this.deps.onScenesChanged();
    this.deps.refreshSliders();
    this.refresh();
    this.say(`Restored ${saved.scenes.length} scenes saved at ${new Date(saved.savedAt).toLocaleTimeString()}.`);
  }

  private rehearse(): void {
    const d = this.deps.director();
    if (!d) return;
    if (!d.next()) return this.say('This is the last scene. Pick scene 1 above to rehearse again.');
    this.deps.refreshSliders();
    this.refresh();
    this.showChanges();
  }
}
