import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause,
  Play,
  Sun,
  Moon,
  Scissors,
  FileText,
  Download,
  Plus,
  CheckCircle2,
  Cpu,
  Clock,
  Sparkles,
} from 'lucide-react';
import {
  ChunkCheckpoint,
  EditPreset,
  ImportSource,
  ProjectRecord,
  RawSampleWindow,
  TimelineSegment,
  VideoCategory,
} from './types/hanuman';
import {
  clearExportUnits,
  deleteProjectCache,
  estimateStorageUsage,
  getExportBlob,
  getMediaBlob,
  listProjects,
  saveExportBlob,
  saveMediaBlob,
  saveProject,
} from './engine/projectStore';
import {
  analyzeVideoInChunks,
  assignSceneEditingEffects,
  buildEdlFromWindows,
  ChunkProgressEvent,
  computeSummaryFromSegments,
  probeVideoMetadata,
  VideoMetadataInfo,
} from './engine/videoAnalyzer';
import { generateOfflineBilingualScript } from './engine/scriptGenerator';
import {
  exportEditedVideo,
  ExportProgressEvent,
  triggerPermanentDeviceDownload,
} from './engine/videoExporter';
import { generateSampleVideoFile } from './engine/sampleVideoGenerator';
import { TopBar, AppTab } from './components/TopBar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ImportHub } from './components/ImportHub';
import { VideoPreviewStage, formatClock } from './components/VideoPreviewStage';
import { SmartEdlPanel } from './components/SmartEdlPanel';
import { BilingualScriptStudio } from './components/BilingualScriptStudio';
import { ExportStudio } from './components/ExportStudio';
import { ProjectsView } from './components/ProjectsView';
import { AndroidNativeView } from './components/AndroidNativeView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('studio');
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('hanuman_theme') === 'dark';
  });

  const [preset, setPreset] = useState<EditPreset>('balanced_smart');
  const [chunkDurationSec, setChunkDurationSec] = useState<number>(20);
  const [category, setCategory] = useState<VideoCategory>('auto_detect');

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [storageInfo, setStorageInfo] = useState<{ usedMb: number; quotaMb: number }>({
    usedMb: 0,
    quotaMb: 0,
  });

  const [activeProject, setActiveProject] = useState<ProjectRecord | null>(null);
  const [showImportHub, setShowImportHub] = useState<boolean>(true);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);

  const [isGeneratingDemo, setIsGeneratingDemo] = useState(false);
  const [demoProgressLabel, setDemoProgressLabel] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<ChunkProgressEvent | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  // Sync dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('hanuman_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const refreshProjects = useCallback(async () => {
    try {
      const [all, est] = await Promise.all([listProjects(), estimateStorageUsage()]);
      setProjects(all);
      setStorageInfo(est);
    } catch {
      // Ignore IndexedDB restricted contexts
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      if (exportedVideoUrl) URL.revokeObjectURL(exportedVideoUrl);
    };
  }, [exportedVideoUrl]);

  const attachProjectMediaUrls = useCallback(async (projectId: string, fallbackBlob?: Blob) => {
    const mediaBlob = fallbackBlob ?? (await getMediaBlob(projectId));
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return mediaBlob ? URL.createObjectURL(mediaBlob) : null;
    });

    const expBlob = await getExportBlob(projectId);
    setExportedVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return expBlob ? URL.createObjectURL(expBlob) : null;
    });
  }, []);

  const runExportPipeline = useCallback(
    async (projectRecord: ProjectRecord, mediaBlob: Blob) => {
      exportAbortRef.current?.abort();
      const controller = new AbortController();
      exportAbortRef.current = controller;

      setIsExporting(true);
      setExportError(null);
      setExportProgress(null);

      let latestProject: ProjectRecord = {
        ...projectRecord,
        status: 'rendering',
        updatedAt: Date.now(),
      };
      setActiveProject(latestProject);
      await saveProject(latestProject).catch(() => {});

      try {
        const { blob, result } = await exportEditedVideo({
          projectId: latestProject.id,
          sourceBlob: mediaBlob,
          sourceFileName: latestProject.fileName,
          srcWidth: latestProject.width,
          srcHeight: latestProject.height,
          segments: latestProject.segments,
          existingCheckpoint: latestProject.exportCheckpoint,
          signal: controller.signal,
          onProgress: (ev) => setExportProgress(ev),
          onCheckpoint: async (checkpoint) => {
            latestProject = {
              ...latestProject,
              status: 'rendering',
              exportCheckpoint: checkpoint,
              updatedAt: Date.now(),
            };
            setActiveProject(latestProject);
            await saveProject(latestProject).catch(() => {});
          },
        });

        if (!result.verifiedComplete) {
          throw new Error('Rendered MP4 failed full-duration integrity verification.');
        }

        await saveExportBlob(latestProject.id, blob).catch(() => {});
        setExportedVideoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });

        // Automatically save the verified complete HD MP4 permanently to the device
        triggerPermanentDeviceDownload(blob, result.fileName);

        const completedExport: ProjectRecord = {
          ...latestProject,
          status: 'exported',
          exportCheckpoint: null,
          exportResult: result,
          updatedAt: Date.now(),
        };
        setActiveProject(completedExport);
        await saveProject(completedExport).catch(() => {});
        await refreshProjects();
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          const paused: ProjectRecord = {
            ...latestProject,
            status: 'export_paused',
            updatedAt: Date.now(),
          };
          setActiveProject(paused);
          await saveProject(paused).catch(() => {});
          await refreshProjects();
        } else {
          const reverted: ProjectRecord = {
            ...latestProject,
            status: 'edited',
            updatedAt: Date.now(),
          };
          setActiveProject(reverted);
          await saveProject(reverted).catch(() => {});
          setExportError((err as Error)?.message || 'Video rendering/export failed');
        }
      } finally {
        setIsExporting(false);
      }
    },
    [refreshProjects]
  );

  const runChunkedPipeline = useCallback(
    async (
      project: ProjectRecord,
      blob: Blob,
      meta: VideoMetadataInfo,
      startChunkIndex: number,
      existingCheckpoints: ChunkCheckpoint[],
      existingWindows: RawSampleWindow[]
    ) => {
      analysisAbortRef.current?.abort();
      const controller = new AbortController();
      analysisAbortRef.current = controller;

      setIsAnalyzing(true);
      setAnalysisError(null);
      setExportError(null);
      setShowImportHub(false);
      setActiveTab('studio');

      let latestProject: ProjectRecord = {
        ...project,
        status: 'analyzing',
      };
      setActiveProject(latestProject);
      await saveProject(latestProject).catch(() => {});

      try {
        const result = await analyzeVideoInChunks({
          file: blob,
          meta,
          chunkDurationSec: project.chunkDurationSec,
          startChunkIndex,
          existingCheckpoints,
          existingWindows,
          signal: controller.signal,
          onProgress: (ev) => {
            setAnalysisProgress(ev);
          },
          onChunkComplete: async (checkpoint, allCheckpoints, allWindows) => {
            latestProject = {
              ...latestProject,
              currentChunk: checkpoint.chunkIndex + 1,
              totalChunks: checkpoint.totalChunks,
              checkpoints: allCheckpoints,
              rawWindows: allWindows,
              updatedAt: Date.now(),
            };
            setActiveProject(latestProject);
            await saveProject(latestProject).catch(() => {});
            await refreshProjects();
          },
        });

        const { segments, summary } = buildEdlFromWindows(
          result.windows,
          meta,
          latestProject.preset
        );
        const script = generateOfflineBilingualScript(
          summary,
          segments,
          latestProject.category
        );

        await clearExportUnits(latestProject.id).catch(() => {});

        const preparedForRender: ProjectRecord = {
          ...latestProject,
          status: 'rendering',
          currentChunk: result.checkpoints.length,
          totalChunks: Math.max(1, result.checkpoints.length),
          checkpoints: result.checkpoints,
          rawWindows: result.windows,
          segments,
          summary,
          script,
          exportCheckpoint: null,
          exportResult: null,
          updatedAt: Date.now(),
        };

        setIsAnalyzing(false);
        setActiveProject(preparedForRender);
        await saveProject(preparedForRender).catch(() => {});
        await refreshProjects();

        // Automatically execute real deep rendering (cuts, transitions, zoom/motion, speed/slow-mo, color grade)
        await runExportPipeline(preparedForRender, blob);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          const pausedProject: ProjectRecord = {
            ...latestProject,
            status: 'paused',
            updatedAt: Date.now(),
          };
          setActiveProject(pausedProject);
          await saveProject(pausedProject).catch(() => {});
          await refreshProjects();
        } else {
          setAnalysisError((err as Error)?.message || 'Video analysis failed');
        }
      } finally {
        setIsAnalyzing(false);
      }
    },
    [refreshProjects, runExportPipeline]
  );

  const handleImportFile = useCallback(
    async (file: File, source: ImportSource) => {
      setAnalysisError(null);
      setExportError(null);
      try {
        const meta = await probeVideoMetadata(file, file.name);
        const totalChunks = Math.max(1, Math.ceil(meta.durationSec / chunkDurationSec));
        const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const newProject: ProjectRecord = {
          id: projectId,
          name: file.name.replace(/\.[^.]+$/, '') || 'Untitled Video',
          sourceType: source,
          status: 'imported',
          preset,
          category,
          chunkDurationSec,
          currentChunk: 0,
          totalChunks,
          checkpoints: [],
          rawWindows: [],
          segments: [],
          summary: null,
          script: null,
          exportResult: null,
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: meta.mimeType,
          durationSec: meta.durationSec,
          width: meta.width,
          height: meta.height,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        await saveMediaBlob(projectId, file).catch(() => {});
        await saveProject(newProject).catch(() => {});
        await attachProjectMediaUrls(projectId, file);
        await refreshProjects();

        await runChunkedPipeline(newProject, file, meta, 0, [], []);
      } catch (err) {
        setAnalysisError((err as Error)?.message || 'Could not import selected video');
      }
    },
    [attachProjectMediaUrls, category, chunkDurationSec, preset, refreshProjects, runChunkedPipeline]
  );

  const handleGenerateSample = useCallback(async () => {
    setIsGeneratingDemo(true);
    setDemoProgressLabel('Synthesizing 14s test video...');
    try {
      const sampleFile = await generateSampleVideoFile((_, label) => {
        setDemoProgressLabel(label);
      });
      await handleImportFile(sampleFile, 'demo_fixture');
    } catch (err) {
      setAnalysisError((err as Error)?.message || 'Failed to synthesize sample clip');
    } finally {
      setIsGeneratingDemo(false);
      setDemoProgressLabel('');
    }
  }, [handleImportFile]);

  const handlePauseAnalysis = () => {
    analysisAbortRef.current?.abort();
  };

  const handleResumeProject = useCallback(
    async (project: ProjectRecord) => {
      const blob = await getMediaBlob(project.id);
      if (!blob) {
        setAnalysisError('Cached read-only video for this task is unavailable—please re-import the video.');
        return;
      }

      await attachProjectMediaUrls(project.id, blob);

      if (
        project.status === 'export_paused' ||
        project.status === 'rendering' ||
        (project.exportCheckpoint &&
          project.exportCheckpoint.completedUnits < project.exportCheckpoint.totalUnits)
      ) {
        setActiveProject(project);
        setPreset(project.preset);
        setCategory(project.category);
        setShowImportHub(false);
        setActiveTab('export');
        return;
      }

      const meta: VideoMetadataInfo = {
        durationSec: project.durationSec,
        width: project.width,
        height: project.height,
        fileName: project.fileName,
        fileSizeBytes: project.fileSizeBytes,
        mimeType: project.mimeType,
      };

      await runChunkedPipeline(
        project,
        blob,
        meta,
        project.currentChunk,
        project.checkpoints ?? [],
        project.rawWindows ?? []
      );
    },
    [attachProjectMediaUrls, runChunkedPipeline]
  );

  const handleOpenProject = useCallback(
    async (project: ProjectRecord) => {
      await attachProjectMediaUrls(project.id);
      setActiveProject(project);
      setPreset(project.preset);
      setCategory(project.category);
      setShowImportHub(false);
      setActiveTab('studio');
    },
    [attachProjectMediaUrls]
  );

  const handleDeleteCache = useCallback(
    async (projectId: string) => {
      await deleteProjectCache(projectId);
      if (activeProject?.id === projectId) {
        setActiveProject(null);
        setShowImportHub(true);
        setVideoUrl(null);
        setExportedVideoUrl(null);
      }
      await refreshProjects();
    },
    [activeProject?.id, refreshProjects]
  );

  const handleChangeProjectPreset = useCallback(
    async (newPreset: EditPreset) => {
      setPreset(newPreset);
      if (!activeProject || !activeProject.rawWindows || activeProject.rawWindows.length === 0) return;

      const meta: VideoMetadataInfo = {
        durationSec: activeProject.durationSec,
        width: activeProject.width,
        height: activeProject.height,
        fileName: activeProject.fileName,
        fileSizeBytes: activeProject.fileSizeBytes,
        mimeType: activeProject.mimeType,
      };
      const { segments, summary } = buildEdlFromWindows(
        activeProject.rawWindows,
        meta,
        newPreset
      );
      const script = generateOfflineBilingualScript(
        summary,
        segments,
        activeProject.category
      );

      await clearExportUnits(activeProject.id).catch(() => {});
      setExportedVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });

      const updated: ProjectRecord = {
        ...activeProject,
        status: 'edited',
        preset: newPreset,
        segments,
        summary,
        script,
        exportCheckpoint: null,
        exportResult: null,
        updatedAt: Date.now(),
      };
      setActiveProject(updated);
      await saveProject(updated).catch(() => {});
      await refreshProjects();
    },
    [activeProject, refreshProjects]
  );

  const handleToggleSegment = useCallback(
    async (segmentId: string) => {
      if (!activeProject || !activeProject.rawWindows) return;

      const updatedSegments: TimelineSegment[] = activeProject.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        const nextAction = seg.action === 'keep' ? 'cut' : 'keep';
        return {
          ...seg,
          action: nextAction,
          userOverride: true,
        };
      });

      const noiseFloorDb = activeProject.summary?.audioProfile.noiseFloorDb ?? -48;
      assignSceneEditingEffects(updatedSegments, activeProject.preset, noiseFloorDb);

      const meta: VideoMetadataInfo = {
        durationSec: activeProject.durationSec,
        width: activeProject.width,
        height: activeProject.height,
        fileName: activeProject.fileName,
        fileSizeBytes: activeProject.fileSizeBytes,
        mimeType: activeProject.mimeType,
      };
      const summary = computeSummaryFromSegments(
        updatedSegments,
        activeProject.rawWindows,
        meta,
        noiseFloorDb
      );
      const script = generateOfflineBilingualScript(
        summary,
        updatedSegments,
        activeProject.category
      );

      await clearExportUnits(activeProject.id).catch(() => {});
      setExportedVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });

      const updated: ProjectRecord = {
        ...activeProject,
        status: 'edited',
        segments: updatedSegments,
        summary,
        script,
        exportCheckpoint: null,
        exportResult: null,
        updatedAt: Date.now(),
      };
      setActiveProject(updated);
      await saveProject(updated).catch(() => {});
      await refreshProjects();
    },
    [activeProject, refreshProjects]
  );

  const handleChangeScriptCategory = useCallback(
    async (newCategory: VideoCategory) => {
      setCategory(newCategory);
      if (!activeProject || !activeProject.summary) return;
      const script = generateOfflineBilingualScript(
        activeProject.summary,
        activeProject.segments,
        newCategory
      );
      const updated: ProjectRecord = {
        ...activeProject,
        category: newCategory,
        script,
        updatedAt: Date.now(),
      };
      setActiveProject(updated);
      await saveProject(updated).catch(() => {});
    },
    [activeProject]
  );

  const handleStartExport = useCallback(async () => {
    if (!activeProject) return;
    const mediaBlob = await getMediaBlob(activeProject.id);
    if (!mediaBlob) {
      setExportError('Original cached video blob not found. Please re-import the file.');
      return;
    }
    await runExportPipeline(activeProject, mediaBlob);
  }, [activeProject, runExportPipeline]);

  const handleResetExport = useCallback(async () => {
    if (!activeProject) return;
    await clearExportUnits(activeProject.id).catch(() => {});
    const resetProj: ProjectRecord = {
      ...activeProject,
      status: 'edited',
      exportCheckpoint: null,
      updatedAt: Date.now(),
    };
    setActiveProject(resetProj);
    setExportError(null);
    setExportProgress(null);
    await saveProject(resetProj).catch(() => {});
    await refreshProjects();
  }, [activeProject, refreshProjects]);

  const handleSaveToGalleryFolder = useCallback(async () => {
    if (!activeProject?.exportResult) return;
    const blob = await getExportBlob(activeProject.id);
    if (!blob) throw new Error('Exported MP4 data not found');

    const picker = (
      window as unknown as {
        showSaveFilePicker?: (opts: unknown) => Promise<{
          createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
        }>;
      }
    ).showSaveFilePicker;

    if (!picker) {
      triggerPermanentDeviceDownload(blob, activeProject.exportResult.fileName);
      return;
    }

    const handle = await picker({
      suggestedName: activeProject.exportResult.fileName,
      types: [
        {
          description: 'MP4 Video (H.264 + AAC)',
          accept: { 'video/mp4': ['.mp4'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }, [activeProject]);

  const handleShareMp4 = useCallback(async () => {
    if (!activeProject?.exportResult) return;
    const blob = await getExportBlob(activeProject.id);
    if (!blob) throw new Error('Exported MP4 data not found');

    const mp4File = new File([blob], activeProject.exportResult.fileName, {
      type: 'video/mp4',
    });

    if (navigator.canShare && !navigator.canShare({ files: [mp4File] })) {
      throw new Error('File sharing is unsupported');
    }

    await navigator.share({
      title: activeProject.exportResult.fileName,
      files: [mp4File],
    });
  }, [activeProject]);

  const resumableProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          p.status === 'paused' ||
          p.status === 'export_paused' ||
          p.status === 'rendering' ||
          (p.status === 'analyzing' && p.currentChunk < p.totalChunks) ||
          (!!p.exportCheckpoint && p.exportCheckpoint.completedUnits < p.exportCheckpoint.totalUnits)
      ),
    [projects]
  );

  const handleQuickImport = () => {
    setShowImportHub(true);
    setActiveTab('studio');
  };

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-900 dark:bg-[#0B0E14] dark:text-slate-100">
      <TopBar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'studio') setShowImportHub(false);
        }}
        onQuickImport={handleQuickImport}
      />

      <main className="mx-auto max-w-7xl px-4 pt-5 pb-24 sm:px-6 md:pb-12">
        {/* Compact Utility Toolbar (outside <header> to keep Top Bar strictly 3-zone) */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Cpu className="h-4 w-4 text-[#E04F16]" aria-hidden="true" />
            <span>Offline Processing Engine</span>
            {activeProject && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {activeProject.name}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {activeProject.width}×{activeProject.height}
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeProject && !showImportHub && activeTab === 'studio' && (
              <button
                type="button"
                onClick={() => setShowImportHub(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>New Import</span>
              </button>
            )}

            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {isDark ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Live Chunked Analysis Progress / Pause Banner */}
        {(isAnalyzing || activeProject?.status === 'paused') && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121722]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {isAnalyzing
                    ? analysisProgress?.stageLabel || 'Running chunked AI analysis...'
                    : `Task Paused at Chunk ${activeProject?.currentChunk} / ${activeProject?.totalChunks}`}
                </h2>
                <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {isAnalyzing && analysisProgress
                    ? `${analysisProgress.percent}% · Time ${formatClock(
                        analysisProgress.currentTimeSec
                      )} · Heap ~${analysisProgress.ramEstimateMb} MB (6 GB RAM Safe)`
                    : 'Progress saved automatically to IndexedDB—tap Resume anytime.'}
                </p>
              </div>

              {isAnalyzing ? (
                <button
                  type="button"
                  onClick={handlePauseAnalysis}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 whitespace-nowrap shrink-0"
                >
                  <Pause className="h-4 w-4" aria-hidden="true" />
                  <span>Pause &amp; Save Checkpoint</span>
                </button>
              ) : (
                activeProject && (
                  <button
                    type="button"
                    onClick={() => handleResumeProject(activeProject)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E04F16] px-4 text-xs font-semibold text-white hover:bg-[#C84310] whitespace-nowrap shrink-0"
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    <span>Resume Analysis</span>
                  </button>
                )
              )}
            </div>

            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                style={{
                  width: `${
                    isAnalyzing
                      ? analysisProgress?.percent ?? 4
                      : Math.round(
                          ((activeProject?.currentChunk ?? 0) /
                            Math.max(1, activeProject?.totalChunks ?? 1)) *
                            100
                        )
                  }%`,
                }}
                className="h-full bg-[#E04F16] transition-all duration-200"
              />
            </div>
          </section>
        )}

        {analysisError && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
            {analysisError}
          </div>
        )}

        {/* Tab Views */}
        {activeTab === 'studio' && (showImportHub || !activeProject) && (
          <ImportHub
            preset={preset}
            chunkDurationSec={chunkDurationSec}
            category={category}
            resumableProjects={resumableProjects}
            isGeneratingDemo={isGeneratingDemo}
            demoProgressLabel={demoProgressLabel}
            onChangePreset={setPreset}
            onChangeChunkDuration={setChunkDurationSec}
            onChangeCategory={setCategory}
            onImportFile={handleImportFile}
            onGenerateSample={handleGenerateSample}
            onResumeProject={handleResumeProject}
          />
        )}

        {/* Live Deep Rendering Progress Banner (visible across Studio, Cuts, Scripts) */}
        {isExporting && activeTab !== 'export' && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121722]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {exportProgress?.stageLabel || 'Rendering real cuts, transitions & effects into MP4...'}
                </h2>
                <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {exportProgress?.percent ?? 0}% · Processed {formatClock(exportProgress?.encodedSec ?? 0)} /{' '}
                  {formatClock(exportProgress?.targetSec ?? activeProject?.summary?.editedDurationSec ?? 0)} ·{' '}
                  {exportProgress?.etaSec !== null && exportProgress?.etaSec !== undefined
                    ? `~${exportProgress.etaSec}s left`
                    : 'Calculating ETA...'}{' '}
                  · Heap ~{exportProgress?.ramEstimateMb ?? 45} MB
                </p>
              </div>
              <button
                type="button"
                onClick={() => exportAbortRef.current?.abort()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-400 bg-amber-50 px-4 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200 whitespace-nowrap shrink-0"
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                <span>Pause Render</span>
              </button>
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                style={{ width: `${exportProgress?.percent ?? 2}%` }}
                className="h-full bg-[#E04F16] transition-all duration-150"
              />
            </div>
          </section>
        )}

        {activeTab === 'studio' && !showImportHub && activeProject && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <VideoPreviewStage
                videoUrl={videoUrl}
                renderedVideoUrl={exportedVideoUrl}
                segments={activeProject.segments}
                summary={activeProject.summary}
                activeSegmentId={activeSegmentId}
                onSelectSegment={(seg) => setActiveSegmentId(seg.id)}
              />
            </div>

            <aside className="space-y-5 lg:col-span-4">
              {activeProject.summary ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121722]">
                  {isExporting || activeProject.status === 'rendering' ? (
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#E04F16]">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      <span>Rendering Cuts &amp; Effects ({exportProgress?.percent ?? 0}%)</span>
                    </div>
                  ) : activeProject.status === 'exported' && activeProject.exportResult?.verifiedComplete ? (
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>
                        Editing Complete — {activeProject.exportResult.cutsAppliedCount} Cuts &amp;{' '}
                        {activeProject.exportResult.effectsAppliedCount} Effects Applied
                      </span>
                    </div>
                  ) : activeProject.status === 'export_paused' ? (
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <Pause className="h-4 w-4" aria-hidden="true" />
                      <span>Rendering Paused — Resume to Complete MP4</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      <span>Timeline Ready — Render MP4 to Apply Cuts &amp; Effects</span>
                    </div>
                  )}

                  <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                    Automatic Edit Summary
                  </h2>

                  <dl className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Original Length</dt>
                      <dd className="font-mono font-semibold tabular-nums">
                        {formatClock(activeProject.summary.durationSec)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Edited Length</dt>
                      <dd className="font-mono font-semibold text-[#E04F16] tabular-nums">
                        {formatClock(activeProject.summary.editedDurationSec)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Removed Clips</dt>
                      <dd className="font-mono font-semibold tabular-nums">
                        {activeProject.segments.filter((s) => s.action === 'cut').length} cuts
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-slate-500 dark:text-slate-400">Video Resolution</dt>
                      <dd className="font-mono font-semibold tabular-nums">
                        {activeProject.width}×{activeProject.height}
                      </dd>
                    </div>
                  </dl>

                  {exportError && (
                    <p className="mt-3 rounded-xl bg-rose-50 p-2.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                      {exportError}
                    </p>
                  )}

                  <div className="mt-5 grid grid-cols-1 gap-2.5">
                    {activeProject.exportResult?.verifiedComplete ? (
                      <button
                        type="button"
                        onClick={() => setActiveTab('export')}
                        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#E04F16] px-4 text-sm font-semibold text-white hover:bg-[#C84310]"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        <span>Open Verified MP4 Export</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('export');
                          if (!isExporting) handleStartExport();
                        }}
                        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#E04F16] px-4 text-sm font-semibold text-white hover:bg-[#C84310]"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        <span>
                          {isExporting
                            ? `View Live Render (${exportProgress?.percent ?? 0}%)`
                            : activeProject.status === 'export_paused'
                            ? 'Resume Rendering MP4'
                            : 'Render & Export Edited MP4'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setActiveTab('scripts')}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      <span>View Hindi &amp; English Scripts</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('cuts')}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <Scissors className="h-4 w-4" aria-hidden="true" />
                      <span>Inspect Smart Cuts &amp; Effects</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-[#121722] dark:text-slate-300">
                  Analyzing video chunks sequentially to keep memory usage safe for 6 GB RAM phones.
                </div>
              )}

              {activeProject.checkpoints.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#121722]">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Saved Chunk Checkpoints
                  </h3>
                  <div className="mt-3 space-y-2">
                    {activeProject.checkpoints.map((cp) => (
                      <div
                        key={cp.chunkIndex}
                        className="flex items-center justify-between font-mono text-xs text-slate-700 tabular-nums dark:text-slate-300"
                      >
                        <span>
                          Chunk {cp.chunkIndex + 1}/{cp.totalChunks} ({formatClock(cp.startSec)}–
                          {formatClock(cp.endSec)})
                        </span>
                        <span className="text-slate-500">
                          {cp.framesAnalyzed}f · ~{cp.estimatedRamMb}MB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {activeTab === 'cuts' && (
          activeProject?.summary ? (
            <div className="space-y-6">
              <VideoPreviewStage
                videoUrl={videoUrl}
                renderedVideoUrl={exportedVideoUrl}
                segments={activeProject.segments}
                summary={activeProject.summary}
                activeSegmentId={activeSegmentId}
                onSelectSegment={(seg) => setActiveSegmentId(seg.id)}
              />
              <SmartEdlPanel
                segments={activeProject.segments}
                summary={activeProject.summary}
                preset={activeProject.preset}
                activeSegmentId={activeSegmentId}
                needsReRender={!activeProject.exportResult?.verifiedComplete}
                onChangePreset={handleChangeProjectPreset}
                onToggleSegment={handleToggleSegment}
                onSelectSegment={(seg) => setActiveSegmentId(seg.id)}
                onResetOverrides={() => handleChangeProjectPreset(activeProject.preset)}
                onRenderEditedVideo={() => {
                  setActiveTab('export');
                  if (!isExporting) handleStartExport();
                }}
              />
            </div>
          ) : (
            <EmptyProjectPrompt onGoImport={handleQuickImport} />
          )
        )}

        {activeTab === 'scripts' && (
          activeProject?.script ? (
            <BilingualScriptStudio
              script={activeProject.script}
              category={activeProject.category}
              onChangeCategory={handleChangeScriptCategory}
              onRegenerate={() => handleChangeScriptCategory(activeProject.category)}
            />
          ) : (
            <EmptyProjectPrompt onGoImport={handleQuickImport} />
          )
        )}

        {activeTab === 'export' && (
          activeProject?.summary ? (
            <ExportStudio
              summary={activeProject.summary}
              segments={activeProject.segments}
              isExporting={isExporting}
              exportProgress={exportProgress}
              exportCheckpoint={activeProject.exportCheckpoint}
              exportError={exportError}
              exportResult={activeProject.exportResult}
              exportedVideoUrl={exportedVideoUrl}
              onStartExport={handleStartExport}
              onPauseExport={() => exportAbortRef.current?.abort()}
              onResetExport={handleResetExport}
              onSaveToGalleryFolder={handleSaveToGalleryFolder}
              onShareMp4={handleShareMp4}
            />
          ) : (
            <EmptyProjectPrompt onGoImport={handleQuickImport} />
          )
        )}

        {activeTab === 'projects' && (
          <ProjectsView
            projects={projects}
            activeProjectId={activeProject?.id ?? null}
            storageInfo={storageInfo}
            onOpenProject={handleOpenProject}
            onResumeProject={handleResumeProject}
            onDeleteCache={handleDeleteCache}
          />
        )}

        {activeTab === 'android' && <AndroidNativeView />}
      </main>

      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'studio') setShowImportHub(false);
        }}
      />

      <OfflineIndicator />
    </div>
  );
}

const EmptyProjectPrompt: React.FC<{ onGoImport: () => void }> = ({ onGoImport }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-[#121722]">
    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
      No Analyzed Video Loaded
    </h2>
    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
      Import a video from your Gallery, Screen Recordings, or File Manager first to inspect cuts, scripts, or export.
    </p>
    <button
      type="button"
      onClick={onGoImport}
      className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#E04F16] px-5 text-xs font-semibold text-white hover:bg-[#C84310]"
    >
      Go to Import Studio
    </button>
  </div>
);
