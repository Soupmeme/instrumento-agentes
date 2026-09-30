// WebGPU device setup. Kept small and free of app logic so a lost device can be
// recreated by simply calling initGpu again (see main.ts).

export interface Gpu {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  /** True when GPU timestamp queries can be used for frame timing (later milestones). */
  hasTimestampQuery: boolean;
}

/** Thrown for problems the performer should read as a plain sentence, not a stack trace. */
export class GpuUnavailableError extends Error {}

export async function initGpu(canvas: HTMLCanvasElement): Promise<Gpu> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    throw new GpuUnavailableError(
      'WebGPU is not available in this browser.\nUse a recent Chrome or Edge on a machine with a supported GPU.',
    );
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new GpuUnavailableError(
      'No WebGPU adapter was found.\nCheck that hardware acceleration is enabled and the GPU driver is up to date.',
    );
  }

  // timestamp-query is optional. Without it we time frames on the CPU and say so in the HUD.
  const hasTimestampQuery = adapter.features.has('timestamp-query');
  const requiredFeatures: GPUFeatureName[] = hasTimestampQuery ? ['timestamp-query'] : [];

  // Later milestones need large storage buffers (millions of agents). Ask for what the
  // adapter offers, not the spec minimum, so agent counts are not capped by defaults.
  const requiredLimits: Record<string, number> = {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
  };

  const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new GpuUnavailableError('The canvas could not create a WebGPU context.');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  // alphaMode opaque: the page background is never meant to show through the artwork.
  context.configure({ device, format, alphaMode: 'opaque' });

  return { adapter, device, context, format, canvas, hasTimestampQuery };
}

/**
 * Match the canvas backing store to its CSS size times devicePixelRatio times the
 * resolution scale. Returns true when the size changed (callers must then rebuild
 * any resolution-dependent textures).
 */
export function resizeCanvas(canvas: HTMLCanvasElement, resolutionScale: number): boolean {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr * resolutionScale));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr * resolutionScale));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
