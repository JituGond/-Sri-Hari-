import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import {
  ColorGradeType,
  ExportCheckpoint,
  ExportResult,
  SceneEditingEffects,
  TimelineSegment,
} from '../types/hanuman';
import {
  clearExportUnits,
  getExportUnits,
  saveExportUnit,
  SerializedEncodedPacket,
} from './projectStore';
import { getEstimatedHeapMb } from './videoAnalyzer';

export interface ExportProgressEvent {
  percent: number;
  encodedSec: number;
  targetSec: number;
  etaSec: number | null;
  unitIndex: number;
  totalUnits: number;
  segmentIndex: number;
  totalSegments: number;
  ramEstimateMb: number;
  stageLabel: string;
}

export interface BalancedQualityPlan {
  width: number;
  height: number;
  fps: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
  mimeType: string;
  extension: 'mp4' | 'webm';
  videoCodecLabel: string;
  audioCodecLabel: string;
  resolutionPreserved: boolean;
}

interface ExportUnit {
  unitIndex: number;
  segmentIndex: number;
  startSec: number;
  endSec: number;
  sourceDurationSec: number;
  editedDurationSec: number;
  timelineOffsetUs: number;
  audioSampleOffset: number;
  frameCount: number;
  segFrameOffset: number;
  segTotalFrames: number;
  isFirstUnitOfSegment: boolean;
  effects: SceneEditingEffects;
}

const MAX_UNIT_SEC = 6;
const H264_CODEC_CANDIDATES = [
  'avc1.640028',
  'avc1.4D4028',
  'avc1.42E01F',
  'avc1.42001E',
];

function easeInOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function getCssFilterForGrade(grade: ColorGradeType): string {
  switch (grade) {
    case 'cinematic_warm':
      return 'contrast(1.07) saturate(1.12) brightness(1.02) sepia(0.06)';
    case 'crisp_clarity':
      return 'contrast(1.11) saturate(1.06) brightness(1.06)';
    case 'vivid_punch':
      return 'contrast(1.13) saturate(1.20) brightness(1.03)';
    default:
      return 'none';
  }
}

export function renderProcessedVideoFrame(options: {
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  prevFrameCanvas: HTMLCanvasElement;
  hasPrevFrame: boolean;
  outWidth: number;
  outHeight: number;
  segProgress: number;
  localOutTimeSec: number;
  isFirstUnitOfSegment: boolean;
  effects: SceneEditingEffects;
}): void {
  const {
    ctx,
    video,
    prevFrameCanvas,
    hasPrevFrame,
    outWidth,
    outHeight,
    segProgress,
    localOutTimeSec,
    isFirstUnitOfSegment,
    effects,
  } = options;

  const srcW = video.videoWidth || outWidth;
  const srcH = video.videoHeight || outHeight;
  const eased = easeInOutCubic(segProgress);

  let zoom = 1.0;
  let panXRatio = 0;

  if (effects.motionEffect === 'zoom_in') {
    zoom = 1.0 + 0.14 * eased;
  } else if (effects.motionEffect === 'zoom_out') {
    zoom = 1.13 - 0.13 * eased;
  } else if (effects.motionEffect === 'pan_drift') {
    zoom = 1.09;
    panXRatio = (eased - 0.5) * 0.07;
  }

  const cropW = srcW / zoom;
  const cropH = srcH / zoom;
  const maxPanX = (srcW - cropW) / 2;
  const sx = Math.max(0, Math.min(srcW - cropW, (srcW - cropW) / 2 + panXRatio * srcW * 0.5));
  const sy = Math.max(0, (srcH - cropH) / 2);
  void maxPanX;

  ctx.save();
  ctx.filter = getCssFilterForGrade(effects.colorGrade);
  // Strictly raw cropped/graded video frame — zero scripts or watermarks
  ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, outWidth, outHeight);
  ctx.restore();

  // Apply cinematic entry transition if within transition window
  if (
    isFirstUnitOfSegment &&
    effects.transitionIn !== 'cut' &&
    effects.transitionDurationSec > 0.04 &&
    localOutTimeSec < effects.transitionDurationSec
  ) {
    const tProg = easeInOutCubic(localOutTimeSec / effects.transitionDurationSec);

    if (effects.transitionIn === 'dip_black') {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${(1 - tProg).toFixed(3)})`;
      ctx.fillRect(0, 0, outWidth, outHeight);
      ctx.restore();
    } else if (hasPrevFrame && effects.transitionIn === 'crossfade') {
      ctx.save();
      ctx.globalAlpha = 1 - tProg;
      ctx.drawImage(prevFrameCanvas, 0, 0, outWidth, outHeight);
      ctx.restore();
    } else if (hasPrevFrame && effects.transitionIn === 'zoom_push') {
      const pushScale = 1 + 0.09 * tProg;
      const dw = outWidth * pushScale;
      const dh = outHeight * pushScale;
      ctx.save();
      ctx.globalAlpha = 1 - tProg;
      ctx.drawImage(prevFrameCanvas, (outWidth - dw) / 2, (outHeight - dh) / 2, dw, dh);
      ctx.restore();
    }
  }
}

export function countAppliedEffects(segments: TimelineSegment[]): {
  cutsAppliedCount: number;
  effectsAppliedCount: number;
} {
  const cutsAppliedCount = segments.filter((s) => s.action === 'cut').length;
  const effectsAppliedCount = segments
    .filter((s) => s.action === 'keep')
    .reduce((acc, s) => {
      const e = s.effects;
      if (!e) return acc;
      let count = 0;
      if (Math.abs(e.speedFactor - 1) > 0.01) count++;
      if (e.motionEffect !== 'none') count++;
      if (e.colorGrade !== 'natural') count++;
      if (e.transitionIn !== 'cut') count++;
      return acc + count;
    }, 0);
  return { cutsAppliedCount, effectsAppliedCount };
}

export function planBalancedAutoQuality(srcWidth: number, srcHeight: number): BalancedQualityPlan {
  const maxEdge = Math.max(srcWidth, srcHeight);
  const scale = maxEdge > 1920 ? 1920 / maxEdge : 1;
  const width = Math.max(2, Math.round((srcWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.round((srcHeight * scale) / 2) * 2);
  const fps = 30;

  const rawBps = Math.round(width * height * fps * 0.14);
  const videoBitsPerSecond = Math.max(2_400_000, Math.min(12_000_000, rawBps));
  const audioBitsPerSecond = 128_000;

  const hasWebCodecs =
    typeof VideoEncoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioData !== 'undefined';

  if (hasWebCodecs) {
    return {
      width,
      height,
      fps,
      videoBitsPerSecond,
      audioBitsPerSecond,
      mimeType: 'video/mp4',
      extension: 'mp4',
      videoCodecLabel: 'H.264 (AVC)',
      audioCodecLabel: 'AAC-LC',
      resolutionPreserved: scale === 1,
    };
  }

  const recorderCandidates: Array<{
    mime: string;
    ext: 'mp4' | 'webm';
    vLabel: string;
    aLabel: string;
  }> = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', vLabel: 'H.264 (AVC)', aLabel: 'AAC' },
    { mime: 'video/mp4', ext: 'mp4', vLabel: 'H.264 (AVC)', aLabel: 'AAC' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', vLabel: 'VP9', aLabel: 'Opus' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', vLabel: 'VP8', aLabel: 'Opus' },
    { mime: 'video/webm', ext: 'webm', vLabel: 'VP8', aLabel: 'Opus' },
  ];

  const chosen =
    recorderCandidates.find(
      (c) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)
    ) ?? { mime: 'video/webm', ext: 'webm' as const, vLabel: 'VP8', aLabel: 'Opus' };

  return {
    width,
    height,
    fps,
    videoBitsPerSecond,
    audioBitsPerSecond,
    mimeType: chosen.mime,
    extension: chosen.ext,
    videoCodecLabel: chosen.vLabel,
    audioCodecLabel: chosen.aLabel,
    resolutionPreserved: scale === 1,
  };
}

export function buildExportUnits(
  keptSegments: TimelineSegment[],
  fps: number,
  sampleRate: number
): { units: ExportUnit[]; totalTargetSec: number } {
  const units: ExportUnit[] = [];
  let timelineOffsetUs = 0;
  let audioSampleOffset = 0;
  let totalTargetSec = 0;

  keptSegments.forEach((seg, segIdx) => {
    const effects: SceneEditingEffects = seg.effects ?? {
      speedFactor: 1,
      motionEffect: 'none',
      colorGrade: 'natural',
      transitionIn: 'cut',
      transitionDurationSec: 0,
    };
    const speedFactor = Math.max(0.5, Math.min(2.0, effects.speedFactor || 1));
    const fullSrcDur = Math.max(0.1, seg.endSec - seg.startSec);
    const fullEditedDur = fullSrcDur / speedFactor;
    const segTotalFrames = Math.max(1, Math.round(fullEditedDur * fps));

    const subCount = Math.max(1, Math.ceil(fullEditedDur / MAX_UNIT_SEC));
    const subSrcDur = fullSrcDur / subCount;
    let segFrameCursor = 0;

    for (let k = 0; k < subCount; k++) {
      const startSec = seg.startSec + k * subSrcDur;
      const endSec = k === subCount - 1 ? seg.endSec : seg.startSec + (k + 1) * subSrcDur;
      const srcDur = Math.max(0.05, endSec - startSec);
      const editedDur = srcDur / speedFactor;
      const frameCount =
        k === subCount - 1
          ? Math.max(1, segTotalFrames - segFrameCursor)
          : Math.max(1, Math.round(editedDur * fps));
      const exactEditedDur = frameCount / fps;
      const sampleCount = Math.max(1024, Math.round(exactEditedDur * sampleRate));

      units.push({
        unitIndex: units.length,
        segmentIndex: segIdx,
        startSec,
        endSec,
        sourceDurationSec: srcDur,
        editedDurationSec: exactEditedDur,
        timelineOffsetUs,
        audioSampleOffset,
        frameCount,
        segFrameOffset: segFrameCursor,
        segTotalFrames,
        isFirstUnitOfSegment: k === 0,
        effects,
      });

      segFrameCursor += frameCount;
      timelineOffsetUs += Math.round(exactEditedDur * 1_000_000);
      audioSampleOffset += sampleCount;
      totalTargetSec += exactEditedDur;
    }
  });

  return { units, totalTargetSec };
}

async function pickSupportedH264Config(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined') return null;

  for (const codec of H264_CODEC_CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: 'avc' },
      latencyMode: 'quality',
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return support.config ?? config;
      }
    } catch {
      // Try next profile
    }
  }
  return null;
}

async function pickSupportedAacConfig(
  sampleRate: number,
  numberOfChannels: number,
  bitrate: number
): Promise<AudioEncoderConfig | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const candidateRates = Array.from(new Set([sampleRate, 48000, 44100]));
  const candidateChannels = Array.from(new Set([numberOfChannels, 2, 1]));

  for (const sr of candidateRates) {
    for (const ch of candidateChannels) {
      const config: AudioEncoderConfig = {
        codec: 'mp4a.40.2',
        sampleRate: sr,
        numberOfChannels: ch,
        bitrate,
      };
      try {
        const support = await AudioEncoder.isConfigSupported(config);
        if (support.supported) {
          return support.config ?? config;
        }
      } catch {
        // Try next audio config
      }
    }
  }
  return null;
}

async function extractDecodedAudioBuffer(sourceBlob: Blob): Promise<AudioBuffer | null> {
  if (sourceBlob.size > 240 * 1024 * 1024) return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  let ctx: AudioContext | null = null;
  try {
    const buf = await sourceBlob.arrayBuffer();
    ctx = new AudioCtx();
    return await ctx.decodeAudioData(buf);
  } catch {
    return null;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

async function seekVideoSafe(video: HTMLVideoElement, targetTime: number): Promise<void> {
  const safeMax = Number.isFinite(video.duration) && video.duration > 0.04 ? video.duration - 0.015 : targetTime;
  const clamped = Math.max(0, Math.min(targetTime, safeMax));

  if (Math.abs(video.currentTime - clamped) < 0.002 && video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 300);
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', done, { once: true });
    video.currentTime = clamped;
  });

  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('canplay', done);
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, 300);
      video.addEventListener('canplay', done, { once: true });
    });
  }
}

async function waitForQueueDrain(
  getSize: () => number,
  maxQueue: number,
  getError: () => Error | null,
  signal?: AbortSignal
): Promise<void> {
  let spins = 0;
  while (getSize() > maxQueue && spins < 100) {
    if (signal?.aborted) {
      throw new DOMException('Export paused by user', 'AbortError');
    }
    const err = getError();
    if (err) throw err;
    await new Promise((r) => setTimeout(r, 8));
    spins++;
  }
}

function hasFourCC(bytes: Uint8Array, tag: string): boolean {
  const t0 = tag.charCodeAt(0);
  const t1 = tag.charCodeAt(1);
  const t2 = tag.charCodeAt(2);
  const t3 = tag.charCodeAt(3);
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === t0 && bytes[i + 1] === t1 && bytes[i + 2] === t2 && bytes[i + 3] === t3) {
      return true;
    }
  }
  return false;
}

export async function verifyExportedVideoBlob(
  blob: Blob,
  expectedDurationSec: number,
  isMp4: boolean
): Promise<{ verifiedDurationSec: number; verifiedComplete: boolean }> {
  if (!blob || blob.size < 4096) {
    throw new Error('Export verification failed: output file is empty or incomplete.');
  }

  if (isMp4) {
    const headerBuf = new Uint8Array(await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer());
    const hasFtyp = hasFourCC(headerBuf, 'ftyp');
    const hasMoov = hasFourCC(headerBuf, 'moov');
    if (!hasFtyp || !hasMoov) {
      throw new Error('Export verification failed: MP4 header (ftyp/moov) is incomplete.');
    }
  }

  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Verification timed out reading exported video.')), 12000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Export verification failed: output file could not be decoded.'));
      };
      video.src = url;
    });

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('Export verification failed: exported video has zero video dimensions.');
    }

    let actualDuration = video.duration;
    if (!Number.isFinite(actualDuration) || actualDuration <= 0) {
      await seekVideoSafe(video, 1e6);
      actualDuration = video.duration;
    }

    if (!Number.isFinite(actualDuration) || actualDuration <= 0) {
      throw new Error('Export verification failed: exported video duration could not be verified.');
    }

    const minAcceptableSec = Math.max(0.3, expectedDurationSec * 0.95 - 0.35);
    if (actualDuration < minAcceptableSec) {
      throw new Error(
        `Export verification failed: only ${actualDuration.toFixed(1)}s of ${expectedDurationSec.toFixed(1)}s was saved.`
      );
    }

    await seekVideoSafe(video, Math.max(0, actualDuration - 0.2));
    if (video.error) {
      throw new Error('Export verification failed: tail frames failed to decode.');
    }

    return {
      verifiedDurationSec: actualDuration,
      verifiedComplete: true,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function encodeSingleUnit(options: {
  unit: ExportUnit;
  totalUnits: number;
  totalSegments: number;
  totalTargetSec: number;
  startProcessedSec: number;
  exportWallStartMs: number;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  prevFrameCanvas: HTMLCanvasElement;
  prevFrameCtx: CanvasRenderingContext2D;
  hasPrevFrame: boolean;
  plan: BalancedQualityPlan;
  videoConfig: VideoEncoderConfig;
  audioConfig: AudioEncoderConfig;
  decodedAudio: AudioBuffer | null;
  signal?: AbortSignal;
  onProgress: (event: ExportProgressEvent) => void;
}): Promise<{
  packets: SerializedEncodedPacket[];
  videoDecoderConfig?: EncodedVideoChunkMetadata['decoderConfig'];
  audioDecoderConfig?: EncodedAudioChunkMetadata['decoderConfig'];
  producedPrevFrame: boolean;
}> {
  const {
    unit,
    totalUnits,
    totalSegments,
    totalTargetSec,
    startProcessedSec,
    exportWallStartMs,
    video,
    canvas,
    ctx,
    prevFrameCanvas,
    prevFrameCtx,
    hasPrevFrame,
    plan,
    videoConfig,
    audioConfig,
    decodedAudio,
    signal,
    onProgress,
  } = options;

  const packets: SerializedEncodedPacket[] = [];
  let capturedVideoMeta: EncodedVideoChunkMetadata['decoderConfig'];
  let capturedAudioMeta: EncodedAudioChunkMetadata['decoderConfig'];
  let encoderError: Error | null = null;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig && !capturedVideoMeta) {
        capturedVideoMeta = meta.decoderConfig;
      }
      const copy = new Uint8Array(chunk.byteLength);
      chunk.copyTo(copy);
      packets.push({
        kind: 'video',
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? Math.round(1_000_000 / plan.fps),
        data: copy.buffer,
      });
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });
  videoEncoder.configure(videoConfig);

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig && !capturedAudioMeta) {
        capturedAudioMeta = meta.decoderConfig;
      }
      const copy = new Uint8Array(chunk.byteLength);
      chunk.copyTo(copy);
      packets.push({
        kind: 'audio',
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? Math.round((1024 / audioConfig.sampleRate) * 1_000_000),
        data: copy.buffer,
      });
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });
  audioEncoder.configure(audioConfig);

  try {
    const sr = audioConfig.sampleRate;
    const chCount = audioConfig.numberOfChannels;
    const frameDurationUs = Math.round(1_000_000 / plan.fps);
    const speedFactor = unit.effects.speedFactor || 1;

    // 1. Encode time-stretched & A/V-locked AAC audio with smooth 25ms edge crossfade
    const outSampleCount = Math.max(1024, Math.round(unit.editedDurationSec * sr));
    const fadeSamples = Math.min(Math.floor(sr * 0.025), Math.floor(outSampleCount / 4));
    const srcSr = decodedAudio?.sampleRate ?? sr;
    const srcChannels = decodedAudio?.numberOfChannels ?? chCount;

    let localAudioOffset = 0;
    const aacChunkLen = 1024;
    while (localAudioOffset < outSampleCount) {
      if (signal?.aborted) throw new DOMException('Export paused by user', 'AbortError');
      if (encoderError) throw encoderError;

      const count = Math.min(aacChunkLen, outSampleCount - localAudioOffset);
      const planar = new Float32Array(count * chCount);

      for (let c = 0; c < chCount; c++) {
        const srcCh = decodedAudio ? decodedAudio.getChannelData(Math.min(c, srcChannels - 1)) : null;
        const base = c * count;
        for (let i = 0; i < count; i++) {
          const samplePos = localAudioOffset + i;
          let sample = 0;
          if (srcCh) {
            // Map output time to exact source time accounting for slow-mo / speed-up
            const srcTimeSec = unit.startSec + (samplePos / sr) * speedFactor;
            const exactIdx = srcTimeSec * srcSr;
            const i0 = Math.floor(exactIdx);
            const frac = exactIdx - i0;
            if (i0 >= 0 && i0 < srcCh.length - 1) {
              sample = srcCh[i0] * (1 - frac) + srcCh[i0 + 1] * frac;
            } else if (i0 >= 0 && i0 < srcCh.length) {
              sample = srcCh[i0];
            }
          }
          let gain = 1;
          if (samplePos < fadeSamples) gain = samplePos / Math.max(1, fadeSamples);
          else if (samplePos >= outSampleCount - fadeSamples) {
            gain = (outSampleCount - 1 - samplePos) / Math.max(1, fadeSamples);
          }
          planar[base + i] = sample * Math.max(0, Math.min(1, gain));
        }
      }

      const timestampUs = Math.round(((unit.audioSampleOffset + localAudioOffset) / sr) * 1_000_000);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: sr,
        numberOfFrames: count,
        numberOfChannels: chCount,
        timestamp: timestampUs,
        data: planar,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      localAudioOffset += count;

      await waitForQueueDrain(
        () => audioEncoder.encodeQueueSize,
        16,
        () => encoderError,
        signal
      );
    }

    // 2. Render & encode H.264 frames with real zoom, motion, speed, color grading & transitions
    for (let f = 0; f < unit.frameCount; f++) {
      if (signal?.aborted) throw new DOMException('Export paused by user', 'AbortError');
      if (encoderError) throw encoderError;

      const localOutTimeSec = f / plan.fps;
      const targetSrcTime = Math.min(
        unit.endSec - 0.008,
        unit.startSec + localOutTimeSec * speedFactor
      );
      await seekVideoSafe(video, targetSrcTime);

      const segProgress =
        (unit.segFrameOffset + f) / Math.max(1, unit.segTotalFrames - 1);

      renderProcessedVideoFrame({
        ctx,
        video,
        prevFrameCanvas,
        hasPrevFrame,
        outWidth: plan.width,
        outHeight: plan.height,
        segProgress,
        localOutTimeSec,
        isFirstUnitOfSegment: unit.isFirstUnitOfSegment,
        effects: unit.effects,
      });

      const timestampUs = unit.timelineOffsetUs + f * frameDurationUs;
      const vFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: frameDurationUs,
      });
      const isKeyFrame = f === 0 || f % (plan.fps * 2) === 0;
      videoEncoder.encode(vFrame, { keyFrame: isKeyFrame });
      vFrame.close();

      if (f === unit.frameCount - 1) {
        prevFrameCtx.drawImage(canvas, 0, 0, plan.width, plan.height);
      }

      await waitForQueueDrain(
        () => videoEncoder.encodeQueueSize,
        6,
        () => encoderError,
        signal
      );

      if (f % 3 === 0 || f === unit.frameCount - 1) {
        const unitElapsedSec = (f + 1) / plan.fps;
        const processedSec = Math.min(
          totalTargetSec,
          unit.timelineOffsetUs / 1_000_000 + unitElapsedSec
        );
        const percent = Math.min(95, Math.round((processedSec / Math.max(0.1, totalTargetSec)) * 95));

        const wallElapsedSec = Math.max(0.4, (Date.now() - exportWallStartMs) / 1000);
        const sessionProcessed = Math.max(0.05, processedSec - startProcessedSec);
        const rate = sessionProcessed / wallElapsedSec;
        const remainingVideoSec = Math.max(0, totalTargetSec - processedSec);
        const etaSec = rate > 0.02 ? Math.round(remainingVideoSec / rate) : null;

        onProgress({
          percent,
          encodedSec: processedSec,
          targetSec: totalTargetSec,
          etaSec,
          unitIndex: unit.unitIndex + 1,
          totalUnits,
          segmentIndex: unit.segmentIndex + 1,
          totalSegments,
          ramEstimateMb: getEstimatedHeapMb(),
          stageLabel: `Rendering cuts, effects & MP4 · Chunk ${unit.unitIndex + 1}/${totalUnits}`,
        });
      }
    }

    await Promise.all([videoEncoder.flush(), audioEncoder.flush()]);
    if (encoderError) throw encoderError;

    packets.sort((a, b) => a.timestamp - b.timestamp);

    return {
      packets,
      videoDecoderConfig: capturedVideoMeta,
      audioDecoderConfig: capturedAudioMeta,
      producedPrevFrame: true,
    };
  } finally {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      // ignore
    }
    try {
      if (audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      // ignore
    }
  }
}

async function exportWithChunkedWebCodecsMp4(options: {
  projectId: string;
  sourceBlob: Blob;
  sourceFileName: string;
  plan: BalancedQualityPlan;
  allSegments: TimelineSegment[];
  keptSegments: TimelineSegment[];
  existingCheckpoint?: ExportCheckpoint | null;
  signal?: AbortSignal;
  onProgress: (event: ExportProgressEvent) => void;
  onCheckpoint: (checkpoint: ExportCheckpoint) => Promise<void> | void;
}): Promise<{ blob: Blob; result: ExportResult } | null> {
  const {
    projectId,
    sourceBlob,
    sourceFileName,
    plan,
    allSegments,
    keptSegments,
    existingCheckpoint,
    signal,
    onProgress,
    onCheckpoint,
  } = options;

  const videoConfig = await pickSupportedH264Config(
    plan.width,
    plan.height,
    plan.fps,
    plan.videoBitsPerSecond
  );
  if (!videoConfig) return null;

  const decodedAudio = await extractDecodedAudioBuffer(sourceBlob);
  const desiredSampleRate = existingCheckpoint?.sampleRate ?? decodedAudio?.sampleRate ?? 48000;
  const desiredChannels =
    existingCheckpoint?.numberOfChannels ??
    Math.min(2, Math.max(1, decodedAudio?.numberOfChannels ?? 2));
  const audioConfig = await pickSupportedAacConfig(
    desiredSampleRate,
    desiredChannels,
    plan.audioBitsPerSecond
  );
  if (!audioConfig) return null;

  const { units, totalTargetSec } = buildExportUnits(
    keptSegments,
    plan.fps,
    audioConfig.sampleRate
  );
  if (units.length === 0) return null;

  let startUnitIndex = 0;
  let videoDecoderConfig = existingCheckpoint?.videoDecoderConfig;
  let audioDecoderConfig = existingCheckpoint?.audioDecoderConfig;

  if (
    existingCheckpoint &&
    existingCheckpoint.totalUnits === units.length &&
    existingCheckpoint.width === plan.width &&
    existingCheckpoint.height === plan.height &&
    existingCheckpoint.completedUnits > 0 &&
    existingCheckpoint.completedUnits <= units.length
  ) {
    const savedUnits = await getExportUnits(projectId);
    if (savedUnits.length >= existingCheckpoint.completedUnits) {
      startUnitIndex = existingCheckpoint.completedUnits;
    } else {
      await clearExportUnits(projectId);
    }
  } else {
    await clearExportUnits(projectId);
  }

  const startProcessedSec =
    startUnitIndex > 0 && startUnitIndex <= units.length
      ? units[startUnitIndex - 1].timelineOffsetUs / 1_000_000 + units[startUnitIndex - 1].editedDurationSec
      : 0;
  const exportWallStartMs = Date.now();

  const url = URL.createObjectURL(sourceBlob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = url;

  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to initialize MP4 export canvas');

  const prevFrameCanvas = document.createElement('canvas');
  prevFrameCanvas.width = plan.width;
  prevFrameCanvas.height = plan.height;
  const prevFrameCtx = prevFrameCanvas.getContext('2d');
  if (!prevFrameCtx) throw new Error('Failed to initialize transition buffer');

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout loading source video for MP4 export')), 15000);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error('Source video failed to decode for MP4 export'));
      };
    });

    let hasPrevFrame = false;
    // If resuming mid-project, seed transition buffer from previous unit's last frame
    if (startUnitIndex > 0) {
      const prevUnit = units[startUnitIndex - 1];
      await seekVideoSafe(video, Math.max(0, prevUnit.endSec - 0.02));
      renderProcessedVideoFrame({
        ctx: prevFrameCtx,
        video,
        prevFrameCanvas,
        hasPrevFrame: false,
        outWidth: plan.width,
        outHeight: plan.height,
        segProgress: 1,
        localOutTimeSec: 1,
        isFirstUnitOfSegment: false,
        effects: prevUnit.effects,
      });
      hasPrevFrame = true;
    }

    for (let uIdx = startUnitIndex; uIdx < units.length; uIdx++) {
      if (signal?.aborted) throw new DOMException('Export paused by user', 'AbortError');
      const unit = units[uIdx];

      const encoded = await encodeSingleUnit({
        unit,
        totalUnits: units.length,
        totalSegments: keptSegments.length,
        totalTargetSec,
        startProcessedSec,
        exportWallStartMs,
        video,
        canvas,
        ctx,
        prevFrameCanvas,
        prevFrameCtx,
        hasPrevFrame,
        plan,
        videoConfig,
        audioConfig,
        decodedAudio,
        signal,
        onProgress,
      });

      hasPrevFrame = encoded.producedPrevFrame;

      if (encoded.videoDecoderConfig && !videoDecoderConfig) {
        videoDecoderConfig = encoded.videoDecoderConfig;
      }
      if (encoded.audioDecoderConfig && !audioDecoderConfig) {
        audioDecoderConfig = encoded.audioDecoderConfig;
      }

      await saveExportUnit({
        key: `${projectId}:${unit.unitIndex}`,
        projectId,
        unitIndex: unit.unitIndex,
        packets: encoded.packets,
      });

      const processedSec = Math.min(
        totalTargetSec,
        unit.timelineOffsetUs / 1_000_000 + unit.editedDurationSec
      );

      await onCheckpoint({
        totalUnits: units.length,
        completedUnits: uIdx + 1,
        processedDurationSec: processedSec,
        targetDurationSec: totalTargetSec,
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        videoCodec: 'H.264 (AVC)',
        audioCodec: 'AAC-LC',
        sampleRate: audioConfig.sampleRate,
        numberOfChannels: audioConfig.numberOfChannels,
        videoDecoderConfig,
        audioDecoderConfig,
        updatedAt: Date.now(),
      });
    }

    onProgress({
      percent: 96,
      encodedSec: totalTargetSec,
      targetSec: totalTargetSec,
      etaSec: 2,
      unitIndex: units.length,
      totalUnits: units.length,
      segmentIndex: keptSegments.length,
      totalSegments: keptSegments.length,
      ramEstimateMb: getEstimatedHeapMb(),
      stageLabel: 'Assembling Fast-Start MP4 (H.264 + AAC)...',
    });

    const allStoredUnits = await getExportUnits(projectId);
    if (allStoredUnits.length !== units.length) {
      throw new Error(
        `Export incomplete: expected ${units.length} chunks, found ${allStoredUnits.length}. Please resume export.`
      );
    }

    const muxerTarget = new ArrayBufferTarget();
    const muxer = new Muxer({
      target: muxerTarget,
      video: {
        codec: 'avc',
        width: plan.width,
        height: plan.height,
        frameRate: plan.fps,
      },
      audio: {
        codec: 'aac',
        numberOfChannels: audioConfig.numberOfChannels,
        sampleRate: audioConfig.sampleRate,
      },
      fastStart: 'in-memory',
    });

    let sentVideoMeta = false;
    let sentAudioMeta = false;

    for (const storedUnit of allStoredUnits) {
      for (const pkt of storedUnit.packets) {
        const bytes = new Uint8Array(pkt.data);
        if (pkt.kind === 'video') {
          const meta = !sentVideoMeta && videoDecoderConfig ? { decoderConfig: videoDecoderConfig } : undefined;
          muxer.addVideoChunkRaw(bytes, pkt.type, pkt.timestamp, pkt.duration, meta);
          if (meta) sentVideoMeta = true;
        } else {
          const meta = !sentAudioMeta && audioDecoderConfig ? { decoderConfig: audioDecoderConfig } : undefined;
          muxer.addAudioChunkRaw(bytes, pkt.type, pkt.timestamp, pkt.duration, meta);
          if (meta) sentAudioMeta = true;
        }
      }
    }

    muxer.finalize();
    const exportedBlob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });

    onProgress({
      percent: 98,
      encodedSec: totalTargetSec,
      targetSec: totalTargetSec,
      etaSec: 1,
      unitIndex: units.length,
      totalUnits: units.length,
      segmentIndex: keptSegments.length,
      totalSegments: keptSegments.length,
      ramEstimateMb: getEstimatedHeapMb(),
      stageLabel: 'Verifying edited MP4 cuts, effects, audio & duration...',
    });

    const verification = await verifyExportedVideoBlob(exportedBlob, totalTargetSec, true);
    await clearExportUnits(projectId).catch(() => {});

    const { cutsAppliedCount, effectsAppliedCount } = countAppliedEffects(allSegments);
    const baseName = sourceFileName.replace(/\.[^.]+$/, '') || 'HanumanAI_Video';
    const outFileName = `${baseName}_HanumanAI_HD.mp4`;

    onProgress({
      percent: 100,
      encodedSec: totalTargetSec,
      targetSec: totalTargetSec,
      etaSec: 0,
      unitIndex: units.length,
      totalUnits: units.length,
      segmentIndex: keptSegments.length,
      totalSegments: keptSegments.length,
      ramEstimateMb: getEstimatedHeapMb(),
      stageLabel: 'Verified edited MP4 (H.264 + AAC) ready for Gallery',
    });

    return {
      blob: exportedBlob,
      result: {
        fileName: outFileName,
        mimeType: 'video/mp4',
        sizeBytes: exportedBlob.size,
        width: plan.width,
        height: plan.height,
        durationSec: totalTargetSec,
        verifiedDurationSec: verification.verifiedDurationSec,
        verifiedComplete: verification.verifiedComplete,
        cutsAppliedCount,
        effectsAppliedCount,
        qualityMode: 'balanced_auto',
        bitrateBps: plan.videoBitsPerSecond,
        videoCodec: 'H.264 (AVC)',
        audioCodec: 'AAC-LC',
        autoSavedToDevice: true,
        exportedAt: Date.now(),
      },
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function exportWithMediaRecorderFallback(options: {
  sourceBlob: Blob;
  sourceFileName: string;
  plan: BalancedQualityPlan;
  allSegments: TimelineSegment[];
  keptSegments: TimelineSegment[];
  signal?: AbortSignal;
  onProgress: (event: ExportProgressEvent) => void;
}): Promise<{ blob: Blob; result: ExportResult }> {
  const { sourceBlob, sourceFileName, plan, allSegments, keptSegments, signal, onProgress } = options;
  const targetSec = keptSegments.reduce(
    (acc, s) => acc + (s.editedDurationSec || s.durationSec / (s.effects?.speedFactor || 1)),
    0
  );
  const wallStartMs = Date.now();

  const url = URL.createObjectURL(sourceBlob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = url;

  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to initialize export canvas');

  const prevFrameCanvas = document.createElement('canvas');
  prevFrameCanvas.width = plan.width;
  prevFrameCanvas.height = plan.height;
  const prevFrameCtx = prevFrameCanvas.getContext('2d');
  if (!prevFrameCtx) throw new Error('Failed to initialize transition buffer');

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const audioDest = audioCtx.createMediaStreamDestination();
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;

  let sourceNode: MediaElementAudioSourceNode | null = null;
  let recorder: MediaRecorder | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout loading source video for export')), 15000);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error('Source video failed to decode for export'));
      };
    });

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    sourceNode = audioCtx.createMediaElementSource(video);
    sourceNode.connect(gainNode);
    gainNode.connect(audioDest);

    const canvasStream = canvas.captureStream(plan.fps);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);

    const recordedChunks: BlobPart[] = [];
    recorder = new MediaRecorder(combinedStream, {
      mimeType: plan.mimeType,
      videoBitsPerSecond: plan.videoBitsPerSecond,
      audioBitsPerSecond: plan.audioBitsPerSecond,
    });

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    };

    const stoppedPromise = new Promise<Blob>((resolve, reject) => {
      if (!recorder) return reject(new Error('Recorder not initialized'));
      recorder.onstop = () => resolve(new Blob(recordedChunks, { type: plan.mimeType }));
      recorder.onerror = () => reject(new Error('MediaRecorder encoding error'));
    });

    recorder.start(300);
    let accumulatedSec = 0;
    let hasPrevFrame = false;

    for (let idx = 0; idx < keptSegments.length; idx++) {
      if (signal?.aborted) throw new DOMException('Export paused by user', 'AbortError');

      const seg = keptSegments[idx];
      const effects = seg.effects ?? {
        speedFactor: 1,
        motionEffect: 'none',
        colorGrade: 'natural',
        transitionIn: 'cut',
        transitionDurationSec: 0,
      };
      const speedFactor = Math.max(0.5, Math.min(2.0, effects.speedFactor || 1));
      const segEditedDur = seg.durationSec / speedFactor;

      await seekVideoSafe(video, seg.startSec);
      video.playbackRate = speedFactor;

      const now = audioCtx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.linearRampToValueAtTime(1.0, now + 0.045);

      await video.play();

      await new Promise<void>((resolve, reject) => {
        let rafId = 0;
        let lastTime = video.currentTime;
        let lastProgressAt = Date.now();

        const drawStep = () => {
          if (signal?.aborted) {
            cancelAnimationFrame(rafId);
            video.pause();
            reject(new DOMException('Export paused by user', 'AbortError'));
            return;
          }

          if (video.paused && !video.ended && video.currentTime < seg.endSec - 0.04) {
            video.play().catch(() => {});
          }
          if (Math.abs(video.currentTime - lastTime) > 0.005) {
            lastTime = video.currentTime;
            lastProgressAt = Date.now();
          } else if (Date.now() - lastProgressAt > 3500) {
            cancelAnimationFrame(rafId);
            video.pause();
            reject(new Error('Export stalled while reading video segment. Please retry.'));
            return;
          }

          const srcElapsed = Math.max(0, video.currentTime - seg.startSec);
          const localOutTimeSec = srcElapsed / speedFactor;
          const segProgress = Math.min(1, srcElapsed / Math.max(0.1, seg.durationSec));

          renderProcessedVideoFrame({
            ctx,
            video,
            prevFrameCanvas,
            hasPrevFrame,
            outWidth: plan.width,
            outHeight: plan.height,
            segProgress,
            localOutTimeSec,
            isFirstUnitOfSegment: true,
            effects,
          });

          const remaining = seg.endSec - video.currentTime;
          if (remaining <= 0.06 && remaining > 0) {
            gainNode.gain.setTargetAtTime(0.001, audioCtx.currentTime, 0.015);
          }

          const encodedSec = Math.min(targetSec, accumulatedSec + localOutTimeSec);
          const percent = Math.min(97, Math.round((encodedSec / Math.max(0.1, targetSec)) * 97));
          const wallSec = Math.max(0.5, (Date.now() - wallStartMs) / 1000);
          const rate = encodedSec / wallSec;
          const etaSec = rate > 0.05 ? Math.round((targetSec - encodedSec) / rate) : null;

          onProgress({
            percent,
            encodedSec,
            targetSec,
            etaSec,
            unitIndex: idx + 1,
            totalUnits: keptSegments.length,
            segmentIndex: idx + 1,
            totalSegments: keptSegments.length,
            ramEstimateMb: getEstimatedHeapMb(),
            stageLabel: `Rendering cuts & effects · Segment ${idx + 1}/${keptSegments.length}`,
          });

          if (video.currentTime >= seg.endSec - 0.025 || video.ended) {
            cancelAnimationFrame(rafId);
            video.pause();
            prevFrameCtx.drawImage(canvas, 0, 0, plan.width, plan.height);
            hasPrevFrame = true;
            resolve();
            return;
          }

          rafId = requestAnimationFrame(drawStep);
        };

        rafId = requestAnimationFrame(drawStep);
      });

      accumulatedSec += segEditedDur;
    }

    if (recorder.state === 'recording') recorder.stop();
    const exportedBlob = await stoppedPromise;

    onProgress({
      percent: 98,
      encodedSec: targetSec,
      targetSec,
      etaSec: 1,
      unitIndex: keptSegments.length,
      totalUnits: keptSegments.length,
      segmentIndex: keptSegments.length,
      totalSegments: keptSegments.length,
      ramEstimateMb: getEstimatedHeapMb(),
      stageLabel: 'Verifying complete exported video...',
    });

    const verification = await verifyExportedVideoBlob(
      exportedBlob,
      targetSec,
      plan.extension === 'mp4'
    );

    const { cutsAppliedCount, effectsAppliedCount } = countAppliedEffects(allSegments);
    const baseName = sourceFileName.replace(/\.[^.]+$/, '') || 'HanumanAI_Video';
    const outFileName = `${baseName}_HanumanAI_HD.${plan.extension}`;

    onProgress({
      percent: 100,
      encodedSec: targetSec,
      targetSec,
      etaSec: 0,
      unitIndex: keptSegments.length,
      totalUnits: keptSegments.length,
      segmentIndex: keptSegments.length,
      totalSegments: keptSegments.length,
      ramEstimateMb: getEstimatedHeapMb(),
      stageLabel: 'Verified complete export ready',
    });

    return {
      blob: exportedBlob,
      result: {
        fileName: outFileName,
        mimeType: plan.mimeType,
        sizeBytes: exportedBlob.size,
        width: plan.width,
        height: plan.height,
        durationSec: targetSec,
        verifiedDurationSec: verification.verifiedDurationSec,
        verifiedComplete: verification.verifiedComplete,
        cutsAppliedCount,
        effectsAppliedCount,
        qualityMode: 'balanced_auto',
        bitrateBps: plan.videoBitsPerSecond,
        videoCodec: plan.videoCodecLabel,
        audioCodec: plan.audioCodecLabel,
        autoSavedToDevice: true,
        exportedAt: Date.now(),
      },
    };
  } finally {
    try {
      if (recorder && recorder.state === 'recording') recorder.stop();
    } catch {
      // ignore
    }
    try {
      sourceNode?.disconnect();
      gainNode.disconnect();
      audioCtx.close().catch(() => {});
    } catch {
      // ignore
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export function triggerPermanentDeviceDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Strict isolation: renders ONLY raw video frames from kept EDL segments with cuts, transitions,
// zoom/pan, slow-mo/speed-up, and color grading. Generated scripts are NEVER burned into frames.
export async function exportEditedVideo(options: {
  projectId: string;
  sourceBlob: Blob;
  sourceFileName: string;
  srcWidth: number;
  srcHeight: number;
  segments: TimelineSegment[];
  existingCheckpoint?: ExportCheckpoint | null;
  signal?: AbortSignal;
  onProgress: (event: ExportProgressEvent) => void;
  onCheckpoint: (checkpoint: ExportCheckpoint) => Promise<void> | void;
}): Promise<{ blob: Blob; result: ExportResult }> {
  const {
    projectId,
    sourceBlob,
    sourceFileName,
    srcWidth,
    srcHeight,
    segments,
    existingCheckpoint,
    signal,
    onProgress,
    onCheckpoint,
  } = options;

  const keptSegments = segments.filter((s) => s.action === 'keep' && s.durationSec > 0.05);
  if (keptSegments.length === 0) {
    throw new Error('No kept segments selected for export');
  }

  const plan = planBalancedAutoQuality(srcWidth, srcHeight);

  if (plan.extension === 'mp4' && typeof VideoEncoder !== 'undefined') {
    const mp4Outcome = await exportWithChunkedWebCodecsMp4({
      projectId,
      sourceBlob,
      sourceFileName,
      plan,
      allSegments: segments,
      keptSegments,
      existingCheckpoint,
      signal,
      onProgress,
      onCheckpoint,
    });
    if (mp4Outcome) {
      return mp4Outcome;
    }
  }

  return exportWithMediaRecorderFallback({
    sourceBlob,
    sourceFileName,
    plan,
    allSegments: segments,
    keptSegments,
    signal,
    onProgress,
  });
}
