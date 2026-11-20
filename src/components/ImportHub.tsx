import React, { useRef, useState } from 'react';
import {
  Film,
  MonitorPlay,
  FolderOpen,
  Video,
  Sparkles,
  RotateCcw,
  ShieldCheck,
  Cpu,
} from 'lucide-react';
import {
  EditPreset,
  ImportSource,
  ProjectRecord,
  VideoCategory,
} from '../types/hanuman';

interface ImportHubProps {
  preset: EditPreset;
  chunkDurationSec: number;
  category: VideoCategory;
  resumableProjects: ProjectRecord[];
  isGeneratingDemo: boolean;
  demoProgressLabel: string;
  onChangePreset: (preset: EditPreset) => void;
  onChangeChunkDuration: (sec: number) => void;
  onChangeCategory: (category: VideoCategory) => void;
  onImportFile: (file: File, source: ImportSource) => void;
  onGenerateSample: () => void;
  onResumeProject: (project: ProjectRecord) => void;
}

const PRESETS: Array<{ id: EditPreset; label: string; desc: string }> = [
  { id: 'balanced_smart', label: 'Balanced Smart Cut', desc: 'Removes silence, long pauses & repeats' },
  { id: 'aggressive_retention', label: 'High Retention', desc: 'Tighter jumps for Reels & Shorts' },
  { id: 'gentle_pause', label: 'Gentle Pause Trim', desc: 'Keeps natural rhythm, cuts dead air' },
  { id: 'highlight_reel', label: 'Highlight Reel', desc: 'Keeps peak action & speech moments' },
];

const CATEGORIES: Array<{ id: VideoCategory; label: string }> = [
  { id: 'auto_detect', label: 'Auto Detect' },
  { id: 'tutorial_screen', label: 'Tutorial / Screen' },
  { id: 'vlog_story', label: 'Vlog / Story' },
  { id: 'product_review', label: 'Product Review' },
  { id: 'educational', label: 'Educational' },
  { id: 'motivational_reel', label: 'Reel / Short' },
];

export const ImportHub: React.FC<ImportHubProps> = ({
  preset,
  chunkDurationSec,
  category,
  resumableProjects,
  isGeneratingDemo,
  demoProgressLabel,
  onChangePreset,
  onChangeChunkDuration,
  onChangeCategory,
  onImportFile,
  onGenerateSample,
  onResumeProject,
}) => {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const screenRecInputRef = useRef<HTMLInputElement>(null);
  const fileMgrInputRef = useRef<HTMLInputElement>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isRecordingScreen, setIsRecordingScreen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    source: ImportSource
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportFile(file, source);
    }
    e.target.value = '';
  };

  const handleOpenFileManager = async () => {
    const win = window as unknown as {
      showOpenFilePicker?: (opts: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
    };
    if (typeof win.showOpenFilePicker === 'function') {
      try {
        const handles = await win.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'Video Files',
              accept: {
                'video/*': ['.mp4', '.mkv', '.mov', '.webm', '.3gp', '.m4v'],
              },
            },
          ],
        });
        if (handles[0]) {
          const file = await handles[0].getFile();
          onImportFile(file, 'file_manager');
        }
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    fileMgrInputRef.current?.click();
  };

  const handleLiveScreenRecord = async () => {
    setCaptureError(null);
    if (isRecordingScreen && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingScreen(false);
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setCaptureError('Live screen capture is unavailable in this browser—select a recorded video file above instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });
      const mime =
        ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
          MediaRecorder.isTypeSupported(m)
        ) ?? 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecordingScreen(false);
        const blob = new Blob(chunks, { type: mime });
        if (blob.size > 0) {
          const file = new File(
            [blob],
            `Screen_Recording_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.webm`,
            { type: mime }
          );
          onImportFile(file, 'live_capture');
        }
      };

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      });

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecordingScreen(true);
    } catch {
      setCaptureError('Screen capture permission was cancelled or is unsupported on this device.');
    }
  };

  return (
    <div className="space-y-6">
      <input
        ref={galleryInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/3gpp,video/*"
        className="hidden"
        onChange={(e) => handleFileChange(e, 'gallery')}
      />
      <input
        ref={screenRecInputRef}
        type="file"
        accept="video/mp4,video/webm,video/x-matroska,video/*"
        className="hidden"
        onChange={(e) => handleFileChange(e, 'screen_recording')}
      />
      <input
        ref={fileMgrInputRef}
        type="file"
        accept="video/*,.mp4,.mkv,.mov,.webm,.3gp"
        className="hidden"
        onChange={(e) => handleFileChange(e, 'file_manager')}
      />

      {resumableProjects.length > 0 && (
        <section
          aria-label="Interrupted tasks ready to resume"
          className="rounded-2xl border border-amber-300/80 bg-amber-50/70 p-4 sm:p-5 dark:border-amber-700/60 dark:bg-amber-950/30"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Interrupted Task Ready to Resume
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                {resumableProjects[0].status === 'export_paused' && resumableProjects[0].exportCheckpoint
                  ? `${resumableProjects[0].name} · Export Chunk ${resumableProjects[0].exportCheckpoint.completedUnits} of ${resumableProjects[0].exportCheckpoint.totalUnits} saved`
                  : `${resumableProjects[0].name} · Chunk ${resumableProjects[0].currentChunk} of ${resumableProjects[0].totalChunks} saved in offline storage`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onResumeProject(resumableProjects[0])}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>
                {resumableProjects[0].status === 'export_paused' ? 'Resume Export' : 'Resume Processing'}
              </span>
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 dark:border-slate-800 dark:bg-[#121722]">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Android 10+ Offline Studio · 6 GB RAM Optimized · Non-Destructive Read-Only Import
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white [text-wrap:balance]">
            Import a video for automatic smart cutting and bilingual scripts
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Select a video from your Gallery, Screen Recordings, or File Manager. Hanuman AI analyzes audio and frames in chunks completely offline—your original video is never overwritten or deleted.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="group flex min-h-[120px] flex-col items-start justify-between rounded-2xl border border-slate-200 bg-slate-50/80 p-5 text-left transition-all hover:border-[#E04F16] hover:bg-orange-50/40 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-[#E04F16]"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#E04F16] shadow-sm dark:bg-slate-800">
              <Film className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="mt-4">
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                Gallery Videos
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Camera rolls, reels, MP4 &amp; MOV clips
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => screenRecInputRef.current?.click()}
            className="group flex min-h-[120px] flex-col items-start justify-between rounded-2xl border border-slate-200 bg-slate-50/80 p-5 text-left transition-all hover:border-[#E04F16] hover:bg-orange-50/40 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-[#E04F16]"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#E04F16] shadow-sm dark:bg-slate-800">
              <MonitorPlay className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="mt-4">
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                Screen Recording
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                App demos, gameplay &amp; tutorials
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={handleOpenFileManager}
            className="group flex min-h-[120px] flex-col items-start justify-between rounded-2xl border border-slate-200 bg-slate-50/80 p-5 text-left transition-all hover:border-[#E04F16] hover:bg-orange-50/40 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-[#E04F16]"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#E04F16] shadow-sm dark:bg-slate-800">
              <FolderOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="mt-4">
              <div className="text-base font-semibold text-slate-900 dark:text-white">
                File Manager
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Downloads, SD card, MKV &amp; long files
              </div>
            </div>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleLiveScreenRecord}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              isRecordingScreen
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <Video className="h-4 w-4" aria-hidden="true" />
            <span>{isRecordingScreen ? 'Stop Screen Capture & Edit' : 'Record Screen Now'}</span>
          </button>

          <button
            type="button"
            disabled={isGeneratingDemo}
            onClick={onGenerateSample}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-4 w-4 text-[#E04F16]" aria-hidden="true" />
            <span>
              {isGeneratingDemo ? demoProgressLabel || 'Generating Test Video...' : 'Generate 14s Multi-Scene Test Video'}
            </span>
          </button>
        </div>

        {captureError && (
          <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-400">
            {captureError}
          </p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-[#121722]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Automatic Smart-Cut Mode
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Zero manual editing required—select how aggressively Hanuman AI removes dead air and repeats.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {PRESETS.map((item) => {
              const active = preset === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangePreset(item.id)}
                  className={`flex min-h-[56px] flex-col items-start justify-center rounded-xl border px-4 py-3 text-left transition-colors ${
                    active
                      ? 'border-[#E04F16] bg-orange-50/70 dark:bg-orange-950/30'
                      : 'border-slate-200 bg-slate-50/60 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/50'
                  }`}
                >
                  <span
                    className={`text-sm font-semibold ${
                      active ? 'text-[#E04F16]' : 'text-slate-900 dark:text-white'
                    }`}
                  >
                    {item.label}
                  </span>
                  <span className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {item.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-[#121722]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Bilingual Script Style &amp; 6 GB RAM Chunks
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Scripts are generated in Hindi and English completely separate from exported video frames.
          </p>

          <div className="mt-4">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Script Narrative Style
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => {
                const active = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => onChangeCategory(cat.id)}
                    className={`min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Chunk Size (Long Video Memory Guard)
              </span>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {chunkDurationSec}s / chunk
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[10, 20, 30].map((sec) => {
                const active = chunkDurationSec === sec;
                return (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => onChangeChunkDuration(sec)}
                    className={`min-h-[40px] rounded-lg border text-xs font-semibold tabular-nums transition-colors ${
                      active
                        ? 'border-[#E04F16] bg-orange-50/70 text-[#E04F16] dark:bg-orange-950/30'
                        : 'border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {sec}s Chunks
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Original video untouched
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
              160x90 bounded frame buffer
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
