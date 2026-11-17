import {
  BAR_OPTIONS, KEYS, PRESETS, STEPS, TRACK_COUNT,
  clamp, fadeEdges, makePattern, midiToHz, mutatePattern,
  nextBarBoundary, scramblePcm
} from '../lib/music.js';

const TRACK_COLORS = ['#79e0ff', '#e8acff', '#ffc47c', '#7fffc8', '#ff8b9a', '#b6b9ff', '#f8db88', '#8ee9ca'];
const SAMPLE_KEYS = ['kick', 'snare', 'hat', 'clap', 'bass', 'lead'];

const makeTrack = (index) => ({
  id: index, name: 'LOOP ' + String(index + 1).padStart(2, '0'),
  color: TRACK_COLORS[index], bars: 1, volume: 0.85,
  cutoff: 16000, pan: 0, muted: false, solo: false, pcm: null, buffer: null,
  node: null
});

function createDistortionCurve(amount) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const k = amount * 4;
  for (let i = 0; i < samples; i++) {
    const x = i * 2 / (samples - 1) - 1;
    curve[i] = k < 0.005 ? x : Math.tanh(x * (1 + k)) / Math.tanh(1 + k);
  }
  return curve;
}

export class LoopForgeEngine {
  constructor() {
    this.ctx = null;
    this.powered = false;
    this.playing = false;
    this.bpm = 92;
    this.key = 0;
    this.swing = 0;
    this.steps = makePattern();
    this.tracks = Array.from({ length: TRACK_COUNT }, (_, i) => makeTrack(i));
    this.selected = 0;
    this.currentStep = -1;
    this.masterVolume = 0.78;
    this.fx = { cutoff: 19000, drive: 0, delay: 0.12 };
    this.micEnabled = false;
    this.monitorEnabled = false;
    this.recording = null;
    this.exporting = false;
    this.listeners = new Set();
    this.scheduledLoops = new Set();
    this.undoSnapshot = null;
    this.nextJobId = 1;
    this.loadLocal();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  snapshot() {
    return {
      powered: this.powered, playing: this.playing, bpm: this.bpm,
      key: this.key, swing: this.swing, pattern: this.steps,
      currentStep: this.currentStep, selected: this.selected,
      tracks: this.tracks.map(t => ({
        id: t.id, name: t.name, color: t.color, bars: t.bars,
        volume: t.volume, cutoff: t.cutoff, pan: t.pan,
        muted: t.muted, solo: t.solo, hasAudio: !!t.pcm,
        seconds: t.pcm ? t.pcm.length / (this.ctx?.sampleRate || 48000) : 0
      })),
      masterVolume: this.masterVolume, fx: { ...this.fx },
      micEnabled: this.micEnabled, monitorEnabled: this.monitorEnabled,
      recording: this.recording ? { ...this.recording } : null,
      exporting: this.exporting, canUndo: !!this.undoSnapshot
    };
  }

  async power() {
    if (this.powered) {
      await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not supported in this browser.');
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    await ctx.audioWorklet.addModule(import.meta.env.BASE_URL + 'pcm-recorder.js');

    this.mix = ctx.createGain();
    this.mix.gain.value = 0.85;
    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.drive = ctx.createWaveShaper();
    this.drive.oversample = '2x';
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -8;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.streamDestination = ctx.createMediaStreamDestination();

    this.mix.connect(this.masterFilter);
    this.masterFilter.connect(this.drive);
    this.drive.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.master.connect(this.streamDestination);

    this.delayInput = ctx.createGain();
    this.delayNode = ctx.createDelay(2);
    this.delayNode.delayTime.value = 60 / this.bpm * 0.75;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.28;
    this.delayReturn = ctx.createGain();
    this.delayInput.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayReturn);
    this.delayReturn.connect(this.masterFilter);
    this.mix.connect(this.delayInput);

    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0.75;
    this.drumBus.connect(this.mix);

    for (const t of this.tracks) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      filter.connect(gain).connect(pan).connect(this.mix);
      t.node = { filter, gain, pan };
    }

    this.captureSink = ctx.createGain();
    this.captureSink.gain.value = 0;
    this.captureSink.connect(ctx.destination);
    this.micCapture = new AudioWorkletNode(ctx, 'phi-capture', { outputChannelCount: [1] });
    this.mixCapture = new AudioWorkletNode(ctx, 'phi-capture', { outputChannelCount: [1] });
    this.micCapture.connect(this.captureSink);
    this.master.connect(this.mixCapture);
    this.mixCapture.connect(this.captureSink);
    this.micCapture.port.onmessage = ({ data }) => this.onCaptureDone(data);
    this.mixCapture.port.onmessage = ({ data }) => this.onCaptureDone(data);

    this.micAnalyser = ctx.createAnalyser();
    this.micAnalyser.fftSize = 1024;
    this.micAnalyser.connect(this.captureSink);

    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
    const noiseData = this.noise.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

    this.powered = true;
    this.applySettings();
    await ctx.resume();
    this.emit();
  }

  async enableMic() {
    await this.power();
    if (this.micEnabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture requires HTTPS or localhost and a compatible browser.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    this.micStream = stream;
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.monitor = this.ctx.createGain();
    this.monitor.gain.value = 0;
    this.micSource.connect(this.micCapture);
    this.micSource.connect(this.micAnalyser);
    this.micSource.connect(this.monitor);
    this.monitor.connect(this.mix);
    this.micEnabled = true;
    this.emit();
  }

  toggleMonitor() {
    if (!this.micEnabled) throw new Error('Enable the microphone first.');
    this.monitorEnabled = !this.monitorEnabled;
    this.monitor.gain.setTargetAtTime(this.monitorEnabled ? 0.8 : 0, this.ctx.currentTime, 0.02);
    this.emit();
  }

  applySettings() {
    if (!this.powered) return;
    const time = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.masterVolume, time, 0.02);
    this.masterFilter.frequency.setTargetAtTime(this.fx.cutoff, time, 0.02);
    this.drive.curve = createDistortionCurve(this.fx.drive);
    this.delayInput.gain.setTargetAtTime(this.fx.delay, time, 0.02);
    this.delayReturn.gain.setTargetAtTime(Math.min(0.5, this.fx.delay), time, 0.02);
    this.delayNode.delayTime.setTargetAtTime(60 / this.bpm * 0.75, time, 0.03);
    const anySolo = this.tracks.some(t => t.solo);
    for (const t of this.tracks) {
      if (!t.node) continue;
      t.node.gain.gain.setTargetAtTime(t.muted || (anySolo && !t.solo) ? 0 : t.volume, time, 0.02);
      t.node.filter.frequency.setTargetAtTime(t.cutoff, time, 0.02);
      t.node.pan.pan.setTargetAtTime(t.pan, time, 0.02);
    }
  }

  start() {
    if (!this.powered) throw new Error('Power on the audio engine first.');
    if (this.playing) return;
    this.ctx.resume();
    this.playing = true;
    this.origin = this.ctx.currentTime + 0.15;
    this.nextStepTime = this.origin;
    this.nextStepNumber = 0;
    this.currentStep = -1;
    this.scheduler();
    this.timer = window.setInterval(() => this.scheduler(), 25);
    this.emit();
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.currentStep = -1;
    if (this.recording) this.cancelCapture();
    for (const source of this.scheduledLoops) {
      try { source.stop(); } catch { /* source has already ended */ }
    }
    this.scheduledLoops.clear();
    this.emit();
  }

  scheduler() {
    if (!this.playing) return;
    const secondsPerStep = 60 / this.bpm / 4;
    let safeguard = 0;
    while (this.nextStepTime < this.ctx.currentTime + 0.12 && safeguard++ < 96) {
      const step = this.nextStepNumber % STEPS;
      const swingOffset = step % 2 ? secondsPerStep * this.swing : 0;
      this.scheduleStep(this.nextStepTime + swingOffset, step, Math.floor(this.nextStepNumber / STEPS));
      this.currentStep = step;
      this.nextStepNumber++;
      this.nextStepTime = this.origin + this.nextStepNumber * secondsPerStep;
      this.emit();
    }
  }

  scheduleStep(at, step, bar) {
    if (step === 0) {
      for (const track of this.tracks) {
        if (!track.buffer || bar % track.bars !== 0) continue;
        const source = this.ctx.createBufferSource();
        source.buffer = track.buffer;
        source.playbackRate.value = track.buffer.duration / (track.bars * 240 / this.bpm);
        source.connect(track.node.filter);
        source.start(at);
        this.scheduledLoops.add(source);
        source.onended = () => this.scheduledLoops.delete(source);
      }
    }
    for (const key of SAMPLE_KEYS) {
      if (!this.steps[key][step]) continue;
      this.hit(key, at, step);
    }
  }

  voice(type, frequency, start, length, peak = 0.4, wave = 'sine') {
    const ctx = this.ctx;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(envelope).connect(this.drumBus);
    oscillator.start(start);
    oscillator.stop(start + length + 0.01);
    return oscillator;
  }

  noiseHit(start, length, peak, cutoff, highpass = true) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = highpass ? 'highpass' : 'lowpass';
    filter.frequency.value = cutoff;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(Math.max(0.0001, peak), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(filter).connect(envelope).connect(this.drumBus);
    source.start(start);
    source.stop(start + length);
  }

  hit(type, at, step = 0) {
    if (!this.powered) return;
    const t = Math.max(at, this.ctx.currentTime + 0.002);
    if (type === 'kick') {
      const osc = this.voice('kick', 150, t, 0.32, 0.83);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    } else if (type === 'snare') {
      this.noiseHit(t, 0.16, 0.48, 1700);
      this.voice('snare', 175, t, 0.11, 0.18, 'triangle');
    } else if (type === 'hat') {
      this.noiseHit(t, step % 4 === 2 ? 0.095 : 0.05, 0.21, 6500);
    } else if (type === 'clap') {
      [0, 0.025, 0.05].forEach(offset => this.noiseHit(t + offset, 0.075, 0.18, 1150));
    } else if (type === 'bass') {
      const degrees = [0, 0, 3, 0, 5, 3, 7, 5, 0, 3, 0, 7, 5, 3, 10, 7];
      this.voice('bass', midiToHz(36 + this.key + degrees[step]), t, 0.23, 0.45, 'sawtooth');
    } else if (type === 'lead') {
      const degrees = [12, 15, 19, 22, 15, 12, 10, 7, 12, 19, 15, 22, 24, 19, 15, 12];
      this.voice('lead', midiToHz(60 + this.key + degrees[step] - 12), t, 0.17, 0.16, 'triangle');
    }
  }

  setPattern(row, index) {
    if (!SAMPLE_KEYS.includes(row) || index < 0 || index >= STEPS) return;
    this.steps = { ...this.steps, [row]: this.steps[row].map((on, i) => i === index ? !on : on) };
    this.persist();
    this.emit();
  }

  loadPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    this.steps = makePattern(name);
    this.setTempo(preset.bpm);
    this.persist();
    this.emit();
  }

  setTempo(bpm) {
    const next = Math.round(clamp(bpm, 50, 200));
    if (this.recording) throw new Error('Finish the recording before changing tempo.');
    if (this.playing) this.stop();
    this.bpm = next;
    this.applySettings();
    this.persist();
    this.emit();
  }

  setKey(note) {
    this.key = ((Math.round(note) % 12) + 12) % 12;
    this.persist(); this.emit();
  }

  setSwing(value) {
    this.swing = clamp(value, 0, 0.45);
    this.persist(); this.emit();
  }

  setMaster(value) {
    this.masterVolume = clamp(value, 0, 1);
    this.applySettings(); this.persist(); this.emit();
  }

  setFX(name, value) {
    if (!(name in this.fx)) return;
    const limits = { cutoff: [300, 20000], drive: [0, 1], delay: [0, 0.5] };
    this.fx[name] = clamp(value, ...limits[name]);
    this.applySettings(); this.persist(); this.emit();
  }

  selectTrack(index) {
    this.selected = Math.round(clamp(index, 0, TRACK_COUNT - 1));
    this.emit();
  }

  setTrack(index, key, value) {
    const track = this.tracks[index];
    if (!track) return;
    if (key === 'muted' || key === 'solo') track[key] = Boolean(value);
    if (key === 'volume') track.volume = clamp(value, 0, 1);
    if (key === 'pan') track.pan = clamp(value, -1, 1);
    if (key === 'cutoff') track.cutoff = clamp(value, 300, 20000);
    if (key === 'bars' && BAR_OPTIONS.includes(Number(value))) track.bars = Number(value);
    this.applySettings(); this.persist(); this.emit();
  }

  clearTrack(index) {
    const track = this.tracks[index];
    if (!track || this.recording?.track === index) return;
    track.pcm = null; track.buffer = null;
    this.undoSnapshot = null;
    this.emit();
  }

  armCapture(index, bars = 1, mode = 'replace') {
    if (!this.playing) throw new Error('Press PLAY before recording. Loops start on the next bar.');
    if (this.recording) throw new Error('Another loop is already armed or recording.');
    if (mode !== 'resample' && !this.micEnabled) throw new Error('Enable the microphone before recording.');
    const track = this.tracks[index];
    if (!track) return;
    if (mode === 'overdub' && !track.buffer) mode = 'replace';
    if (mode === 'overdub') bars = track.bars;
    const count = BAR_OPTIONS.includes(Number(bars)) ? Number(bars) : 1;
    const barSeconds = 240 / this.bpm;
    const start = nextBarBoundary(this.ctx.currentTime, this.origin, barSeconds, 0.2);
    const end = start + count * barSeconds;
    const id = this.nextJobId++;
    const worklet = mode === 'resample' ? this.mixCapture : this.micCapture;
    this.recording = { id, track: index, bars: count, mode, start, end, phase: 'armed' };
    worklet.port.postMessage({
      type: 'record', id,
      startFrame: Math.round(start * this.ctx.sampleRate),
      endFrame: Math.round(end * this.ctx.sampleRate)
    });
    this.recordTimer = window.setInterval(() => {
      if (!this.recording) return;
      this.recording.phase = this.ctx.currentTime < start ? 'armed' : 'capturing';
      this.emit();
    }, 90);
    this.emit();
  }

  cancelCapture() {
    this.micCapture?.port.postMessage({ type: 'cancel' });
    this.mixCapture?.port.postMessage({ type: 'cancel' });
    if (this.recordTimer) window.clearInterval(this.recordTimer);
    this.recordTimer = null;
    this.recording = null;
    this.emit();
  }

  onCaptureDone(data) {
    if (data.type !== 'done' || !this.recording || this.recording.id !== data.id) return;
    const job = this.recording;
    const track = this.tracks[job.track];
    const samples = data.pcm;
    if (job.mode === 'overdub' && track.pcm) {
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.tanh(samples[i] + track.pcm[i % track.pcm.length] * 0.93);
      }
    }
    fadeEdges(samples, this.ctx.sampleRate);
    this.assignPCM(track, samples, job.bars);
    if (this.recordTimer) window.clearInterval(this.recordTimer);
    this.recordTimer = null;
    this.recording = null;
    this.undoSnapshot = null;
    this.emit();
  }

  assignPCM(track, pcm, bars) {
    track.pcm = pcm;
    track.bars = bars;
    const buffer = this.ctx.createBuffer(1, pcm.length, this.ctx.sampleRate);
    buffer.copyToChannel(pcm, 0);
    track.buffer = buffer;
  }

  chaos() {
    if (!this.powered) throw new Error('Power on the audio engine first.');
    this.undoSnapshot = {
      pattern: Object.fromEntries(SAMPLE_KEYS.map(key => [key, [...this.steps[key]]])),
      pcm: this.tracks.map(t => t.pcm ? t.pcm.slice() : null),
      bars: this.tracks.map(t => t.bars)
    };
    this.steps = mutatePattern(this.steps);
    for (const track of this.tracks) {
      if (track.pcm) this.assignPCM(track, fadeEdges(scramblePcm(track.pcm), this.ctx.sampleRate), track.bars);
    }
    this.persist();
    this.emit();
  }

  undoChaos() {
    if (!this.undoSnapshot) return;
    this.steps = this.undoSnapshot.pattern;
    this.tracks.forEach((t, i) => {
      if (this.undoSnapshot.pcm[i]) this.assignPCM(t, this.undoSnapshot.pcm[i], this.undoSnapshot.bars[i]);
    });
    this.undoSnapshot = null;
    this.persist(); this.emit();
  }

  startExport() {
    if (!this.powered) throw new Error('Power on first.');
    if (this.exporting) return;
    if (!window.MediaRecorder) throw new Error('Performance export is unavailable in this browser.');
    const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
    const type = preferred.find(t => MediaRecorder.isTypeSupported(t));
    this.mediaRecorder = new MediaRecorder(this.streamDestination.stream, type ? { mimeType: type } : {});
    const chunks = [];
    this.mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    this.mediaRecorder.onstop = () => {
      const mime = this.mediaRecorder.mimeType;
      const extension = mime.includes('mp4') ? 'm4a' : 'webm';
      const blob = new Blob(chunks, { type: mime });
      if (blob.size) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'PhiMikeyTron369-performance-' + Date.now() + '.' + extension;
        document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      this.exporting = false;
      this.emit();
    };
    this.mediaRecorder.start(250);
    this.exporting = true;
    this.emit();
  }

  stopExport() {
    if (this.exporting && this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
  }

  serialize() {
    return {
      version: 1, bpm: this.bpm, key: this.key, swing: this.swing,
      pattern: this.steps, masterVolume: this.masterVolume, fx: this.fx,
      tracks: this.tracks.map(t => ({
        bars: t.bars, volume: t.volume, cutoff: t.cutoff, pan: t.pan,
        muted: t.muted, solo: t.solo
      }))
    };
  }

  hydrate(data) {
    if (!data || typeof data !== 'object') return;
    if (this.recording) return;
    if (this.playing) this.stop();
    if (Number.isFinite(data.bpm)) this.bpm = Math.round(clamp(data.bpm, 50, 200));
    if (Number.isFinite(data.key)) this.key = Math.round(clamp(data.key, 0, 11));
    if (Number.isFinite(data.swing)) this.swing = clamp(data.swing, 0, 0.45);
    if (data.pattern && SAMPLE_KEYS.every(key => Array.isArray(data.pattern[key]) && data.pattern[key].length === STEPS)) {
      this.steps = Object.fromEntries(SAMPLE_KEYS.map(key => [key, data.pattern[key].map(Boolean)]));
    }
    if (Number.isFinite(data.masterVolume)) this.masterVolume = clamp(data.masterVolume, 0, 1);
    if (data.fx && typeof data.fx === 'object') {
      for (const key of ['cutoff', 'drive', 'delay']) {
        if (Number.isFinite(data.fx[key])) {
          const bounds = { cutoff: [300, 20000], drive: [0, 1], delay: [0, 0.5] };
          this.fx[key] = clamp(data.fx[key], ...bounds[key]);
        }
      }
    }
    if (Array.isArray(data.tracks)) {
      data.tracks.slice(0, TRACK_COUNT).forEach((source, i) => {
        if (!source || typeof source !== 'object') return;
        for (const key of ['volume', 'cutoff', 'pan', 'bars', 'muted', 'solo']) {
          if (source[key] !== undefined) this.setTrack(i, key, source[key]);
        }
      });
    }
    this.applySettings();
    this.persist(); this.emit();
  }

  downloadProject() {
    const blob = new Blob([JSON.stringify(this.serialize(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'PhiMikeyTron369-preset.json';
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  persist() {
    try { window.localStorage.setItem('phi-mikeytron-settings-v1', JSON.stringify(this.serialize())); }
    catch { /* storage disabled or full */ }
  }

  loadLocal() {
    try {
      const item = window.localStorage.getItem('phi-mikeytron-settings-v1');
      if (item) this.hydrate(JSON.parse(item));
    } catch { /* invalid stored settings */ }
  }

  getSpectrum() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  micLevel() {
    if (!this.micEnabled || !this.micAnalyser) return 0;
    const data = new Uint8Array(this.micAnalyser.fftSize);
    this.micAnalyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) { const x = (value - 128) / 128; sum += x * x; }
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  }

  dispose() {
    this.stop();
    this.stopExport();
    if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close();
  }
}

export const KEY_NAMES = KEYS;
export const PRESET_NAMES = Object.keys(PRESETS);
