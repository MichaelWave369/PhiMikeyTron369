import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LoopForgeEngine, KEY_NAMES, PRESET_NAMES } from './audio/LoopForgeEngine.js';
import { ROWS, STEPS } from './lib/music.js';

const LABELS = { kick: 'KICK', snare: 'SNARE', hat: 'HI-HAT', clap: 'CLAP', bass: 'BASS', lead: 'LEAD' };
const HINTS = {
  kick: 'Sub pulse', snare: 'Noise snap', hat: 'High air',
  clap: 'Triple slap', bass: 'Analog low', lead: 'Melodic spark'
};
const trackIcons = ['◉', '✺', '◇', '∿', '◈', '✳', '◎', '◌'];

function MiniSpectrum({ engine, powered, playing }) {
  const canvas = useRef(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let handle = 0;
    const draw = () => {
      const width = el.clientWidth || 650;
      const height = el.clientHeight || 128;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      const context = el.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const data = engine.getSpectrum();
      const columns = Math.max(24, Math.floor(width / 11));
      const columnWidth = width / columns;
      for (let i = 0; i < columns; i++) {
        const index = Math.floor(Math.pow(i / columns, 1.75) * (data?.length || 512) * 0.55);
        const frequency = data ? data[Math.min(index, data.length - 1)] / 255 : 0;
        const idle = !powered ? (Math.sin(i * 0.59) + Math.sin(i * 0.14)) * 0.07 + 0.13 : 0.025;
        const level = Math.max(0.018, frequency, idle);
        const barHeight = Math.min(height - 8, Math.pow(level, 1.45) * height * 1.36);
        const x = i * columnWidth;
        const gradient = context.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, '#5ccedb');
        gradient.addColorStop(0.6, '#84f6df');
        gradient.addColorStop(1, '#e5fcaa');
        context.fillStyle = gradient;
        context.fillRect(x + 1.3, height - barHeight, Math.max(1, columnWidth - 3), barHeight);
      }
      handle = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(handle);
  }, [engine, powered, playing]);
  return <canvas className="spectrum" ref={canvas} aria-label="Animated audio spectrum visualizer" role="img" />;
}

function Slider({ label, value, min, max, step = 0.01, onChange, format = (x) => x, id }) {
  return (
    <label className="control-slider" htmlFor={id}>
      <span className="slider-line"><span>{label}</span><strong>{format(value)}</strong></span>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={event => onChange(Number(event.target.value))} />
    </label>
  );
}

function TooltipKey({ children }) { return <kbd>{children}</kbd>; }

export default function App() {
  const engine = useMemo(() => new LoopForgeEngine(), []);
  const [state, setState] = useState(() => engine.snapshot());
  const [message, setMessage] = useState('Ready to make something ridiculous.');
  const [preset, setPreset] = useState('Boom Bap');
  const [micLevel, setMicLevel] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const importInput = useRef(null);

  useEffect(() => engine.subscribe(setState), [engine]);
  useEffect(() => {
    let frame;
    let last = 0;
    const loop = (time) => {
      if (time - last > 80) { setMicLevel(engine.micLevel()); last = time; }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  const run = async (action, success) => {
    try {
      await action();
      if (success) setMessage(success);
    } catch (err) {
      setMessage('⚠ ' + (err?.message || String(err)));
    }
  };

  const togglePlay = () => run(async () => {
    if (!engine.powered) await engine.power();
    if (engine.playing) engine.stop();
    else engine.start();
  }, engine.playing ? 'Transport stopped.' : 'The groove is alive.');

  const arm = (mode = 'replace') => run(async () => {
    if (!engine.powered) await engine.power();
    if (mode !== 'resample' && !engine.micEnabled) await engine.enableMic();
    if (!engine.playing) engine.start();
    engine.armCapture(engine.selected, engine.tracks[engine.selected].bars, mode);
  }, mode === 'resample' ? 'Resampling the master to this track on the next bar.' :
    mode === 'overdub' ? 'Overdub armed. Recording begins on the next bar.' :
    'Microphone loop armed. Recording begins on the next bar.');

  useEffect(() => {
    const keydown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag) || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      else if (event.key.toLowerCase() === 'r') { event.preventDefault(); arm(); }
      else if (/^[1-8]$/.test(event.key)) engine.selectTrack(Number(event.key) - 1);
      else if (event.key.toLowerCase() === 'c') run(() => engine.chaos(), 'The chaos gremlins have entered the studio.');
      else if (event.key.toLowerCase() === 'z') engine.undoChaos();
      else if (event.key === 'Escape' && engine.recording) engine.cancelCapture();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const selected = state.tracks[state.selected];
  const activeCapture = state.recording;
  const captureOfSelected = activeCapture?.track === state.selected;
  const status = activeCapture ? (activeCapture.phase === 'armed' ? 'ARMED' : 'CAPTURING') :
    state.playing ? 'PLAYING' : state.powered ? 'IDLE' : 'STANDBY';

  const downloadImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await run(async () => {
      const source = JSON.parse(await file.text());
      engine.hydrate(source);
    }, 'Preset imported. Audio clips are not part of JSON presets.');
    event.target.value = '';
  };

  return (
    <div className="app-shell">
      <div className="atmosphere atmosphere-left" aria-hidden="true" />
      <div className="atmosphere atmosphere-right" aria-hidden="true" />
      <div className="content">
        <header className="topbar">
          <div className="brand-group">
            <div className="brand-mark">Φ<span>369</span></div>
            <div>
              <div className="eyebrow">THE OPEN SOUND EXPERIMENT</div>
              <h1>MIKEY<span>TRON</span><small>369</small></h1>
              <div className="brand-sub">LOOPFORGE // LIVE AUDIO LABORATORY</div>
            </div>
          </div>
          <div className="top-actions">
            <span className={'status-pill ' + (state.playing ? 'on' : '')}><span className="status-dot" />{status}</span>
            <button className="ghost-btn" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp}>? <span>HELP</span></button>
            <a className="ghost-btn github" href="https://github.com/MichaelWave369/PhiMikeyTron369" target="_blank" rel="noreferrer">GITHUB ↗</a>
          </div>
        </header>

        {showHelp && (
          <section className="help-panel" aria-label="Quick start guide">
            <div><b>01. POWER</b><p>Enable the audio engine. Microphone requires browser permission on HTTPS or localhost.</p></div>
            <div><b>02. PLAY</b><p>Start the beat grid. Tap sequencer pads to shape your groove.</p></div>
            <div><b>03. CAPTURE</b><p>Select a track, choose 1, 2 or 4 bars, then record. It starts on the next bar.</p></div>
            <div><b>04. MUTATE</b><p>Overdub, resample the master, add effects and smash CHAOS. Undo restores the last mutation.</p></div>
            <div className="key-help">KEYS <TooltipKey>SPACE</TooltipKey> play/stop <TooltipKey>R</TooltipKey> record <TooltipKey>1-8</TooltipKey> tracks <TooltipKey>C</TooltipKey> chaos <TooltipKey>Z</TooltipKey> undo</div>
          </section>
        )}

        <section className="hero-grid">
          <div className="card visual-card">
            <div className="section-top"><span>01 / SIGNAL FIELD</span><span>REAL-TIME SPECTRUM</span></div>
            <div className="viz-wrap"><MiniSpectrum engine={engine} powered={state.powered} playing={state.playing} /><span className="viz-label">THE SOUND OF NOW</span></div>
            <div className="transport">
              <button className={'power-btn ' + (state.powered ? 'lit' : '')} onClick={() => run(() => engine.power(), 'Audio engine online.')}>{state.powered ? '◉ AUDIO ON' : '◌ POWER ON'}</button>
              <button className={'primary-btn ' + (state.playing ? 'is-playing' : '')} onClick={togglePlay}>{state.playing ? '■ STOP' : '▶ PLAY'} <span><TooltipKey>SPACE</TooltipKey></span></button>
              <div className="tempo-readout"><strong>{state.bpm}</strong><span>BPM</span></div>
              <div className="beat-indicators">{[0,1,2,3].map(beat => <span key={beat} className={state.playing && Math.floor(state.currentStep / 4) === beat ? 'active' : ''} />)}</div>
            </div>
          </div>
          <div className="card master-card">
            <div className="section-top"><span>02 / MASTER CONTROL</span><span>THE ENGINE ROOM</span></div>
            <div className="master-controls">
              <Slider id="tempo" label="TEMPO" value={state.bpm} min={50} max={200} step={1} onChange={v => run(() => engine.setTempo(v))} format={v => v + ' BPM'} />
              <Slider id="swing" label="SWING" value={state.swing} min={0} max={0.45} step={0.01} onChange={v => engine.setSwing(v)} format={v => Math.round(v * 100) + '%'} />
              <Slider id="master" label="MASTER LEVEL" value={state.masterVolume} min={0} max={1} onChange={v => engine.setMaster(v)} format={v => Math.round(v * 100) + '%'} />
              <label className="select-wrap">MUSICAL KEY
                <select value={state.key} onChange={e => engine.setKey(Number(e.target.value))}>
                  {KEY_NAMES.map((name, i) => <option key={name} value={i}>{name} minor</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="card sequencer-card">
          <div className="section-head">
            <div><div className="section-top">03 / RHYTHM MATRIX</div><h2>THE STEP MACHINE <span>/ 16-STEP SEQUENCER</span></h2></div>
            <div className="preset-wrap">
              <label htmlFor="preset-select">GROOVE PRESET</label>
              <select id="preset-select" value={preset} onChange={e => {
                setPreset(e.target.value);
                run(() => engine.loadPreset(e.target.value), 'Loaded ' + e.target.value + ' groove.');
              }}>
                {PRESET_NAMES.map(name => <option key={name}>{name}</option>)}
              </select>
            </div>
          </div>
          <div className="step-scroller">
            <div className="step-grid">
              <div className="step-label head-label">SOUND</div>
              {Array.from({ length: STEPS }, (_, i) => <div key={i} className={'step-number ' + (state.playing && state.currentStep === i ? 'current' : '')}>{String(i + 1).padStart(2, '0')}</div>)}
              {ROWS.map(row => (
                <React.Fragment key={row}>
                  <button className={'step-label sample-label sample-' + row} title={'Audition ' + LABELS[row]}
                    onClick={() => run(async () => { if (!engine.powered) await engine.power(); engine.hit(row, engine.ctx.currentTime + 0.02, 0); })}>
                    <strong>{LABELS[row]}</strong><span>{HINTS[row]}</span>
                  </button>
                  {state.pattern[row].map((on, i) => (
                    <button key={i} aria-pressed={on}
                      aria-label={LABELS[row] + ' step ' + (i + 1) + (on ? ' enabled' : ' disabled')}
                      className={'step-pad ' + row + (on ? ' active' : '') + (i % 4 === 0 ? ' quarter' : '') + (state.playing && state.currentStep === i ? ' playing' : '')}
                      onClick={() => engine.setPattern(row, i)}><span /></button>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="sequencer-foot"><span>CLICK PADS TO PROGRAM • CLICK INSTRUMENT NAMES TO AUDITION</span><span>4/4 · 16 STEPS · CLOCK-SCHEDULED</span></div>
        </section>

        <section className="track-section">
          <div className="section-head outside-head">
            <div><div className="section-top">04 / AUDIO CAPTURE BAY</div><h2>THE LOOP DECK <span>/ 8 INDEPENDENT CHANNELS</span></h2></div>
            <div className="mic-tools">
              <button className={'mic-button ' + (state.micEnabled ? 'lit' : '')} onClick={() => run(() => engine.enableMic(), 'Microphone connected. Headphones recommended.')}>
                {state.micEnabled ? '◉ MIC LIVE' : '◌ ENABLE MIC'}
              </button>
              <div className="mic-meter" title="Microphone input level"><span style={{ width: Math.round(micLevel * 100) + '%' }} /></div>
              <button className={'monitor-button ' + (state.monitorEnabled ? 'active' : '')} onClick={() => run(() => engine.toggleMonitor(), engine.monitorEnabled ? 'Direct mic monitoring disabled.' : 'Direct mic monitoring enabled. Use headphones.')}>MONITOR {state.monitorEnabled ? 'ON' : 'OFF'}</button>
            </div>
          </div>
          <div className="track-grid">
            {state.tracks.map((track, i) => (
              <div key={track.id} className={'track-card ' + (state.selected === i ? 'selected' : '')} style={{ '--track-color': track.color }}>
                <button className="track-select" onClick={() => engine.selectTrack(i)} aria-pressed={state.selected === i}>
                  <span className="track-icon">{trackIcons[i]}</span>
                  <span className="track-heading"><b>{track.name}</b><small>{track.hasAudio ? track.bars + ' BAR' + (track.bars > 1 ? 'S' : '') + ' CAPTURED' : 'EMPTY SLOT'}</small></span>
                  <span className={'track-led ' + (track.hasAudio ? 'filled' : '')} />
                </button>
                <div className="loop-visual" onClick={() => engine.selectTrack(i)} role="presentation">
                  {Array.from({ length: 32 }, (_, n) => (
                    <span key={n} className={track.hasAudio ? 'contains-audio' : ''}
                      style={{ height: (track.hasAudio ? 12 + ((Math.sin(n * 1.9 + i * 5.3) + Math.sin(n * 0.67) + 2) / 4) * 85 : 5) + '%' }} />
                  ))}
                </div>
                <div className="track-bottom">
                  <button aria-label={'Mute ' + track.name} aria-pressed={track.muted} className={'tiny-toggle ' + (track.muted ? 'muted' : '')} onClick={() => engine.setTrack(i, 'muted', !track.muted)}>M</button>
                  <button aria-label={'Solo ' + track.name} aria-pressed={track.solo} className={'tiny-toggle ' + (track.solo ? 'solo' : '')} onClick={() => engine.setTrack(i, 'solo', !track.solo)}>S</button>
                  <input aria-label={track.name + ' volume'} type="range" min="0" max="1" step=".01" value={track.volume} onChange={e => engine.setTrack(i, 'volume', Number(e.target.value))} />
                  <button className="tiny-clear" disabled={!track.hasAudio} onClick={() => engine.clearTrack(i)} aria-label={'Clear ' + track.name}>×</button>
                </div>
              </div>
            ))}
          </div>
          <div className="card capture-panel">
            <div className="capture-heading">
              <div className="capture-target" style={{ '--track-color': selected.color }}>
                <span className="capture-badge">{trackIcons[state.selected]}</span>
                <div><small>SELECTED CHANNEL</small><strong>{selected.name}</strong></div>
              </div>
              <div className="capture-bars"><span>LOOP LENGTH</span>{[1, 2, 4].map(bars => <button key={bars} className={selected.bars === bars ? 'selected' : ''} onClick={() => engine.setTrack(state.selected, 'bars', bars)} disabled={!!activeCapture}>{bars} BAR{bars > 1 ? 'S' : ''}</button>)}</div>
            </div>
            <div className="capture-buttons">
              <button className="record-btn" disabled={!!activeCapture} onClick={() => arm('replace')}>● RECORD <span>NEW LOOP</span></button>
              <button className="secondary-btn" disabled={!!activeCapture || !selected.hasAudio} onClick={() => arm('overdub')}>⊕ OVERDUB</button>
              <button className="secondary-btn" disabled={!!activeCapture} onClick={() => arm('resample')}>↻ RESAMPLE MASTER</button>
              {activeCapture && <button className="cancel-btn" onClick={() => engine.cancelCapture()}>× CANCEL</button>}
            </div>
            {activeCapture && <div className="capture-progress"><span className={activeCapture.phase === 'capturing' ? 'record-blink' : ''}>● {activeCapture.phase.toUpperCase()}</span> Capturing {activeCapture.bars} bar{activeCapture.bars > 1 ? 's' : ''} on LOOP {activeCapture.track + 1} {captureOfSelected ? '· THIS CHANNEL' : ''}</div>}
            <div className="capture-mix">
              <Slider id="track-filter" label="TRACK FILTER" value={selected.cutoff} min={300} max={20000} step={100} onChange={v => engine.setTrack(state.selected, 'cutoff', v)} format={v => (v / 1000).toFixed(1) + ' kHz'} />
              <Slider id="track-pan" label="TRACK PAN" value={selected.pan} min={-1} max={1} step={0.01} onChange={v => engine.setTrack(state.selected, 'pan', v)} format={v => Math.abs(v) < 0.02 ? 'CENTER' : v < 0 ? 'L ' + Math.round(-v * 100) : 'R ' + Math.round(v * 100)} />
            </div>
            <p className="capture-note">Mic loops start on the next bar. Resample captures the entire master mix. Direct microphone monitoring defaults to OFF to prevent feedback.</p>
          </div>
        </section>

        <section className="bottom-grid">
          <div className="card fx-card">
            <div className="section-top">05 / SOUND MUTATION LAB</div>
            <h2>MAKE IT WEIRD<span> / MASTER FX</span></h2>
            <div className="fx-sliders">
              <Slider id="fx-filter" label="LOW-PASS FILTER" value={state.fx.cutoff} min={300} max={20000} step={100} onChange={v => engine.setFX('cutoff', v)} format={v => (v / 1000).toFixed(1) + ' kHz'} />
              <Slider id="fx-drive" label="SATURATION" value={state.fx.drive} min={0} max={1} onChange={v => engine.setFX('drive', v)} format={v => Math.round(v * 100) + '%'} />
              <Slider id="fx-delay" label="SYNCED DELAY" value={state.fx.delay} min={0} max={0.5} onChange={v => engine.setFX('delay', v)} format={v => Math.round(v * 100) + '%'} />
            </div>
            <div className="chaos-controls">
              <button className="chaos-btn" onClick={() => run(() => engine.chaos(), 'CHAOS ENGAGED. Pads mutated and loops rearranged.')}>✳ CHAOS ENGINE <small>RECOMBINE THE GROOVE</small></button>
              <button className="undo-btn" disabled={!state.canUndo} onClick={() => run(() => engine.undoChaos(), 'The previous groove has been restored.')}>↶ UNDO</button>
            </div>
            <p className="subtle">Chaos rearranges each captured loop into eight slices and mutates the step grid. Undo restores the previous version.</p>
          </div>

          <div className="card output-card">
            <div className="section-top">06 / OUTPUT TERMINAL</div>
            <h2>PRINT THE MOMENT<span> / SAVE & EXPORT</span></h2>
            <div className="export-main">
              <button className={'export-btn ' + (state.exporting ? 'recording' : '')} onClick={() => run(() => state.exporting ? engine.stopExport() : engine.startExport(), state.exporting ? 'Finishing download…' : 'Performance recording started. Play something!')}>
                {state.exporting ? '■ STOP & DOWNLOAD' : '◉ RECORD PERFORMANCE'}
              </button>
              <p>Record the full master output, then download your performance as a browser-supported audio file (.webm or .m4a).</p>
            </div>
            <div className="file-actions">
              <button className="secondary-btn" onClick={() => run(() => engine.downloadProject(), 'Preset settings downloaded as JSON.')}>↓ SAVE PRESET</button>
              <button className="secondary-btn" onClick={() => importInput.current?.click()}>↑ LOAD PRESET</button>
              <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={downloadImport} />
            </div>
            <p className="subtle">Preset JSON contains pattern, mixer and FX settings only. Audio clips live in memory until you export a performance.</p>
          </div>
        </section>

        <div className="notification" role="status" aria-live="polite"><span>Φ</span>{message}</div>
        <footer><span>Φ MIKEYTRON369 · LOOPFORGE v0.1</span><span>OPEN INSTRUMENT / NO CLOUD / NO PAYWALL</span><span>BUILT TO MAKE NOISE, NOT EXCUSES</span></footer>
      </div>
    </div>
  );
}
