/* Sample-accurate single-channel PCM capture. Runs on the audio render thread. */
class PhiCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.job = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'cancel') {
        this.job = null;
        return;
      }
      if (data.type !== 'record') return;
      const frames = Math.max(1, Math.round(data.endFrame - data.startFrame));
      this.job = {
        id: data.id,
        startFrame: data.startFrame,
        endFrame: data.endFrame,
        pcm: new Float32Array(frames),
        count: 0
      };
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (out) for (const channel of out) channel.fill(0);
    const job = this.job;
    if (!job) return true;
    const input = inputs[0]?.[0];
    const frameCount = out?.[0]?.length || input?.length || 128;
    const from = Math.max(0, Math.ceil(job.startFrame - currentFrame));
    const to = Math.min(frameCount, Math.ceil(job.endFrame - currentFrame));
    if (to > from) {
      const dst = Math.max(0, currentFrame + from - job.startFrame);
      if (input) job.pcm.set(input.subarray(from, to), dst);
      job.count += to - from;
    }
    if (currentFrame + frameCount >= job.endFrame) {
      this.port.postMessage({ type: 'done', id: job.id, pcm: job.pcm }, [job.pcm.buffer]);
      this.job = null;
    }
    return true;
  }
}
registerProcessor('phi-capture', PhiCaptureProcessor);
