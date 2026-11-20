import React, { useState } from 'react';
import JSZip from 'jszip';
import { Download, CheckCircle2, Wrench, FileCode2 } from 'lucide-react';
import { ANDROID_PROJECT_FILES } from '../androidSource/androidProjectTemplate';
import { PWAInstallButton } from './PWAInstallButton';

export const AndroidNativeView: React.FC = () => {
  const [selectedPath, setSelectedPath] = useState(ANDROID_PROJECT_FILES[0].path);
  const [isZipping, setIsZipping] = useState(false);

  const selectedFile =
    ANDROID_PROJECT_FILES.find((f) => f.path === selectedPath) ?? ANDROID_PROJECT_FILES[0];

  const handleDownloadAndroidZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (const file of ANDROID_PROJECT_FILES) {
        zip.file(file.path, file.content);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'HanumanAI-Android-Studio.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#121722]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Android 10+ (API 29–35) · PWA + Native Kotlin Studio Source
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">
              Android Deployment &amp; Implementation Status
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
              Install Hanuman AI immediately on Android 10+ as an offline PWA, or export the included Kotlin + Jetpack Compose + Media3 Transformer project for Android Studio APK compilation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              disabled={isZipping}
              onClick={handleDownloadAndroidZip}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E04F16] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#C84310] disabled:opacity-60 whitespace-nowrap"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>{isZipping ? 'Packaging ZIP...' : 'Download Android Studio ZIP'}</span>
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-800/50 dark:bg-emerald-950/20">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <span>Implemented &amp; Running Live Offline Now</span>
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              <li>• Gallery, Screen Recording (+ live screen capture), and File Manager read-only import.</li>
              <li>• Real chunk-based video/audio analyzer: 160×90 bounded frame sampling (~57 KB/frame for 6 GB RAM safety), Web Audio RMS dB + ZCR speech energy, 64-bit dHash duplicate clip detection, and histogram scene-cut detection.</li>
              <li>• Automatic smart cutting removing silent sections, long pauses, repeated clips, and unnecessary static scenes.</li>
              <li>• Offline Hindi (Devanagari) &amp; English script generation grounded in scene timestamps, strictly isolated from video overlays.</li>
              <li>• Balanced Auto Quality video export preserving source resolution and keeping original files untouched.</li>
              <li>• Auto-save checkpoints in IndexedDB with Pause &amp; Resume for interrupted long-video tasks + offline PWA Service Worker.</li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Wrench className="h-4 w-4 text-[#E04F16]" aria-hidden="true" />
              <span>Requires Native Android Studio Build / Weights</span>
            </div>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <li>• Compiling the signed `.apk` / `.aab` binary requires Android Studio + Gradle (API 29–35) using the downloadable Kotlin source below.</li>
              <li>• Hardware zero-reencode H.264/H.265 keyframe pass-through (`Media3 Transformer`) runs in native Android rather than browser `MediaRecorder`.</li>
              <li>• Full neural speech-to-text transcription (`Whisper-tiny.tflite`) and local LLM rewriting (`Qwen2.5-1.5B-Q4.gguf`) require bundling ~400–900 MB quantized model weights into `app/src/main/assets/models/` in the native APK (current live web runtime uses deterministic acoustic/visual signal synthesis so it runs instantly offline with zero large model downloads).</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Native Kotlin Source Explorer */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#121722]">
        <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <FileCode2 className="h-4 w-4 text-[#E04F16]" aria-hidden="true" />
            <span>Included Native Android Kotlin &amp; Jetpack Compose Source</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          <div className="border-b border-slate-200 bg-slate-50/70 p-3 lg:col-span-4 lg:border-r lg:border-b-0 dark:border-slate-800 dark:bg-slate-900/50">
            <div className="space-y-1">
              {ANDROID_PROJECT_FILES.map((file) => {
                const active = file.path === selectedFile.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`flex min-h-[44px] w-full flex-col items-start justify-center rounded-xl px-3 py-2 text-left transition-colors ${
                      active
                        ? 'bg-white text-[#E04F16] shadow-sm dark:bg-slate-800'
                        : 'text-slate-700 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="w-full truncate font-mono text-xs font-semibold">
                      {file.path}
                    </span>
                    <span className="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {file.summary}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="border-b border-slate-100 px-4 py-2.5 font-mono text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {selectedFile.path} — {selectedFile.summary}
            </div>
            <pre className="max-h-[460px] overflow-auto bg-[#0B0E14] p-4 font-mono text-xs leading-relaxed text-slate-200">
              <code>{selectedFile.content}</code>
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
