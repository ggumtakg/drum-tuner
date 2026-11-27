/// <reference types="vite/client" />

import {
  DrumHitAnalyzer,
  type DrumHitAnalyzerConfig,
  type DrumHitAnalyzerUpdate,
  type FrameAnalysisResult,
} from '../dsp/index.ts';

export type MicErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'unknown';

export interface MicEngineError {
  code: MicErrorCode;
  message: string;
  guidance: string;
  cause?: unknown;
}

export type MicEngineStatus = 'idle' | 'starting' | 'running' | 'error';

export type MicCaptureMode = 'worklet' | 'script-processor' | null;

export type MicAnalyzerOptions = Omit<DrumHitAnalyzerConfig, 'sampleRate'>;

export interface MicEngineCallbacks {
  onFrame?: (result: FrameAnalysisResult) => void;
  onStatusChange?: (status: MicEngineStatus) => void;
  onError?: (error: MicEngineError) => void;
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as Window & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return globalThis.AudioContext ?? win.AudioContext ?? win.webkitAudioContext ?? null;
}

function getWorkletModuleUrl(): string {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}pcm-worklet.js`;
}

export function createMicError(code: MicErrorCode, cause?: unknown): MicEngineError {
  switch (code) {
    case 'insecure-context':
      return {
        code,
        message: '보안 연결(HTTPS)이 필요합니다.',
        guidance:
          '모바일 브라우저는 HTTPS 또는 localhost 환경에서만 마이크 접근을 허용합니다. https:// 주소로 접속해 주세요.',
        cause,
      };
    case 'unsupported':
      return {
        code,
        message: '이 브라우저에서는 마이크 오디오 캡처를 지원하지 않습니다.',
        guidance:
          '최신 iOS Safari 또는 Android Chrome 브라우저에서 다시 열어 주세요. 인앱 브라우저에서는 제한될 수 있습니다.',
        cause,
      };
    case 'permission-denied':
      return {
        code,
        message: '마이크 권한이 거부되었습니다.',
        guidance:
          '브라우저 주소창의 사이트 설정 또는 기기 설정에서 이 사이트의 마이크 권한을 허용한 뒤 다시 시도해 주세요.',
        cause,
      };
    case 'no-device':
      return {
        code,
        message: '사용 가능한 마이크를 찾을 수 없습니다.',
        guidance:
          '기기 마이크가 정상 연결되어 있는지 확인하고, 이어폰·외부 오디오 장치 상태를 점검한 뒤 다시 시도해 주세요.',
        cause,
      };
    case 'unknown':
    default:
      return {
        code: 'unknown',
        message: '마이크를 시작할 수 없습니다.',
        guidance:
          '다른 앱(통화·녹음 등)이 마이크를 사용 중일 수 있습니다. 다른 앱을 종료하거나 페이지를 새로고침한 뒤 다시 시도해 주세요.',
        cause,
      };
  }
}

export function classifyMicError(err: unknown): MicEngineError {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return createMicError('insecure-context', err);
  }

  const name =
    typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string'
      ? err.name
      : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return createMicError('permission-denied', err);
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return createMicError('no-device', err);
  }

  if (name === 'NotSupportedError' || name === 'TypeError') {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      return createMicError('unsupported', err);
    }
  }

  return createMicError('unknown', err);
}

export class MicEngine {
  private config: MicAnalyzerOptions;
  private callbacks: MicEngineCallbacks;

  private status: MicEngineStatus = 'idle';
  private captureMode: MicCaptureMode = null;
  private sessionToken = 0;

  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private silentGainNode: GainNode | null = null;
  private analyzer: DrumHitAnalyzer | null = null;

  constructor(initialConfig: MicAnalyzerOptions, callbacks: MicEngineCallbacks = {}) {
    this.config = { ...initialConfig };
    this.callbacks = callbacks;
  }

  setCallbacks(callbacks: MicEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  getStatus(): MicEngineStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  getSampleRate(): number | null {
    return this.audioContext?.sampleRate ?? null;
  }

  getCaptureMode(): MicCaptureMode {
    return this.captureMode;
  }

  updateConfig(patch: DrumHitAnalyzerUpdate): void {
    this.config = {
      ...this.config,
      ...patch,
    };
    this.analyzer?.updateConfig(patch);
  }

  startCalibration(durationMs: number = 2000): boolean {
    if (!this.analyzer || this.status !== 'running') {
      return false;
    }
    this.analyzer.startCalibration(durationMs);
    return true;
  }

  cancelCalibration(): void {
    this.analyzer?.cancelCalibration();
  }

  clearCapture(): void {
    this.analyzer?.clearCapture();
  }

  resetAnalyzer(): void {
    this.analyzer?.reset();
  }

  async start(): Promise<boolean> {
    if (this.status === 'running' || this.status === 'starting') {
      return this.status === 'running';
    }

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      this.failWithError(createMicError('insecure-context'));
      return false;
    }

    const AudioContextCtor = getAudioContextConstructor();
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      !AudioContextCtor
    ) {
      this.failWithError(createMicError('unsupported'));
      return false;
    }

    const token = ++this.sessionToken;
    this.setStatus('starting');

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    try {
      // Create and attempt to unlock AudioContext within the user gesture stack (iOS Safari)
      try {
        ctx = new AudioContextCtor({ latencyHint: 'interactive' });
      } catch {
        ctx = new AudioContextCtor();
      }

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      if (token !== this.sessionToken) {
        this.stopMediaStream(stream);
        void ctx.close().catch(() => undefined);
        return false;
      }

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      if (token !== this.sessionToken) {
        this.stopMediaStream(stream);
        void ctx.close().catch(() => undefined);
        return false;
      }

      const analyzer = new DrumHitAnalyzer({
        sampleRate: ctx.sampleRate,
        targetHz: this.config.targetHz,
        gateThresholdDb: this.config.gateThresholdDb,
        targetFilterEnabled: this.config.targetFilterEnabled,
        targetFilterSpanPct: this.config.targetFilterSpanPct,
      });

      const sourceNode = ctx.createMediaStreamSource(stream);
      const silentGainNode = ctx.createGain();
      silentGainNode.gain.value = 0;
      silentGainNode.connect(ctx.destination);

      let workletNode: AudioWorkletNode | null = null;
      let scriptProcessorNode: ScriptProcessorNode | null = null;
      let captureMode: MicCaptureMode = null;

      if (typeof AudioWorkletNode !== 'undefined' && ctx.audioWorklet) {
        try {
          await ctx.audioWorklet.addModule(getWorkletModuleUrl());

          if (token !== this.sessionToken) {
            sourceNode.disconnect();
            silentGainNode.disconnect();
            this.stopMediaStream(stream);
            void ctx.close().catch(() => undefined);
            return false;
          }

          workletNode = new AudioWorkletNode(ctx, 'pcm-capture-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
          });
          workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
            if (token !== this.sessionToken) {
              return;
            }
            const data = event.data;
            if (data instanceof Float32Array) {
              this.handlePcmChunk(data);
            } else if (data instanceof ArrayBuffer) {
              this.handlePcmChunk(new Float32Array(data));
            }
          };
          sourceNode.connect(workletNode);
          workletNode.connect(silentGainNode);
          captureMode = 'worklet';
        } catch {
          // Fall back to ScriptProcessorNode if worklet loading or instantiation fails
          workletNode = null;
        }
      }

      if (!workletNode) {
        if (typeof ctx.createScriptProcessor !== 'function') {
          sourceNode.disconnect();
          silentGainNode.disconnect();
          this.stopMediaStream(stream);
          void ctx.close().catch(() => undefined);
          this.failWithError(createMicError('unsupported'));
          return false;
        }

        scriptProcessorNode = ctx.createScriptProcessor(1024, 1, 1);
        scriptProcessorNode.onaudioprocess = (event: AudioProcessingEvent) => {
          if (token !== this.sessionToken) {
            return;
          }
          const channelData = event.inputBuffer.getChannelData(0);
          this.handlePcmChunk(new Float32Array(channelData));
        };
        sourceNode.connect(scriptProcessorNode);
        scriptProcessorNode.connect(silentGainNode);
        captureMode = 'script-processor';
      }

      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (token === this.sessionToken && this.status === 'running') {
            this.teardown('idle');
          }
        };
      }

      this.mediaStream = stream;
      this.audioContext = ctx;
      this.sourceNode = sourceNode;
      this.workletNode = workletNode;
      this.scriptProcessorNode = scriptProcessorNode;
      this.silentGainNode = silentGainNode;
      this.analyzer = analyzer;
      this.captureMode = captureMode;

      this.setStatus('running');
      return true;
    } catch (err) {
      if (stream) {
        this.stopMediaStream(stream);
      }
      if (ctx) {
        void ctx.close().catch(() => undefined);
      }

      if (token !== this.sessionToken) {
        return false;
      }

      this.teardown('error');
      this.callbacks.onError?.(classifyMicError(err));
      return false;
    }
  }

  stop(): void {
    this.sessionToken++;
    this.teardown('idle');
  }

  private handlePcmChunk(samples: Float32Array): void {
    if (!this.analyzer || this.status !== 'running') {
      return;
    }
    const result = this.analyzer.processFrame(samples, Date.now());
    this.callbacks.onFrame?.(result);
  }

  private failWithError(error: MicEngineError): void {
    this.teardown('error');
    this.callbacks.onError?.(error);
  }

  private setStatus(nextStatus: MicEngineStatus): void {
    if (this.status === nextStatus) {
      return;
    }
    this.status = nextStatus;
    this.callbacks.onStatusChange?.(nextStatus);
  }

  private stopMediaStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.onended = null;
      try {
        track.stop();
      } catch {
        // Ignore track stop errors during cleanup
      }
    }
  }

  private teardown(nextStatus: MicEngineStatus): void {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      try {
        this.workletNode.port.close();
      } catch {
        // Ignore port close errors
      }
      try {
        this.workletNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.workletNode = null;
    }

    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.onaudioprocess = null;
      try {
        this.scriptProcessorNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.scriptProcessorNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.sourceNode = null;
    }

    if (this.silentGainNode) {
      try {
        this.silentGainNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.silentGainNode = null;
    }

    if (this.mediaStream) {
      this.stopMediaStream(this.mediaStream);
      this.mediaStream = null;
    }

    if (this.audioContext) {
      const ctx = this.audioContext;
      this.audioContext = null;
      void ctx.close().catch(() => undefined);
    }

    this.analyzer = null;
    this.captureMode = null;
    this.setStatus(nextStatus);
  }
}
