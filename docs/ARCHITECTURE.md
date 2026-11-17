# LoopForge audio architecture

## One timebase

The AudioContext timebase is the source of truth for playback and capture. The transport computes `origin` once per run, and step `n` is scheduled at `origin + n * (60 / BPM / 4)`. A 25 ms JavaScript scheduler looks ahead 120 ms to schedule Web Audio nodes, avoiding callback-timing jitter in audible playback.

Recording does not rely on the timer: the worklet receives integer start/end frame positions for the next safe bar, and copies only frames between those boundaries. On completion, the PCM is sent to the UI thread as a transferable array and wrapped in an AudioBuffer. This prevents React rendering delays from changing capture length.

## Graph

```text
Mic -> microphone capture worklet -> silent sink
    +-> optional direct monitor gain (OFF by default) -> MIX

8 loop sources -> per-track low-pass -> gain -> pan -> MIX
6 synth voices -> drum gain -> MIX

MIX -> master low-pass -> saturation -> compressor -> master gain
    +-> synchronized delay -> feedback -> master low-pass

master gain -> analyser -> speakers
            +-> MediaStreamDestination -> performance export
            +-> resample capture worklet -> silent sink
```

The graph is local to the page. There are no web requests for audio content or external samples.

## Known challenges

- Current captured loops are monophonic. Stereo, layered takes and proper phase-aware overdubbing require architectural work.
- Existing buffers are played at a rescaled rate after tempo change; this is not time stretching.
- Worklet timebase quantization and speaker/input latency are distinct: the first is accurate relative to the engine clock, but acoustic loop-back may benefit from hardware latency calibration.
- A future timing test should run in a real browser under CPU load; unit tests alone cannot establish actual roundtrip latency.
- Wav export, secure audio clip persistence in IndexedDB, granular transforms and MIDI APIs are planned, not advertised as complete.

## Safety

The microphone is only opened following a user gesture and permission grant. Direct monitoring is disabled until explicitly enabled. No microphone data is sent to a service by this application.
