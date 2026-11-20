import React, { useState } from 'react';
import { Scissors, Check, X, RotateCcw, Sparkles } from 'lucide-react';
import { AnalysisSummary, EditPreset, TimelineSegment } from '../types/hanuman';
import { formatClock } from './VideoPreviewStage';

interface SmartEdlPanelProps {
  segments: TimelineSegment[];
  summary: AnalysisSummary;
  preset: EditPreset;
  activeSegmentId: string | null;
  needsReRender: boolean;
  onChangePreset: (preset: EditPreset) => void;
  onToggleSegment: (segmentId: string) => void;
  onSelectSegment: (segment: TimelineSegment) => void;
  onResetOverrides: () => void;
  onRenderEditedVideo: () => void;
}

const PRESET_BUTTONS: Array<{ id: EditPreset; label: string }> = [
  { id: 'balanced_smart', label: 'Balanced Smart' },
  { id: 'aggressive_retention', label: 'High Retention' },
  { id: 'gentle_pause', label: 'Gentle Trim' },
  { id: 'highlight_reel', label: 'Highlight Reel' },
];

function formatEffectSummary(seg: TimelineSegment): string {
  if (seg.action !== 'keep' || !seg.effects) return '';
  const parts: string[] = [];
  if (seg.effects.speedFactor < 0.95) parts.push(`Slow-Mo ${seg.effects.speedFactor}x`);
  else if (seg.effects.speedFactor > 1.05) parts.push(`Speed ${seg.effects.speedFactor}x`);
  if (seg.effects.motionEffect === 'zoom_in') parts.push('Zoom In');
  else if (seg.effects.motionEffect === 'zoom_out') parts.push('Zoom Out');
  else if (seg.effects.motionEffect === 'pan_drift') parts.push('Cinema Pan');
  if (seg.effects.colorGrade === 'cinematic_warm') parts.push('Warm Grade');
  else if (seg.effects.colorGrade === 'crisp_clarity') parts.push('Crisp Grade');
  else if (seg.effects.colorGrade === 'vivid_punch') parts.push('Vivid Grade');
  if (seg.effects.transitionIn === 'crossfade') parts.push('Crossfade');
  else if (seg.effects.transitionIn === 'zoom_push') parts.push('Zoom Push');
  else if (seg.effects.transitionIn === 'dip_black') parts.push('Fade In');
  return parts.join(' · ');
}

export const SmartEdlPanel: React.FC<SmartEdlPanelProps> = ({
  segments,
  summary,
  preset,
  activeSegmentId,
  needsReRender,
  onChangePreset,
  onToggleSegment,
  onSelectSegment,
  onResetOverrides,
  onRenderEditedVideo,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'cuts' | 'kept'>('all');

  const filtered = segments.filter((s) => {
    if (filterMode === 'cuts') return s.action === 'cut';
    if (filterMode === 'kept') return s.action === 'keep';
    return true;
  });

  const hasOverrides = segments.some((s) => s.userOverride);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-4 dark:border-slate-800 dark:bg-[#121722]">
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Edited Duration
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {formatClock(summary.editedDurationSec)}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
            from {formatClock(summary.durationSec)} original
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Dead Air Removed
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-[#E04F16] tabular-nums">
            -{Math.round(summary.savedPercent)}%
          </div>
          <div className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {summary.timeSavedSec.toFixed(1)}s trimmed automatically
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Auto Detections
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {summary.silentCount + summary.pauseCount + summary.repeatedCount + summary.unnecessaryCount}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {summary.silentCount} silent · {summary.pauseCount} pauses · {summary.repeatedCount} repeats
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Visual &amp; Audio Scan
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-white">
            {summary.totalFramesSampled} frames
          </div>
          <div className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
            {summary.sceneCutCount} scene cuts · {summary.unnecessaryCount} filler scenes
          </div>
        </div>
      </section>

      {needsReRender && (
        <section className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50/80 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700/60 dark:bg-amber-950/30">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Timeline Updated — Render Required
            </h3>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
              Cuts and effects have changed. Render the MP4 output so changes are applied to the final video.
            </p>
          </div>
          <button
            type="button"
            onClick={onRenderEditedVideo}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E04F16] px-4 text-xs font-semibold text-white hover:bg-[#C84310] whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span>Render Edited MP4</span>
          </button>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121722]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Editing Timeline, Approved Cuts &amp; Scene Effects
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Every scene receives automatic transitions, zoom/motion, slow-mo/speed, and color grading before rendering.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {PRESET_BUTTONS.map((btn) => {
              const active = preset === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => onChangePreset(btn.id)}
                  className={`min-h-[40px] rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#E04F16] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                { id: 'all', label: `All (${segments.length})` },
                { id: 'cuts', label: `Removed (${segments.filter((s) => s.action === 'cut').length})` },
                { id: 'kept', label: `Kept (${segments.filter((s) => s.action === 'keep').length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filterMode === tab.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {hasOverrides && (
            <button
              type="button"
              onClick={onResetOverrides}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset AI Decisions</span>
            </button>
          )}
        </div>

        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map((seg) => {
            const isSelected = seg.id === activeSegmentId;
            const isKept = seg.action === 'keep';
            const effectText = formatEffectSummary(seg);

            return (
              <div
                key={seg.id}
                className={`flex min-h-[68px] flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
                  isSelected ? 'bg-orange-50/40 px-2 rounded-xl dark:bg-orange-950/20' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSegment(seg)}
                  className="flex flex-1 items-start gap-3 text-left"
                >
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      isKept
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                    }`}
                  >
                    {isKept ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Scissors className="h-4 w-4" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <span>{seg.label}</span>
                      {seg.userOverride && (
                        <span className="text-xs font-medium text-[#E04F16]">· Manual Override</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      <span>
                        {formatClock(seg.startSec)} – {formatClock(seg.endSec)} ({seg.durationSec.toFixed(1)}s)
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Audio {seg.avgAudioDb.toFixed(0)} dB</span>
                      <span aria-hidden="true">·</span>
                      <span>Motion {(seg.motionScore * 100).toFixed(1)}%</span>
                      {seg.reason === 'repeated_clip' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Match {(seg.hashSimilarity * 100).toFixed(0)}%</span>
                        </>
                      )}
                    </div>
                    {isKept && effectText && (
                      <div className="mt-1 text-xs font-medium text-[#E04F16]">
                        Effects: {effectText}
                      </div>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onToggleSegment(seg.id)}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-4 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    isKept
                      ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                      : 'border-emerald-600/30 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
                  }`}
                >
                  {isKept ? (
                    <>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Cut Segment</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Restore Segment</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
