import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipForward,
  Volume2,
  VolumeX,
  EyeOff,
} from 'lucide-react';
import { AnalysisSummary, TimelineSegment } from '../types/hanuman';

interface VideoPreviewStageProps {
  videoUrl: string | null;
  renderedVideoUrl?: string | null;
  segments: TimelineSegment[];
  summary: AnalysisSummary | null;
  activeSegmentId: string | null;
  onSelectSegment: (seg: TimelineSegment) => void;
}

export function formatClock(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export const VideoPreviewStage: React.FC<VideoPreviewStageProps> = ({
  videoUrl,
  renderedVideoUrl,
  segments,
  summary,
  activeSegmentId,
  onSelectSegment,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewMode, setPreviewMode] = useState<'edited' | 'original'>('edited');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(summary?.durationSec ?? 0);

  const keptSegments = useMemo(
    () => segments.filter((s) => s.action === 'keep'),
    [segments]
  );

  // When a real rendered MP4 exists and user is in 'edited' mode, play the rendered MP4 directly!
  const playingRenderedMp4 = previewMode === 'edited' && !!renderedVideoUrl;
  const activeSrc = playingRenderedMp4 ? renderedVideoUrl : videoUrl;

  useEffect(() => {
    setDuration(
      playingRenderedMp4
        ? summary?.editedDurationSec ?? summary?.durationSec ?? 0
        : summary?.durationSec ?? 0
    );
    setCurrentTime(0);
    setIsPlaying(false);
  }, [playingRenderedMp4, summary?.durationSec, summary?.editedDurationSec]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const handleTimeUpdate = () => {
      const t = vid.currentTime;
      setCurrentTime(t);

      // When playing live timeline (before final MP4 finishes), skip cut segments & apply real-time speed
      if (previewMode === 'edited' && !playingRenderedMp4 && keptSegments.length > 0 && !vid.paused) {
        const currentKept = keptSegments.find(
          (k) => t >= k.startSec - 0.08 && t <= k.endSec - 0.04
        );
        if (!currentKept) {
          const nextKept = keptSegments.find((k) => k.startSec > t - 0.02);
          if (nextKept) {
            vid.currentTime = nextKept.startSec;
            vid.playbackRate = nextKept.effects?.speedFactor || 1;
          } else {
            vid.pause();
            setIsPlaying(false);
          }
        } else {
          const desiredRate = currentKept.effects?.speedFactor || 1;
          if (Math.abs(vid.playbackRate - desiredRate) > 0.05) {
            vid.playbackRate = desiredRate;
          }
        }
      } else if (previewMode === 'original' && vid.playbackRate !== 1) {
        vid.playbackRate = 1;
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleLoaded = () => {
      if (Number.isFinite(vid.duration) && vid.duration > 0) {
        setDuration(vid.duration);
      }
    };

    vid.addEventListener('timeupdate', handleTimeUpdate);
    vid.addEventListener('play', handlePlay);
    vid.addEventListener('pause', handlePause);
    vid.addEventListener('loadedmetadata', handleLoaded);

    return () => {
      vid.removeEventListener('timeupdate', handleTimeUpdate);
      vid.removeEventListener('play', handlePlay);
      vid.removeEventListener('pause', handlePause);
      vid.removeEventListener('loadedmetadata', handleLoaded);
    };
  }, [previewMode, playingRenderedMp4, keptSegments]);

  const togglePlay = async () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      if (previewMode === 'edited' && !playingRenderedMp4 && keptSegments.length > 0) {
        const inKept = keptSegments.some(
          (k) => vid.currentTime >= k.startSec && vid.currentTime < k.endSec - 0.05
        );
        if (!inKept) {
          const next = keptSegments.find((k) => k.startSec >= vid.currentTime) ?? keptSegments[0];
          vid.currentTime = next.startSec;
        }
      }
      await vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  };

  const jumpToNextKept = () => {
    const vid = videoRef.current;
    if (!vid || keptSegments.length === 0 || playingRenderedMp4) return;
    const next =
      keptSegments.find((k) => k.startSec > vid.currentTime + 0.1) ?? keptSegments[0];
    vid.currentTime = next.startSec;
    setCurrentTime(next.startSec);
    onSelectSegment(next);
  };

  const seekTo = (sec: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = sec;
    setCurrentTime(sec);
  };

  const toggleMute = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = !vid.muted;
    setIsMuted(vid.muted);
  };

  const currentSegment = useMemo(() => {
    if (playingRenderedMp4) return null;
    return segments.find((s) => currentTime >= s.startSec && currentTime <= s.endSec) ?? null;
  }, [playingRenderedMp4, segments, currentTime]);

  const liveVideoStyle = useMemo<React.CSSProperties>(() => {
    if (previewMode !== 'edited' || playingRenderedMp4 || !currentSegment) {
      return {};
    }
    const e = currentSegment.effects;
    if (!e) return {};
    let filter = '';
    if (e.colorGrade === 'cinematic_warm') filter = 'contrast(1.07) saturate(1.12) brightness(1.02) sepia(0.06)';
    else if (e.colorGrade === 'crisp_clarity') filter = 'contrast(1.11) saturate(1.06) brightness(1.06)';
    else if (e.colorGrade === 'vivid_punch') filter = 'contrast(1.13) saturate(1.20) brightness(1.03)';

    let transform = '';
    if (e.motionEffect === 'zoom_in') transform = 'scale(1.07)';
    else if (e.motionEffect === 'zoom_out') transform = 'scale(1.03)';
    else if (e.motionEffect === 'pan_drift') transform = 'scale(1.06) translateX(1.5%)';

    return { filter: filter || undefined, transform: transform || undefined };
  }, [previewMode, playingRenderedMp4, currentSegment]);

  const safeDuration = Math.max(0.1, duration || summary?.durationSec || 1);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#121722]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setPreviewMode('edited')}
            className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              previewMode === 'edited'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
            }`}
          >
            {renderedVideoUrl ? 'Rendered Edited MP4' : 'AI Edited Preview'}
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode('original')}
            className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              previewMode === 'original'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
            }`}
          >
            Original (Read-Only)
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <EyeOff className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          <span>Script text overlays disabled on video</span>
        </div>
      </div>

      {/* Pure Video Canvas — strictly zero script overlays */}
      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-[#090D14]">
        {activeSrc ? (
          <video
            key={activeSrc}
            ref={videoRef}
            src={activeSrc}
            playsInline
            style={liveVideoStyle}
            onClick={togglePlay}
            className="h-full w-full cursor-pointer object-contain transition-transform duration-500"
          />
        ) : (
          <div className="text-sm text-slate-400">No video loaded</div>
        )}
      </div>

      {/* Transport & Timeline Controls */}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#E04F16] px-4 text-white transition-colors hover:bg-[#C84310]"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Play className="h-5 w-5" aria-hidden="true" />
              )}
            </button>

            {!playingRenderedMp4 && (
              <button
                type="button"
                onClick={jumpToNextKept}
                title="Jump to next kept cut"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap"
              >
                <SkipForward className="h-4 w-4" aria-hidden="true" />
                <span>Next Cut</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-slate-600 tabular-nums dark:text-slate-300">
            <span>{formatClock(currentTime)}</span>
            <span aria-hidden="true">/</span>
            <span>{formatClock(safeDuration)}</span>
            {playingRenderedMp4 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Playing Verified Edited MP4
                </span>
              </>
            )}
            {currentSegment && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    currentSegment.action === 'keep'
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'font-semibold text-rose-600 dark:text-rose-400'
                  }
                >
                  {currentSegment.action === 'keep' ? 'Kept' : 'Auto-Cut'}: {currentSegment.label}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Audio Waveform + EDL Segment Bar (shown when inspecting timeline / original) */}
        {segments.length > 0 && !playingRenderedMp4 && (
          <div className="space-y-2 pt-1">
            {summary?.waveformBins && summary.waveformBins.length > 0 && (
              <div
                aria-hidden="true"
                className="flex h-10 items-end gap-[2px] rounded-lg bg-slate-100 px-2 py-1.5 dark:bg-slate-900"
              >
                {summary.waveformBins.map((amp, i) => {
                  const tAtBin = (i / summary.waveformBins.length) * safeDuration;
                  const seg = segments.find((s) => tAtBin >= s.startSec && tAtBin <= s.endSec);
                  const isCut = seg?.action === 'cut';
                  const isPlayed = tAtBin <= currentTime;
                  return (
                    <div
                      key={i}
                      style={{ height: `${Math.round(amp * 100)}%` }}
                      className={`flex-1 rounded-sm transition-opacity ${
                        isCut
                          ? 'bg-rose-400/50 dark:bg-rose-500/40'
                          : isPlayed
                          ? 'bg-[#E04F16]'
                          : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                    />
                  );
                })}
              </div>
            )}

            <div className="relative flex h-9 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
              {segments.map((seg) => {
                const widthPct = Math.max(1.5, (seg.durationSec / safeDuration) * 100);
                const isSelected = seg.id === activeSegmentId;
                const bgClass =
                  seg.action === 'keep'
                    ? seg.reason === 'highlight'
                      ? 'bg-[#E04F16] hover:bg-[#C84310]'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600';

                return (
                  <button
                    key={seg.id}
                    type="button"
                    style={{ width: `${widthPct}%` }}
                    title={`${seg.label} (${formatClock(seg.startSec)} – ${formatClock(seg.endSec)})`}
                    onClick={() => {
                      seekTo(seg.startSec);
                      onSelectSegment(seg);
                    }}
                    className={`h-full border-r border-white/30 transition-colors last:border-r-0 ${bgClass} ${
                      isSelected ? 'ring-2 ring-inset ring-white' : ''
                    }`}
                  />
                );
              })}

              <div
                aria-hidden="true"
                style={{
                  left: `${Math.min(100, Math.max(0, (currentTime / safeDuration) * 100))}%`,
                }}
                className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-slate-950 dark:bg-white"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex flex-wrap items-center gap-4">
                <span>Green: Kept Scenes</span>
                <span>Orange: Peak Highlights</span>
                <span>Gray: Auto-Removed Cuts</span>
              </div>
              <span className="tabular-nums">
                {keptSegments.length} kept · {segments.length - keptSegments.length} removed
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
