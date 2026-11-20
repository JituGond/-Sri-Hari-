import React, { useState } from 'react';
import { Copy, Check, Download, ShieldAlert, RefreshCw } from 'lucide-react';
import { BilingualScript, VideoCategory } from '../types/hanuman';
import { formatClock } from './VideoPreviewStage';

interface BilingualScriptStudioProps {
  script: BilingualScript;
  category: VideoCategory;
  onChangeCategory: (category: VideoCategory) => void;
  onRegenerate: () => void;
}

const CATEGORIES: Array<{ id: VideoCategory; label: string }> = [
  { id: 'auto_detect', label: 'Auto Detect' },
  { id: 'tutorial_screen', label: 'Tutorial / Screen' },
  { id: 'vlog_story', label: 'Vlog / Story' },
  { id: 'product_review', label: 'Product Review' },
  { id: 'educational', label: 'Educational' },
  { id: 'motivational_reel', label: 'Reel / Short' },
];

export const BilingualScriptStudio: React.FC<BilingualScriptStudioProps> = ({
  script,
  category,
  onChangeCategory,
  onRegenerate,
}) => {
  const [langView, setLangView] = useState<'both' | 'english' | 'hindi'>('both');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Fallback ignored if clipboard restricted
    }
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const buildSrt = (lang: 'en' | 'hi'): string => {
    return script.sceneBeats
      .map((beat, idx) => {
        const toSrtTime = (sec: number) => {
          const hrs = Math.floor(sec / 3600);
          const mins = Math.floor((sec % 3600) / 60);
          const secs = Math.floor(sec % 60);
          const ms = Math.floor((sec % 1) * 1000);
          return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
            secs
          ).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
        };
        const line = lang === 'en' ? beat.englishLine : beat.hindiLine;
        return `${idx + 1}\n${toSrtTime(beat.startSec)} --> ${toSrtTime(beat.endSec)}\n${line}\n`;
      })
      .join('\n');
  };

  return (
    <div className="space-y-6">
      {/* Explicit Script Isolation Guarantee */}
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5 dark:border-emerald-800/60 dark:bg-emerald-950/30">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Strict Video-Script Separation Enforced
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                These generated Hindi and English scripts stay completely separate from your video timeline and are never rendered or burned into exported video frames.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Controls Bar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121722]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  { id: 'both', label: 'Hindi + English' },
                  { id: 'english', label: 'English Only' },
                  { id: 'hindi', label: 'हिन्दी (Hindi)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLangView(opt.id)}
                  className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    langView === opt.id
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Refresh from Timeline</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopy('en', script.english.fullPlainText)}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              {copiedKey === 'en' ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{copiedKey === 'en' ? 'Copied English' : 'Copy English'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleCopy('hi', script.hindi.fullPlainText)}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              {copiedKey === 'hi' ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{copiedKey === 'hi' ? 'Copied Hindi' : 'Copy Hindi'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                downloadFile(
                  'HanumanAI_Bilingual_Script.txt',
                  `${script.english.fullPlainText}\n\n${'='.repeat(48)}\n\n${script.hindi.fullPlainText}`
                )
              }
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#E04F16] px-4 text-xs font-semibold text-white hover:bg-[#C84310] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export .TXT</span>
            </button>

            <button
              type="button"
              onClick={() => downloadFile('HanumanAI_English.srt', buildSrt('en'))}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>EN .SRT</span>
            </button>

            <button
              type="button"
              onClick={() => downloadFile('HanumanAI_Hindi.srt', buildSrt('hi'))}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>HI .SRT</span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <span className="mr-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Tone &amp; Format:
          </span>
          {CATEGORIES.map((cat) => {
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onChangeCategory(cat.id)}
                className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
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
      </section>

      {/* Script Columns */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          langView === 'both' ? 'lg:grid-cols-2' : ''
        }`}
      >
        {(langView === 'both' || langView === 'english') && (
          <article className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#121722]">
            <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                English Retention Script · Audio-Visual Grounded
              </div>
              <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {script.english.title}
              </h3>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[#E04F16]">
                01. Powerful Hook (0–5s)
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {script.english.hook}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[#E04F16]">
                02. Storytelling Flow
              </h4>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {script.english.storytelling}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[#E04F16]">
                03. Interesting Transitions
              </h4>
              <ul className="mt-1.5 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                {script.english.transitions.map((tr, i) => (
                  <li key={i} className="leading-relaxed">
                    {tr}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[#E04F16]">
                04. Engaging Ending &amp; Loop
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {script.english.ending}
              </p>
            </div>
          </article>
        )}

        {(langView === 'both' || langView === 'hindi') && (
          <article className="font-devanagari space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#121722]">
            <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                हिन्दी रिटेंशन स्क्रिप्ट · वास्तविक वीडियो दृश्यों पर आधारित
              </div>
              <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {script.hindi.title}
              </h3>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#E04F16]">
                01. दमदार हुक (शुरुआती 5 सेकंड)
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {script.hindi.hook}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#E04F16]">
                02. कहानी का प्रवाह (Storytelling)
              </h4>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {script.hindi.storytelling}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#E04F16]">
                03. आकर्षक ट्रांज़िशन (Transitions)
              </h4>
              <ul className="mt-1.5 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                {script.hindi.transitions.map((tr, i) => (
                  <li key={i} className="leading-relaxed">
                    {tr}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#E04F16]">
                04. प्रभावशाली अंत और रिटेंशन लूप
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                {script.hindi.ending}
              </p>
            </div>
          </article>
        )}
      </div>

      {/* Scene-by-Scene Voiceover Cue Sheet */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#121722]">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          05. Timestamped Scene Beats (Separate Teleprompter / Voiceover Reference)
        </h3>
        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {script.sceneBeats.map((beat) => (
            <div key={beat.id} className="grid grid-cols-1 gap-4 py-4 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <div className="font-mono text-xs font-semibold text-[#E04F16] tabular-nums">
                  {formatClock(beat.startSec)} – {formatClock(beat.endSec)}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {beat.visualCue}
                </div>
              </div>
              <div className="text-sm leading-relaxed text-slate-800 lg:col-span-4 dark:text-slate-200">
                {beat.englishLine}
              </div>
              <div className="font-devanagari text-sm leading-relaxed text-slate-800 lg:col-span-5 dark:text-slate-200">
                {beat.hindiLine}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
