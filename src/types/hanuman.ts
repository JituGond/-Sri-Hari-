export type ImportSource =
  | 'gallery'
  | 'screen_recording'
  | 'file_manager'
  | 'live_capture'
  | 'demo_fixture';

export type EditPreset =
  | 'balanced_smart'
  | 'aggressive_retention'
  | 'gentle_pause'
  | 'highlight_reel';

export type VideoCategory =
  | 'auto_detect'
  | 'tutorial_screen'
  | 'vlog_story'
  | 'product_review'
  | 'educational'
  | 'motivational_reel';

export type SegmentReason =
  | 'keep'
  | 'highlight'
  | 'silent_section'
  | 'long_pause'
  | 'repeated_clip'
  | 'unnecessary_scene';

export type MotionEffectType = 'none' | 'zoom_in' | 'zoom_out' | 'pan_drift';
export type ColorGradeType = 'natural' | 'cinematic_warm' | 'crisp_clarity' | 'vivid_punch';
export type TransitionType = 'cut' | 'crossfade' | 'zoom_push' | 'dip_black';

export interface SceneEditingEffects {
  speedFactor: number; // e.g., 0.7 (slow-mo), 1.0 (normal), 1.3 (speed-up)
  motionEffect: MotionEffectType;
  colorGrade: ColorGradeType;
  transitionIn: TransitionType;
  transitionDurationSec: number;
}

export interface TimelineSegment {
  id: string;
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  editedDurationSec: number;
  reason: SegmentReason;
  action: 'keep' | 'cut';
  confidence: number;
  avgAudioDb: number;
  motionScore: number;
  sceneCutScore: number;
  hashSimilarity: number;
  dHash: string;
  lumaAvg: number;
  label: string;
  effects: SceneEditingEffects;
  userOverride?: boolean;
}

export interface ChunkCheckpoint {
  chunkIndex: number;
  totalChunks: number;
  startSec: number;
  endSec: number;
  framesAnalyzed: number;
  sceneChanges: number;
  peakAudioDb: number;
  estimatedRamMb: number;
  completedAt: number;
}

export interface PeakMoment {
  timeSec: number;
  score: number;
  label: string;
}

export interface AnalysisSummary {
  durationSec: number;
  editedDurationSec: number;
  timeSavedSec: number;
  savedPercent: number;
  width: number;
  height: number;
  fpsEstimate: number;
  fileSizeBytes: number;
  mimeType: string;
  fileName: string;
  totalFramesSampled: number;
  silentCount: number;
  pauseCount: number;
  repeatedCount: number;
  unnecessaryCount: number;
  sceneCutCount: number;
  waveformBins: number[];
  peakMoments: PeakMoment[];
  visualProfile: {
    brightness: 'dark' | 'balanced' | 'bright';
    pacing: 'calm' | 'moderate' | 'dynamic';
    aspect: 'portrait' | 'landscape' | 'square';
  };
  audioProfile: {
    speechRatio: number;
    avgDb: number;
    noiseFloorDb: number;
  };
}

export interface ScriptStructure {
  title: string;
  hook: string;
  storytelling: string;
  transitions: string[];
  ending: string;
  fullPlainText: string;
}

export interface SceneBeat {
  id: string;
  startSec: number;
  endSec: number;
  visualCue: string;
  englishLine: string;
  hindiLine: string;
}

export interface BilingualScript {
  category: VideoCategory;
  generatedAt: number;
  isolatedFromVideo: true;
  english: ScriptStructure;
  hindi: ScriptStructure;
  sceneBeats: SceneBeat[];
}

export interface ExportCheckpoint {
  totalUnits: number;
  completedUnits: number;
  processedDurationSec: number;
  targetDurationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  sampleRate: number;
  numberOfChannels: number;
  videoDecoderConfig?: EncodedVideoChunkMetadata['decoderConfig'];
  audioDecoderConfig?: EncodedAudioChunkMetadata['decoderConfig'];
  updatedAt: number;
}

export interface ExportResult {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  durationSec: number;
  verifiedDurationSec: number;
  verifiedComplete: boolean;
  cutsAppliedCount: number;
  effectsAppliedCount: number;
  qualityMode: 'balanced_auto';
  bitrateBps: number;
  videoCodec: string;
  audioCodec: string;
  autoSavedToDevice: boolean;
  exportedAt: number;
}

export type ProjectStatus =
  | 'imported'
  | 'analyzing'
  | 'paused'
  | 'edited'
  | 'rendering'
  | 'export_paused'
  | 'exported';

export interface ProjectRecord {
  id: string;
  name: string;
  sourceType: ImportSource;
  status: ProjectStatus;
  preset: EditPreset;
  category: VideoCategory;
  chunkDurationSec: number;
  currentChunk: number;
  totalChunks: number;
  checkpoints: ChunkCheckpoint[];
  rawWindows?: RawSampleWindow[];
  segments: TimelineSegment[];
  summary: AnalysisSummary | null;
  script: BilingualScript | null;
  exportCheckpoint?: ExportCheckpoint | null;
  exportResult: ExportResult | null;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export interface RawSampleWindow {
  startSec: number;
  endSec: number;
  avgAudioDb: number;
  speechEnergy: number;
  motionScore: number;
  sceneCutScore: number;
  lumaAvg: number;
  lumaVariance: number;
  dHash: string;
}
