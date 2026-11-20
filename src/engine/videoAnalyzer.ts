import {
  AnalysisSummary,
  ChunkCheckpoint,
  ColorGradeType,
  EditPreset,
  MotionEffectType,
  PeakMoment,
  RawSampleWindow,
  SceneEditingEffects,
  SegmentReason,
  TimelineSegment,
  TransitionType,
} from '../types/hanuman';

export interface VideoMetadataInfo {
  durationSec: number;
  width: number;
  height: number;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
}

export interface ChunkProgressEvent {
  chunkIndex: number;
  totalChunks: number;
  percent: number;
  currentTimeSec: number;
  ramEstimateMb: number;
  stageLabel: string;
  checkpoint?: ChunkCheckpoint;
}

const SAMPLE_WIDTH = 160;
const SAMPLE_HEIGHT = 90;
const STEP_SEC = 0.5;
const MAX_AUDIO_DECODE_BYTES = 160 * 1024 * 1024; // 160 MB ceiling for 6 GB RAM safety

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

export function getEstimatedHeapMb(): number {
  const perf = performance as unknown as {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  };
  if (perf?.memory?.usedJSHeapSize) {
    return Math.round((perf.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10;
  }
  return 42.5;
}

export async function probeVideoMetadata(file: Blob, fileName: string): Promise<VideoMetadataInfo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out reading video metadata')), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Unsupported or corrupted video format'));
      };
      video.src = url;
    });

    let durationSec = video.duration;
    // Handle WebM MediaRecorder files with Infinity duration until seeked
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      video.currentTime = 1e6;
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.onseeked = done;
        setTimeout(done, 1200);
      });
      durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
      video.currentTime = 0;
    }

    return {
      durationSec,
      width: video.videoWidth || 1280,
      height: video.videoHeight || 720,
      fileName,
      fileSizeBytes: file.size,
      mimeType: file.type || 'video/mp4',
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function extractAudioWindows(
  file: Blob,
  durationSec: number
): Promise<Map<number, { db: number; speechEnergy: number }> | null> {
  if (file.size > MAX_AUDIO_DECODE_BYTES) {
    return null;
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  let ctx: AudioContext | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    ctx = new AudioCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const samplesPerBin = Math.max(1, Math.floor(sampleRate * STEP_SEC));
    const numBins = Math.ceil(durationSec / STEP_SEC);
    const map = new Map<number, { db: number; speechEnergy: number }>();

    for (let i = 0; i < numBins; i++) {
      const start = i * samplesPerBin;
      const end = Math.min(channelData.length, start + samplesPerBin);
      if (start >= channelData.length) {
        map.set(i, { db: -60, speechEnergy: 0 });
        continue;
      }

      let sumSq = 0;
      let zcrCount = 0;
      let prev = channelData[start];
      for (let j = start; j < end; j++) {
        const v = channelData[j];
        sumSq += v * v;
        if ((v >= 0 && prev < 0) || (v < 0 && prev >= 0)) {
          zcrCount++;
        }
        prev = v;
      }
      const count = Math.max(1, end - start);
      const rms = Math.sqrt(sumSq / count);
      const db = rms > 1e-5 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;
      // Voice/speech typically shows moderate-to-high ZCR in 300-3400Hz band
      const zcrRate = zcrCount / (count / sampleRate);
      const speechFactor = zcrRate > 120 && zcrRate < 4200 ? Math.min(1, rms * 8) : Math.min(0.4, rms * 3);
      map.set(i, { db, speechEnergy: speechFactor });
    }

    return map;
  } catch {
    return null;
  } finally {
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }
}

function computeDHashAndMetrics(
  imageData: Uint8ClampedArray,
  prevImageData: Uint8ClampedArray | null
): { dHash: string; lumaAvg: number; lumaVariance: number; motionScore: number; hist: number[] } {
  const totalPixels = SAMPLE_WIDTH * SAMPLE_HEIGHT;
  let lumaSum = 0;
  let lumaSqSum = 0;
  let diffSum = 0;
  const hist = new Array<number>(16).fill(0);

  // 9x8 grid for 64-bit difference hash (dHash)
  const gridW = 9;
  const gridH = 8;
  const cellW = Math.floor(SAMPLE_WIDTH / gridW);
  const cellH = Math.floor(SAMPLE_HEIGHT / gridH);
  const gridLuma = new Float32Array(gridW * gridH);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = imageData[idx];
    const g = imageData[idx + 1];
    const b = imageData[idx + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    lumaSum += luma;
    lumaSqSum += luma * luma;
    const bin = Math.min(15, Math.floor(luma / 16));
    hist[bin]++;

    if (prevImageData) {
      const pr = prevImageData[idx];
      const pg = prevImageData[idx + 1];
      const pb = prevImageData[idx + 2];
      const pLuma = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      diffSum += Math.abs(luma - pLuma);
    }
  }

  // Fill 9x8 grid averages
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      let sum = 0;
      let cnt = 0;
      const yStart = gy * cellH;
      const xStart = gx * cellW;
      for (let y = yStart; y < yStart + cellH; y++) {
        for (let x = xStart; x < xStart + cellW; x++) {
          const idx = (y * SAMPLE_WIDTH + x) * 4;
          sum += 0.299 * imageData[idx] + 0.587 * imageData[idx + 1] + 0.114 * imageData[idx + 2];
          cnt++;
        }
      }
      gridLuma[gy * gridW + gx] = sum / Math.max(1, cnt);
    }
  }

  let bits = '';
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const left = gridLuma[gy * gridW + gx];
      const right = gridLuma[gy * gridW + gx + 1];
      bits += left > right ? '1' : '0';
    }
  }

  for (let i = 0; i < 16; i++) {
    hist[i] /= totalPixels;
  }

  const lumaAvg = lumaSum / totalPixels;
  const lumaVariance = Math.max(0, lumaSqSum / totalPixels - lumaAvg * lumaAvg);
  const motionScore = prevImageData ? diffSum / (totalPixels * 255) : 0.05;

  return { dHash: bits, lumaAvg, lumaVariance, motionScore, hist };
}

function histogramDistance(a: number[] | null, b: number[]): number {
  if (!a) return 0;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    dist += Math.abs(a[i] - b[i]);
  }
  return dist / 2; // 0..1 normalized
}

export function hammingSimilarity(hashA: string, hashB: string): number {
  if (!hashA || !hashB || hashA.length !== hashB.length) return 0;
  let matches = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] === hashB[i]) matches++;
  }
  return matches / hashA.length;
}

export async function analyzeVideoInChunks(options: {
  file: Blob;
  meta: VideoMetadataInfo;
  chunkDurationSec: number;
  startChunkIndex?: number;
  existingCheckpoints?: ChunkCheckpoint[];
  existingWindows?: RawSampleWindow[];
  signal?: AbortSignal;
  onProgress: (event: ChunkProgressEvent) => void;
  onChunkComplete?: (
    checkpoint: ChunkCheckpoint,
    allCheckpoints: ChunkCheckpoint[],
    allWindows: RawSampleWindow[]
  ) => Promise<void> | void;
}): Promise<{
  windows: RawSampleWindow[];
  checkpoints: ChunkCheckpoint[];
}> {
  const {
    file,
    meta,
    chunkDurationSec,
    startChunkIndex = 0,
    existingCheckpoints = [],
    existingWindows = [],
    signal,
    onProgress,
    onChunkComplete,
  } = options;

  const totalChunks = Math.max(1, Math.ceil(meta.durationSec / chunkDurationSec));
  const checkpoints = [...existingCheckpoints];
  const windows = [...existingWindows];

  onProgress({
    chunkIndex: startChunkIndex,
    totalChunks,
    percent: Math.round((startChunkIndex / totalChunks) * 100),
    currentTimeSec: startChunkIndex * chunkDurationSec,
    ramEstimateMb: getEstimatedHeapMb(),
    stageLabel: 'Extracting audio energy envelope...',
  });

  const audioMap = await extractAudioWindows(file, meta.durationSec);

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Unable to create 2D analysis canvas');

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Video frame decoder timeout')), 15000);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error('Failed to decode video frames'));
      };
      video.src = url;
    });

    let prevPixels: Uint8ClampedArray | null = null;
    let prevHist: number[] | null = null;

    for (let chunkIdx = startChunkIndex; chunkIdx < totalChunks; chunkIdx++) {
      if (signal?.aborted) {
        throw new DOMException('Analysis paused by user', 'AbortError');
      }

      const chunkStart = chunkIdx * chunkDurationSec;
      const chunkEnd = Math.min(meta.durationSec, (chunkIdx + 1) * chunkDurationSec);
      let framesInChunk = 0;
      let sceneChanges = 0;
      let peakAudioDb = -60;

      for (let t = chunkStart; t < chunkEnd; t += STEP_SEC) {
        if (signal?.aborted) {
          throw new DOMException('Analysis paused by user', 'AbortError');
        }

        const targetTime = Math.min(Math.max(0, t), Math.max(0, meta.durationSec - 0.05));
        video.currentTime = targetTime;
        await new Promise<void>((resolve) => {
          let resolved = false;
          const finish = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          video.onseeked = finish;
          setTimeout(finish, 450);
        });

        ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const frame = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const currentPixels = new Uint8ClampedArray(frame.data);

        const metrics = computeDHashAndMetrics(currentPixels, prevPixels);
        const sceneCutScore = histogramDistance(prevHist, metrics.hist);
        if (sceneCutScore > 0.22) {
          sceneChanges++;
        }

        const binIdx = Math.floor(t / STEP_SEC);
        const audioInfo = audioMap?.get(binIdx);
        // If audio track unavailable (>160MB streaming guard or silent container), infer conservative neutral level
        const avgAudioDb = audioInfo ? audioInfo.db : -26;
        const speechEnergy = audioInfo ? audioInfo.speechEnergy : metrics.motionScore > 0.03 ? 0.5 : 0.1;

        if (avgAudioDb > peakAudioDb) peakAudioDb = avgAudioDb;

        windows.push({
          startSec: t,
          endSec: Math.min(meta.durationSec, t + STEP_SEC),
          avgAudioDb,
          speechEnergy,
          motionScore: metrics.motionScore,
          sceneCutScore,
          lumaAvg: metrics.lumaAvg,
          lumaVariance: metrics.lumaVariance,
          dHash: metrics.dHash,
        });

        prevPixels = currentPixels;
        prevHist = metrics.hist;
        framesInChunk++;

        const overallPct = Math.min(
          99,
          Math.round(((t - 0) / Math.max(1, meta.durationSec)) * 100)
        );
        if (framesInChunk % 4 === 0) {
          onProgress({
            chunkIndex: chunkIdx,
            totalChunks,
            percent: overallPct,
            currentTimeSec: t,
            ramEstimateMb: getEstimatedHeapMb(),
            stageLabel: `Chunk ${chunkIdx + 1}/${totalChunks} · Analyzing frames & audio`,
          });
          await yieldToMain();
        }
      }

      const checkpoint: ChunkCheckpoint = {
        chunkIndex: chunkIdx,
        totalChunks,
        startSec: chunkStart,
        endSec: chunkEnd,
        framesAnalyzed: framesInChunk,
        sceneChanges,
        peakAudioDb,
        estimatedRamMb: getEstimatedHeapMb(),
        completedAt: Date.now(),
      };
      checkpoints.push(checkpoint);

      onProgress({
        chunkIndex: chunkIdx + 1,
        totalChunks,
        percent: Math.round(((chunkIdx + 1) / totalChunks) * 100),
        currentTimeSec: chunkEnd,
        ramEstimateMb: checkpoint.estimatedRamMb,
        stageLabel: `Saved checkpoint for chunk ${chunkIdx + 1}/${totalChunks}`,
        checkpoint,
      });

      if (onChunkComplete) {
        await onChunkComplete(checkpoint, [...checkpoints], [...windows]);
      }

      // Release temporary pressure between chunks for 6GB RAM Android devices
      await yieldToMain();
    }

    return { windows, checkpoints };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export function buildEdlFromWindows(
  windows: RawSampleWindow[],
  meta: VideoMetadataInfo,
  preset: EditPreset
): { segments: TimelineSegment[]; summary: AnalysisSummary } {
  if (windows.length === 0) {
    throw new Error('No analyzed frames available');
  }

  // Compute adaptive noise floor (15th percentile audio dB)
  const sortedDb = [...windows].map((w) => w.avgAudioDb).sort((a, b) => a - b);
  const noiseFloorDb = sortedDb[Math.floor(sortedDb.length * 0.15)] ?? -48;
  const silenceThresholdDb =
    preset === 'aggressive_retention'
      ? Math.max(-44, noiseFloorDb + 8)
      : preset === 'gentle_pause'
      ? Math.max(-52, noiseFloorDb + 3)
      : Math.max(-48, noiseFloorDb + 5);

  const staticMotionThreshold =
    preset === 'aggressive_retention' ? 0.022 : preset === 'gentle_pause' ? 0.008 : 0.014;

  // Step 1: Classify every 0.5s window
  const keptHashes: Array<{ startSec: number; dHash: string }> = [];
  const windowReasons: Array<{
    reason: SegmentReason;
    action: 'keep' | 'cut';
    hashSimilarity: number;
    confidence: number;
  }> = [];

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const isQuiet = w.avgAudioDb <= silenceThresholdDb;
    const isStatic = w.motionScore <= staticMotionThreshold;
    const isBlank = w.lumaVariance < 18 && (w.lumaAvg < 14 || w.lumaAvg > 244);

    // Check against earlier kept segments (>2.5s prior) for repeated clips
    let maxSim = 0;
    for (let k = 0; k < keptHashes.length; k++) {
      if (w.startSec - keptHashes[k].startSec >= 2.5) {
        const sim = hammingSimilarity(w.dHash, keptHashes[k].dHash);
        if (sim > maxSim) maxSim = sim;
      }
    }

    const repeatThreshold = preset === 'gentle_pause' ? 0.94 : 0.9;
    let reason: SegmentReason = 'keep';
    let action: 'keep' | 'cut' = 'keep';
    let confidence = 0.84;

    if (isBlank || (isStatic && isQuiet && w.sceneCutScore < 0.04)) {
      reason = isQuiet && w.avgAudioDb <= -46 ? 'silent_section' : 'unnecessary_scene';
      action = 'cut';
      confidence = 0.91;
    } else if (maxSim >= repeatThreshold && w.motionScore < 0.06 && preset !== 'gentle_pause') {
      reason = 'repeated_clip';
      action = 'cut';
      confidence = Math.min(0.96, maxSim);
    } else if (isQuiet && w.motionScore < 0.045 && w.sceneCutScore < 0.18) {
      reason = 'long_pause';
      action = 'cut';
      confidence = 0.86;
    } else if (w.avgAudioDb > noiseFloorDb + 14 || w.motionScore > 0.065 || w.sceneCutScore > 0.22) {
      reason = 'highlight';
      action = 'keep';
      confidence = 0.92;
      keptHashes.push({ startSec: w.startSec, dHash: w.dHash });
    } else {
      reason = 'keep';
      action = 'keep';
      confidence = 0.85;
      keptHashes.push({ startSec: w.startSec, dHash: w.dHash });
    }

    if (preset === 'highlight_reel' && reason === 'keep' && w.motionScore < 0.035 && w.avgAudioDb < noiseFloorDb + 10) {
      reason = 'unnecessary_scene';
      action = 'cut';
      confidence = 0.79;
    }

    windowReasons.push({ reason, action, hashSimilarity: maxSim, confidence });
  }

  // Step 2: Merge contiguous windows with the same action/reason and apply minimum segment duration smoothing
  const rawSegments: TimelineSegment[] = [];
  let startIdx = 0;

  const flushSegment = (fromIdx: number, toIdx: number) => {
    const slice = windows.slice(fromIdx, toIdx + 1);
    const metaSlice = windowReasons.slice(fromIdx, toIdx + 1);
    const first = slice[0];
    const last = slice[slice.length - 1];
    const durationSec = Math.max(0.25, last.endSec - first.startSec);
    let reason = metaSlice[0].reason;
    let action = metaSlice[0].action;

    // Gentle pause tolerance: don't chop micro <0.9s pauses into jarring cuts
    if (action === 'cut' && durationSec < 0.9 && preset !== 'aggressive_retention') {
      action = 'keep';
      reason = 'keep';
    }

    // Distinguish silent_section (>=1.5s very quiet) vs long_pause (0.9-1.5s)
    const avgAudioDb = slice.reduce((acc, s) => acc + s.avgAudioDb, 0) / slice.length;
    if (action === 'cut' && reason === 'long_pause' && durationSec >= 1.5 && avgAudioDb < -44) {
      reason = 'silent_section';
    }

    const motionScore = slice.reduce((acc, s) => acc + s.motionScore, 0) / slice.length;
    const sceneCutScore = Math.max(...slice.map((s) => s.sceneCutScore));
    const hashSimilarity = Math.max(...metaSlice.map((m) => m.hashSimilarity));
    const confidence = metaSlice.reduce((acc, m) => acc + m.confidence, 0) / metaSlice.length;
    const lumaAvg = slice.reduce((acc, s) => acc + s.lumaAvg, 0) / slice.length;

    const labelMap: Record<SegmentReason, string> = {
      keep: 'Active Scene',
      highlight: 'Key Highlight',
      silent_section: 'Silent Dead Air',
      long_pause: 'Long Pause',
      repeated_clip: 'Repeated Clip',
      unnecessary_scene: 'Static / Filler Scene',
    };

    const defaultEffects: SceneEditingEffects = {
      speedFactor: 1,
      motionEffect: 'none',
      colorGrade: 'natural',
      transitionIn: 'cut',
      transitionDurationSec: 0,
    };

    rawSegments.push({
      id: `seg-${rawSegments.length + 1}`,
      index: rawSegments.length,
      startSec: first.startSec,
      endSec: last.endSec,
      durationSec,
      editedDurationSec: action === 'keep' ? durationSec : 0,
      reason,
      action,
      confidence,
      avgAudioDb,
      motionScore,
      sceneCutScore,
      hashSimilarity,
      dHash: first.dHash,
      lumaAvg,
      label: labelMap[reason],
      effects: defaultEffects,
    });
  };

  for (let i = 1; i < windows.length; i++) {
    const prev = windowReasons[i - 1];
    const curr = windowReasons[i];
    const wCurr = windows[i];
    const prevSliceStart = windows[startIdx].startSec;
    // Also split contiguous kept footage when a real visual scene cut occurs (>=1.5s into segment)
    const isSceneBoundary =
      prev.action === 'keep' &&
      curr.action === 'keep' &&
      wCurr.sceneCutScore > 0.21 &&
      wCurr.startSec - prevSliceStart >= 1.5;

    if (prev.action !== curr.action || prev.reason !== curr.reason || isSceneBoundary) {
      flushSegment(startIdx, i - 1);
      startIdx = i;
    }
  }
  flushSegment(startIdx, windows.length - 1);

  // Merge adjacent segments ONLY when both are cuts of the same reason (preserve distinct scene boundaries on kept clips)
  const segments: TimelineSegment[] = [];
  for (const seg of rawSegments) {
    const prev = segments[segments.length - 1];
    if (
      prev &&
      prev.action === 'cut' &&
      seg.action === 'cut' &&
      prev.reason === seg.reason
    ) {
      const totalDur = prev.durationSec + seg.durationSec;
      prev.endSec = seg.endSec;
      prev.durationSec = totalDur;
      prev.avgAudioDb = (prev.avgAudioDb + seg.avgAudioDb) / 2;
      prev.motionScore = (prev.motionScore + seg.motionScore) / 2;
      prev.sceneCutScore = Math.max(prev.sceneCutScore, seg.sceneCutScore);
      prev.hashSimilarity = Math.max(prev.hashSimilarity, seg.hashSimilarity);
    } else {
      segments.push({ ...seg, index: segments.length, id: `seg-${segments.length + 1}` });
    }
  }

  // Guarantee at least one kept segment so export never becomes 0 seconds
  if (!segments.some((s) => s.action === 'keep') && segments.length > 0) {
    segments[0].action = 'keep';
    segments[0].reason = 'keep';
    segments[0].label = 'Active Scene';
  }

  assignSceneEditingEffects(segments, preset, noiseFloorDb);

  const summary = computeSummaryFromSegments(segments, windows, meta, noiseFloorDb);
  return { segments, summary };
}

export function assignSceneEditingEffects(
  segments: TimelineSegment[],
  preset: EditPreset,
  noiseFloorDb = -48
): void {
  const kept = segments.filter((s) => s.action === 'keep');
  kept.forEach((seg, keptIdx) => {
    // 1. Speed / Slow-motion selection (keep speech natural 1.0x; slow-mo action highlights; speed-up silent/low-speech action bridges)
    let speedFactor = 1.0;
    const isLowVocal = seg.avgAudioDb <= noiseFloorDb + 9;
    if (seg.reason === 'highlight' && seg.motionScore >= 0.08 && seg.durationSec >= 1.4 && isLowVocal) {
      speedFactor = 0.72; // Cinematic slow motion on high-motion visual climax
    } else if (seg.motionScore >= 0.032 && isLowVocal && seg.durationSec >= 2.0) {
      speedFactor = preset === 'aggressive_retention' ? 1.35 : 1.25; // Brisk speed-up on silent motion bridges
    }

    // 2. Zoom / Motion selection
    let motionEffect: MotionEffectType = 'none';
    if (keptIdx === 0 && seg.durationSec >= 1.2) {
      motionEffect = 'zoom_out';
    } else if (seg.reason === 'highlight') {
      motionEffect = 'zoom_in';
    } else if (seg.motionScore < 0.045 && seg.durationSec >= 1.2) {
      motionEffect = keptIdx % 2 === 0 ? 'pan_drift' : 'zoom_in';
    } else if (keptIdx % 2 === 1 && seg.motionScore < 0.11) {
      motionEffect = 'zoom_in';
    }

    // 3. Color Grading selection based on scene luminance & energy
    let colorGrade: ColorGradeType = 'natural';
    if (seg.lumaAvg < 82) {
      colorGrade = 'crisp_clarity';
    } else if (seg.reason === 'highlight') {
      colorGrade = 'vivid_punch';
    } else {
      colorGrade = 'cinematic_warm';
    }

    // 4. Transition In selection
    let transitionIn: TransitionType = 'cut';
    let transitionDurationSec = 0;
    if (keptIdx === 0) {
      transitionIn = 'dip_black';
      transitionDurationSec = Math.min(0.32, seg.durationSec * 0.25);
    } else if (seg.reason === 'highlight') {
      transitionIn = 'zoom_push';
      transitionDurationSec = Math.min(0.28, seg.durationSec * 0.25);
    } else if (seg.sceneCutScore > 0.16 || segments[seg.index - 1]?.action === 'cut') {
      transitionIn = 'crossfade';
      transitionDurationSec = Math.min(0.32, seg.durationSec * 0.25);
    }

    seg.effects = {
      speedFactor,
      motionEffect,
      colorGrade,
      transitionIn,
      transitionDurationSec,
    };
    seg.editedDurationSec = seg.durationSec / speedFactor;
  });

  for (const seg of segments) {
    if (seg.action === 'cut') {
      seg.editedDurationSec = 0;
      seg.effects = {
        speedFactor: 1,
        motionEffect: 'none',
        colorGrade: 'natural',
        transitionIn: 'cut',
        transitionDurationSec: 0,
      };
    }
  }
}

export function computeSummaryFromSegments(
  segments: TimelineSegment[],
  windows: RawSampleWindow[],
  meta: VideoMetadataInfo,
  noiseFloorDb = -48
): AnalysisSummary {
  const editedDurationSec = segments
    .filter((s) => s.action === 'keep')
    .reduce((acc, s) => acc + (s.editedDurationSec || s.durationSec / (s.effects?.speedFactor || 1)), 0);
  const timeSavedSec = Math.max(0, meta.durationSec - editedDurationSec);
  const savedPercent = meta.durationSec > 0 ? (timeSavedSec / meta.durationSec) * 100 : 0;

  const avgLuma =
    windows.reduce((acc, w) => acc + w.lumaAvg, 0) / Math.max(1, windows.length);
  const avgMotion =
    windows.reduce((acc, w) => acc + w.motionScore, 0) / Math.max(1, windows.length);
  const avgDb =
    windows.reduce((acc, w) => acc + w.avgAudioDb, 0) / Math.max(1, windows.length);
  const speechWindows = windows.filter((w) => w.avgAudioDb > noiseFloorDb + 6).length;

  const waveformBins = downsampleWaveform(windows, 96);

  const peakMoments: PeakMoment[] = segments
    .filter((s) => s.action === 'keep')
    .map((s) => ({
      timeSec: s.startSec,
      score: Math.round((s.motionScore * 100 + Math.max(0, s.avgAudioDb + 50)) * 10) / 10,
      label: s.reason === 'highlight' ? 'Peak Action' : 'Active Beat',
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.timeSec - b.timeSec);

  const aspect: 'portrait' | 'landscape' | 'square' =
    meta.height > meta.width * 1.08
      ? 'portrait'
      : meta.width > meta.height * 1.08
      ? 'landscape'
      : 'square';

  return {
    durationSec: meta.durationSec,
    editedDurationSec,
    timeSavedSec,
    savedPercent,
    width: meta.width,
    height: meta.height,
    fpsEstimate: 30,
    fileSizeBytes: meta.fileSizeBytes,
    mimeType: meta.mimeType,
    fileName: meta.fileName,
    totalFramesSampled: windows.length,
    silentCount: segments.filter((s) => s.reason === 'silent_section').length,
    pauseCount: segments.filter((s) => s.reason === 'long_pause').length,
    repeatedCount: segments.filter((s) => s.reason === 'repeated_clip').length,
    unnecessaryCount: segments.filter((s) => s.reason === 'unnecessary_scene').length,
    sceneCutCount: windows.filter((w) => w.sceneCutScore > 0.22).length,
    waveformBins,
    peakMoments,
    visualProfile: {
      brightness: avgLuma < 75 ? 'dark' : avgLuma > 165 ? 'bright' : 'balanced',
      pacing: avgMotion > 0.065 ? 'dynamic' : avgMotion > 0.025 ? 'moderate' : 'calm',
      aspect,
    },
    audioProfile: {
      speechRatio: speechWindows / Math.max(1, windows.length),
      avgDb,
      noiseFloorDb,
    },
  };
}

function downsampleWaveform(windows: RawSampleWindow[], targetBins: number): number[] {
  if (windows.length === 0) return new Array(targetBins).fill(0.15);
  const bins: number[] = [];
  const step = windows.length / targetBins;
  for (let i = 0; i < targetBins; i++) {
    const idx = Math.min(windows.length - 1, Math.floor(i * step));
    const db = windows[idx].avgAudioDb;
    const norm = Math.max(0.06, Math.min(1, (db + 58) / 54));
    bins.push(norm);
  }
  return bins;
}
