# Φ MikeyTron369 / LoopForge

**An open-source live looping laboratory you can play in a browser.** Inspired by the freedom of live-loop performance systems, built as an original instrument.

> Make a sound. Catch it. Warp it. Make another sound. Repeat.

## Try it

**Live site (after GitHub Pages is enabled):** https://michaelwave369.github.io/PhiMikeyTron369/

Run locally:

```bash
npm install
npm run dev
```

Open the URL shown by Vite. Use current Chrome/Edge desktop for the best AudioWorklet and microphone experience. HTTPS or localhost is required for microphone capture. No accounts or remote audio processing.

## The instrument (v0.1)

- **8 mono loop decks**: 1 / 2 / 4 bar recording, replacement, overdub, mute, solo, individual gain, pan and filters
- **Live microphone capture**: sample-clock-aligned AudioWorklet recording with monitoring OFF by default
- **6-lane, 16-step sequencer**: kick, snare, hat, clap, bass and lead generated with Web Audio, four presets and musical key selection
- **Clock-scheduled playback**: short scheduler lookahead, quantized capture start/end at bar boundaries, adjustable swing
- **Resample master**: capture your combined output into a fresh loop channel
- **Master mutations**: low-pass filter, saturation and tempo-synced delay
- **Chaos Engine**: rearrange eight audio slices in captured loops and perturb step patterns, with one-level undo
- **Performance export**: record the master output and download a browser-supported .webm (Opus) or .m4a file
- **Preset save/load**: share pattern and mixing configuration via JSON
- **Keyboard**: Space play/stop, R record, 1-8 select channel, C chaos, Z undo, Esc cancel capture

### Quick start

1. Click **POWER ON**, then **PLAY**.
2. Click the sequencer pads to build a rhythm.
3. Click **ENABLE MIC** and grant permission. Headphones are recommended, especially if enabling live monitor.
4. Select a LOOP channel, choose its length and click **RECORD NEW LOOP**. The capture begins at the next bar and stops automatically.
5. **OVERDUB** adds microphone audio to a captured loop. **RESAMPLE MASTER** records the whole mix into the selected channel.
6. Hit **CHAOS ENGINE**, then **UNDO** if the robots have committed crimes against rhythm.
7. Start **RECORD PERFORMANCE**, play your set, then stop to download the mix.

## Engineering and limitations

This is a real playable **first instrument**, not a feature-complete commercial looper:

- The capture worklet records mono PCM at the AudioContext sample rate. Scheduled boundaries use the audio render clock, while the UI refresh can lag slightly.
- A performance export uses MediaRecorder, so the output codec depends on the browser. It is not a WAV export.
- **Presets do not include audio clips**. Recorded audio stays in memory until the tab is closed, so export your performance before leaving the page.
- Tempo changes stop and reset the transport. Existing audio loops are replayed at a new rate, so **pitch changes with tempo**. True time-stretch, independent pitch shifting, granular synthesis, multi-bank scenes and MIDI mapping are future work.
- Resampling the master includes previously playing loops. For feedback-free results, choose an empty channel and mute/clear the original sources if desired.
- Avoid enabling microphone monitor while using speakers: you may produce acoustic feedback. Headphones recommended.
- The clock scheduler uses AudioContext time plus a lookahead for playback; microphone capture is frame-bounded in the worklet. Actual end-to-end latency depends on soundcard, browser and OS.
- Playback is currently 4/4 with 16-step bars. Users' devices must remain awake for uninterrupted capture.
- The visual loop waveforms are **decorative placeholders** at this stage, not decoded audio waveforms.

## Project structure

```
src/audio/LoopForgeEngine.js   Audio graph, playback scheduler, live capture and export
src/lib/music.js               Sequencer, timing, slicing and music utilities
src/App.jsx                    Performance UI
src/style.css                  Responsive studio design
public/pcm-recorder.js          Sample-accurate capture AudioWorklet processor
tests/music.test.mjs            Node-native timing/transform tests
.github/workflows/deploy.yml   Test/build/deploy to GitHub Pages
```

## Roadmap

**Next:** waveform display based on actual samples, latency calibration and loop phase tools, non-destructive layered overdubs, transport metronome, IndexedDB audio project save, WAV export, MIDI learn / pads, keyboard sampler, automation lanes, polyphonic instruments, time-stretch + pitch shifting, granular rack, scene switching, WebXR / Spark VR spatial instrument integration and optional ComedyAtlas rhythm-mapping experiments.

## Contribute

Bug reports, performance traces, new sounds, effect units and accessibility improvements are welcome. This project is licensed under **MIT**. Original inspiration comes from the broader live-looping community; there is no endorsement or affiliation with Beardyman or his products.
