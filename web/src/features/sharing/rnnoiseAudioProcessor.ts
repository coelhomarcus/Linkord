import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { Track } from 'livekit-client';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';

// RNNoise assumes 48kHz audio with no internal resampling — attaching it on
// a differently-clocked AudioContext would silently mangle the signal
// instead of erroring, so this has to hold before we ever try.
function isSupported(audioContext: AudioContext): boolean {
  return window.isSecureContext
    && typeof AudioWorkletNode !== 'undefined'
    && !!audioContext.audioWorklet
    && audioContext.sampleRate === 48000;
}

// Lazy singleton — the WASM binary (SIMD-detected by loadRnnoise) only
// downloads the first time someone actually opts in, and stays cached for
// the rest of the page's lifetime across enable/disable cycles.
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;
function getWasmBinary(): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) wasmBinaryPromise = loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  return wasmBinaryPromise;
}

// AudioWorklet modules are registered per-AudioContext, not globally — the
// app only ever has one (the Room's shared context), but this guards
// against double-registration if init() ever runs twice on the same one.
const registeredContexts = new WeakSet<AudioContext>();
async function ensureWorkletModule(audioContext: AudioContext): Promise<void> {
  if (registeredContexts.has(audioContext)) return;
  await audioContext.audioWorklet.addModule(rnnoiseWorkletUrl);
  registeredContexts.add(audioContext);
}

class RnnoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'rnnoise-noise-suppression';
  processedTrack?: MediaStreamTrack;

  private audioContext?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private rnnoiseNode?: RnnoiseWorkletNode;
  private destination?: MediaStreamAudioDestinationNode;

  async init(opts: AudioProcessorOptions): Promise<void> {
    if (!isSupported(opts.audioContext)) throw new Error('RNNoise não suportado neste navegador/contexto de áudio.');

    const wasmBinary = await getWasmBinary();
    await ensureWorkletModule(opts.audioContext);

    this.audioContext = opts.audioContext;
    this.rnnoiseNode = new RnnoiseWorkletNode(opts.audioContext, { maxChannels: 1, wasmBinary });
    // Explicit instead of relying on the Web Audio API's default up/down-mix
    // behavior — this app's mic capture is always mono (no channelCount: 2
    // requested anywhere), so pin the node to exactly that.
    this.rnnoiseNode.channelCount = 1;
    this.rnnoiseNode.channelCountMode = 'explicit';
    this.rnnoiseNode.channelInterpretation = 'discrete';

    this.destination = opts.audioContext.createMediaStreamDestination();
    this.rnnoiseNode.connect(this.destination);
    this.connectSource(opts.track);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }

  // Called by LiveKit when the mic device changes mid-call (switchActiveDevice)
  // — only the source needs rebuilding, the worklet/wasm/destination stay put.
  async restart(opts: AudioProcessorOptions): Promise<void> {
    this.source?.disconnect();
    this.connectSource(opts.track);
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    this.rnnoiseNode?.disconnect();
    this.rnnoiseNode?.destroy();
    this.destination?.disconnect();
    this.source = undefined;
    this.rnnoiseNode = undefined;
    this.destination = undefined;
    this.audioContext = undefined;
    this.processedTrack = undefined;
  }

  private connectSource(track: MediaStreamTrack): void {
    if (!this.audioContext || !this.rnnoiseNode) return;
    this.source = this.audioContext.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(this.rnnoiseNode);
  }
}

let processor: RnnoiseProcessor | null = null;
export function getRnnoiseProcessor(): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  if (!processor) processor = new RnnoiseProcessor();
  return processor;
}
