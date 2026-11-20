import React from 'react';
import { FolderOpen, RotateCcw, Trash2, CheckCircle2, PauseCircle } from 'lucide-react';
import { ProjectRecord } from '../types/hanuman';
import { formatClock } from './VideoPreviewStage';

interface ProjectsViewProps {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  storageInfo: { usedMb: number; quotaMb: number };
  onOpenProject: (project: ProjectRecord) => void;
  onResumeProject: (project: ProjectRecord) => void;
  onDeleteCache: (projectId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  activeProjectId,
  storageInfo,
  onOpenProject,
  onResumeProject,
  onDeleteCache,
}) => {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#121722]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Auto-Saved Offline Projects
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Every chunk checkpoint is saved automatically to on-device IndexedDB. Removing a project here clears only Hanuman AI&apos;s temporary cache—your original device video is never touched.
            </p>
          </div>
          <div className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
            Cache used: {storageInfo.usedMb} MB
            {storageInfo.quotaMb > 0 ? ` / ${Math.round(storageInfo.quotaMb)} MB` : ''}
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            No saved projects yet. Import a video in the Studio tab to start automatic offline editing.
          </div>
        ) : (
          <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800">
            {projects.map((proj) => {
              const isAnalysisInterrupted =
                proj.status === 'paused' ||
                (proj.status === 'analyzing' && proj.currentChunk < proj.totalChunks);
              const isExportInterrupted =
                proj.status === 'export_paused' ||
                proj.status === 'rendering' ||
                (!!proj.exportCheckpoint &&
                  proj.exportCheckpoint.completedUnits < proj.exportCheckpoint.totalUnits);
              const isInterrupted = isAnalysisInterrupted || isExportInterrupted;
              const isCurrent = proj.id === activeProjectId;

              return (
                <div
                  key={proj.id}
                  className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isInterrupted ? (
                        <PauseCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      )}
                      <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {proj.name}
                      </span>
                      {isCurrent && (
                        <span className="text-xs font-semibold text-[#E04F16]">· Active</span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      <span>{proj.width}×{proj.height}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatClock(proj.durationSec)}</span>
                      <span aria-hidden="true">·</span>
                      {isExportInterrupted && proj.exportCheckpoint ? (
                        <span>
                          Render {proj.exportCheckpoint.completedUnits}/
                          {proj.exportCheckpoint.totalUnits} chunks · Paused
                        </span>
                      ) : (
                        <>
                          <span>
                            Chunks {proj.currentChunk}/{proj.totalChunks}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {isAnalysisInterrupted
                              ? 'Paused / Interrupted'
                              : isExportInterrupted
                              ? 'Render Interrupted'
                              : proj.status === 'exported' && proj.exportResult?.verifiedComplete
                              ? 'Verified & Exported'
                              : 'Render Pending'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isInterrupted ? (
                      <button
                        type="button"
                        onClick={() => onResumeProject(proj)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#E04F16] px-4 text-xs font-semibold text-white hover:bg-[#C84310] whitespace-nowrap"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {isExportInterrupted && proj.exportCheckpoint
                            ? `Resume Render (${proj.exportCheckpoint.completedUnits}/${proj.exportCheckpoint.totalUnits})`
                            : isExportInterrupted
                            ? 'Resume Render'
                            : `Resume Chunk ${proj.currentChunk + 1}`}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenProject(proj)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 whitespace-nowrap"
                      >
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Open Project</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onDeleteCache(proj.id)}
                      aria-label={`Remove ${proj.name} from app cache`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:text-slate-300"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
