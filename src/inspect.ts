// The debug overlays that need a choice or a readout (SPEC 10.2): the Physarum agent's sensors
// (key A), the boid whose perception the flock overlay shows (key G) and the buffer views (key O).
// None of them is part of the live vocabulary: they exist to explain the system in rehearsal and
// in the defense ("what does one agent see, and what does it do about it?").
//
// Choosing: when an overlay is switched on it follows the agent (or boid) nearest to the pointer at
// that moment. The nearest one is found on the GPU (pick.wgsl). The agent and boid buffers never
// change order, so the same index keeps naming the same one while it moves. To look at another,
// switch the overlay off and on with the pointer somewhere else. F (freeze) holds the picture still.
//
// The overlay itself is drawn by the GPU from numbers the agent pass writes while it runs, so it
// shows what the shader really used. Only the text readout reads the probe back, four times a
// second, and only while the overlay is on.

import type { Physarum } from './physarum/physarum';
import { MODE_EXTENDED } from './physarum/params';
import { describeProbe, readProbeWords, VIEW_NAMES } from './inspect_text';

const READ_EVERY_MS = 250;

export class Inspector {
  private reading = false;
  private lastRead = 0;
  /** Bumped by every toggle, so an answer that arrives after a later toggle is dropped. */
  private token = 0;

  constructor(
    private readonly readout: HTMLElement,
    private readonly viewLabel: HTMLElement,
    private readonly physarum: () => Physarum | null,
  ) {}

  /** Key A: follow the Physarum agent nearest to the pointer, or stop. */
  async toggleAgent(): Promise<void> {
    const p = this.physarum();
    if (!p) return;
    const token = ++this.token;
    if (p.probeOverlay) {
      p.probeOverlay = false;
      p.probeAgent = -1;
      this.readout.hidden = true;
      return;
    }
    if (!p.params.physarumOn) {
      this.say('Physarum agents are off: nothing to follow');
      return;
    }
    await p.selectAgent(p.pen.x, p.pen.y);
    if (token !== this.token) return;
    p.probeOverlay = true;
    this.readout.textContent = describeProbe(null, false);
    this.readout.hidden = false;
  }

  /** Key G: show the flock's grid and what the boid nearest to the pointer perceives, or stop. */
  async toggleFlock(): Promise<void> {
    const p = this.physarum();
    if (!p) return;
    if (p.flockDebug) {
      p.flockDebug = false;
      return;
    }
    if (p.params.flockCount > 0) await p.selectBoid(p.pen.x, p.pen.y);
    p.flockDebug = true;
  }

  /** Key O: cycle the display through the raw buffers and back to the picture. */
  cycleView(): void {
    const p = this.physarum();
    if (!p) return;
    p.viewMode = (p.viewMode + 1) % VIEW_NAMES.length;
    this.viewLabel.textContent = `VIEW: ${VIEW_NAMES[p.viewMode]}  (O for the next one)`;
    this.viewLabel.hidden = p.viewMode === 0;
  }

  /** Call every frame. Refreshes the agent readout a few times a second while the overlay is on. */
  update(now: number): void {
    const p = this.physarum();
    if (!p || !p.probeOverlay || this.reading || now - this.lastRead < READ_EVERY_MS) return;
    this.lastRead = now;
    this.reading = true;
    const token = this.token;
    p.readProbe()
      .then((words) => {
        if (token !== this.token || !p.probeOverlay) return;
        this.readout.textContent = describeProbe(readProbeWords(words), p.params.mode === MODE_EXTENDED);
      })
      .catch(() => undefined)
      .finally(() => {
        this.reading = false;
      });
  }

  private say(text: string): void {
    this.readout.textContent = text;
    this.readout.hidden = false;
    window.setTimeout(() => {
      if (!this.physarum()?.probeOverlay) this.readout.hidden = true;
    }, 2500);
  }
}
