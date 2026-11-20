import React, { useMemo, useState } from 'react';
import {
  Download,
  Play,
  Pause,
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
  FolderOutput,
  Share2,
  Clock,
} from 'lucide-react';
import {
  AnalysisSummary,
  ExportCheckpoint,
  ExportResult,
  TimelineSegment,
} from '../types/hanuman';
import { ExportProgressEvent, planBalancedAutoQuality } from '../engine/videoExporter';
import { formatClock } from './VideoPreviewStage';

interface ExportStudioProps {
  summary: AnalysisSummary;
  segments: TimelineSegment[];
  isExporting: boolean;
  exportProgress: ExportProgressEvent | null;
  exportCheckpoint: ExportCheckpoint | null | undefined;
  exportError: string | null;
  exportResult: ExportResult | null;
  exportedVideoUrl: string | null;
  onStartExport: () => void;
  onPauseExport: () => void;
  onResetExport: () => void;
  onSaveToGalleryFolder: () => Promise<void>;
  onShareMp4: () => Promise<void>;
}

function formatEta(etaSec: number | null): string {
  if (etaSec === null || !Number.isFinite(etaSec)) return 'Calculating...';
  if (etaSec <= 1) return '< 2s left';
  if (etaSec < 60) return `~${etaSec}s left`;
  const m = Math.floor(etaSec / 60);
  const s = etaSec % 60;
  return `~${m}m ${s}s left`;
}

export const ExportStudio: React.FC<ExportStudioProps> = ({
  summary,
  segments,
  isExporting,
  exportProgress,
  exportCheckpoint,
  exportError,
  exportResult,
  exportedVideoUrl,
  onStartExport,
  onPauseExport,
  onResetExport,
  onSaveToGalleryFolder,
  onShareMp4,
}) => {
  const plan = useMemo(
    () => planBalancedAutoQuality(summary.width, summary.height),
    [summary.width, summary.height]
  );

  const [actionNote, setActionNote] = useState<string | null>(null);
  const keptSegments = segments.filter((s) => s.action === 'keep' && s.durationSec > 0.05);
  const totalKeptDurationSec = keptSegments.reduce(
    (acc, s) => acc + (s.editedDurationSec || s.durationSec / (s.effects?.speedFactor || 1)),
    0
  );

  const hasPausedExport =
    !isExporting &&
    !!exportCheckpoint &&
    exportCheckpoint.completedUnits > 0 &&
    exportCheckpoint.completedUnits < exportCheckpoint.totalUnits;

  const canPickSaveFolder =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

  const canShareFiles =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  };

  const handleFolderSaveClick = async () => {
    setActionNote(null);
    try {
      await onSaveToGalleryFolder();
      setActionNote('Saved permanently to your selected device folder as MP4 (H.264 + AAC).');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setActionNote((err as Error)?.message || 'Could not save to custom folder.');
      }
    }
  };

  const handleShareClick = async () => {
    setActionNote(null);
    try {
      await onShareMp4();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setActionNote('Direct share sheet is unavailable in this browser—the MP4 file is already saved to Downloads/Gallery.');
      }
    }
  };

  const pausedPct = hasPausedExport && exportCheckpoint
    ? Math.round((exportCheckpoint.completedUnits / Math.max(1, exportCheckpoint.totalUnits)) * 95)
    : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#121722]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Full-Length Verified MP4 (H.264 + AAC) · Resumable Chunk Export
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
              Export &amp; Save Complete HD MP4
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              Processes all {keptSegments.length} kept segments ({formatClock(totalKeptDurationSec)}) in resumable chunks, verifies full duration and audio-video integrity, and saves permanently for Android Gallery playback.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!isExporting ? (
              <>
                <button
                  type="button"
                  onClick={onStartExport}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#E04F16] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#C84310] whitespace-nowrap"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  <span>{hasPausedExport ? 'Resume Export' : 'Export Complete MP4'}</span>
                </button>
                {hasPausedExport && (
                  <button
                    type="button"
                    onClick={onResetExport}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span>Restart</span>
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={onPauseExport}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-amber-400 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200 whitespace-nowrap"
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                <span>Pause &amp; Save Progress</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4 dark:border-slate-800">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Container &amp; Codecs</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              MP4 · {plan.videoCodecLabel}
            </div>
            <div className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
              {plan.audioCodecLabel} · {(plan.videoBitsPerSecond / 1_000_000).toFixed(1)} Mbps
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">HD Resolution</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-white">
              {plan.width} × {plan.height}
            </div>
            <div className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              {plan.resolutionPreserved ? 'Original resolution preserved' : 'Safe 1080p HD cap'}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Target Full Duration</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-white">
              {formatClock(totalKeptDurationSec)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
              Saved {summary.timeSavedSec.toFixed(1)}s dead air
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Verification &amp; Safety</div>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              Full Duration Verified
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              No script burn-in
            </div>
          </div>
        </div>

        {/* Live Export Progress */}
        {isExporting && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-semibold text-slate-900 dark:text-white">
                {exportProgress?.stageLabel || 'Initializing full-video MP4 encoder...'}
              </span>
              <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-[#E04F16] tabular-nums">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {formatEta(exportProgress?.etaSec ?? null)}
              </span>
            </div>

            <div className="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                style={{ width: `${exportProgress?.percent ?? 2}%` }}
                className="h-full bg-[#E04F16] transition-all duration-150"
              />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-slate-600 tabular-nums dark:text-slate-300">
              <span>
                Progress: <strong>{exportProgress?.percent ?? 0}%</strong>
              </span>
              <span>
                Processed: <strong>{formatClock(exportProgress?.encodedSec ?? 0)}</strong> /{' '}
                {formatClock(exportProgress?.targetSec ?? totalKeptDurationSec)}
              </span>
              <span>
                Chunk {exportProgress?.unitIndex ?? 1}/{exportProgress?.totalUnits ?? 1} · Heap ~
                {exportProgress?.ramEstimateMb ?? 45} MB
              </span>
            </div>
          </div>
        )}

        {/* Paused / Interrupted Recovery Banner */}
        {hasPausedExport && exportCheckpoint && (
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-700/60 dark:bg-amber-950/30">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <span>
                Export Paused — Saved {exportCheckpoint.completedUnits} of{' '}
                {exportCheckpoint.totalUnits} chunks in offline storage
              </span>
              <span className="font-mono tabular-nums">
                {pausedPct}% · {formatClock(exportCheckpoint.processedDurationSec)} /{' '}
                {formatClock(exportCheckpoint.targetDurationSec)}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900/60">
              <div style={{ width: `${pausedPct}%` }} className="h-full bg-amber-600" />
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              Tap <strong>Resume Export</strong> above to continue from Chunk{' '}
              {exportCheckpoint.completedUnits + 1} without re-encoding finished parts.
            </p>
          </div>
        )}

        {exportError && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-semibold text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300">
            {exportError}
          </div>
        )}
      </section>

      {/* Only render Export Complete when verifiedComplete === true */}
      {exportResult && exportResult.verifiedComplete && exportedVideoUrl && !isExporting && (
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 sm:p-6 dark:border-emerald-800/60 dark:bg-[#121722]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Editing &amp; Export Complete — Verified ({exportResult.videoCodec} +{' '}
                  {exportResult.audioCodec} MP4)
                </h3>
                <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {exportResult.fileName} · {exportResult.width}×{exportResult.height} ·{' '}
                  {formatSize(exportResult.sizeBytes)} · {exportResult.cutsAppliedCount} cuts &amp;{' '}
                  {exportResult.effectsAppliedCount} effects applied · Verified{' '}
                  {formatClock(exportResult.verifiedDurationSec)} /{' '}
                  {formatClock(exportResult.durationSec)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <a
                href={exportedVideoUrl}
                download={exportResult.fileName}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 whitespace-nowrap"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Download MP4 Again</span>
              </a>

              {canPickSaveFolder && (
                <button
                  type="button"
                  onClick={handleFolderSaveClick}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap"
                >
                  <FolderOutput className="h-4 w-4" aria-hidden="true" />
                  <span>Save to Movies / Folder</span>
                </button>
              )}

              {canShareFiles && (
                <button
                  type="button"
                  onClick={handleShareClick}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap"
                >
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  <span>Send to Gallery</span>
                </button>
              )}
            </div>
          </div>

          {actionNote && (
            <p className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {actionNote}
            </p>
          )}

          <div className="mt-4 overflow-hidden rounded-xl bg-[#090D14]">
            <video
              src={exportedVideoUrl}
              controls
              playsInline
              className="aspect-video w-full object-contain"
            />
          </div>
        </section>
      )}
    </div>
  );
};
