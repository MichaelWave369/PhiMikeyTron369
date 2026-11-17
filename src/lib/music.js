export const STEPS = 16;
export const ROWS = ['kick', 'snare', 'hat', 'clap', 'bass', 'lead'];
export const TRACK_COUNT = 8;
export const BAR_OPTIONS = [1, 2, 4];
export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const PRESETS = {
  'Boom Bap': {
    bpm: 92,
    pattern: {
      kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14],
      clap: [12], bass: [0, 3, 7, 10, 14], lead: [2, 6, 11, 15]
    }
  },
  'Four on Floor': {
    bpm: 124,
    pattern: {
      kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14],
      clap: [4, 12], bass: [0, 4, 7, 10, 12], lead: [3, 7, 11, 15]
    }
  },
  'Broken Funk': {
    bpm: 108,
    pattern: {
      kick: [0, 3, 7, 10, 14], snare: [4, 11, 12], hat: [0, 2, 3, 6, 8, 10, 11, 14],
      clap: [12], bass: [0, 3, 6, 9, 14], lead: [1, 5, 9, 13]
    }
  },
  'Blank Canvas': {
    bpm: 100,
    pattern: { kick: [], snare: [], hat: [], clap: [], bass: [], lead: [] }
  }
};

export function makePattern(preset = 'Boom Bap') {
  const source = PRESETS[preset]?.pattern || PRESETS['Boom Bap'].pattern;
  return Object.fromEntries(ROWS.map(row => [row, Array.from({ length: STEPS }, (_, step) => source[row].includes(step))]));
}

export function nextBarBoundary(now, origin, barSeconds, lead = 0.16) {
  if (!Number.isFinite(barSeconds) || barSeconds <= 0) throw new Error('Invalid bar duration');
  return origin + Math.max(0, Math.ceil((now + lead - origin) / barSeconds)) * barSeconds;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function mutatePattern(pattern, rng = Math.random) {
  const next = Object.fromEntries(ROWS.map(row => [row, [...pattern[row]]]));
  for (const row of ROWS) {
    for (let step = 0; step < STEPS; step++) {
      if (rng() < (row === 'kick' ? 0.1 : 0.17)) next[row][step] = !next[row][step];
    }
  }
  next.kick[0] = true;
  return next;
}

/* Rearrange 8 equal slices of mono PCM without modifying the source. */
export function scramblePcm(source, rng = Math.random) {
  const slices = 8;
  const result = new Float32Array(source.length);
  const order = Array.from({ length: slices }, (_, i) => i);
  for (let i = slices - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < slices; i++) {
    const start = Math.floor(i * source.length / slices);
    const end = Math.floor((i + 1) * source.length / slices);
    const from = Math.floor(order[i] * source.length / slices);
    const fromEnd = Math.floor((order[i] + 1) * source.length / slices);
    const reverse = rng() < 0.22;
    for (let j = 0; j < end - start; j++) {
      const span = fromEnd - from;
      const offset = Math.min(span - 1, Math.floor(j * span / (end - start)));
      result[start + j] = source[from + (reverse ? span - 1 - offset : offset)] || 0;
    }
  }
  return result;
}

export function fadeEdges(pcm, sampleRate, fadeMs = 3) {
  const count = Math.min(Math.floor(sampleRate * fadeMs / 1000), Math.floor(pcm.length / 2));
  for (let i = 0; i < count; i++) {
    const gain = i / Math.max(1, count);
    pcm[i] *= gain;
    pcm[pcm.length - 1 - i] *= gain;
  }
  return pcm;
}

export function midiToHz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
