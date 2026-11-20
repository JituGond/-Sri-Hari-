import React from 'react';
import { Upload } from 'lucide-react';

export type AppTab = 'studio' | 'cuts' | 'scripts' | 'export' | 'projects' | 'android';

interface TopBarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onQuickImport: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string }> = [
  { id: 'studio', label: 'Studio' },
  { id: 'cuts', label: 'Smart Cuts' },
  { id: 'scripts', label: 'Scripts' },
  { id: 'export', label: 'Export' },
  { id: 'android', label: 'Android APK' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onQuickImport,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-[#0B0E14]/90">
      <div className="mx-auto flex h-[54px] max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:h-16">
        <button
          type="button"
          onClick={() => onSelectTab('studio')}
          className="text-left text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E04F16]"
        >
          Hanuman AI
        </button>

        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E04F16] ${
                  isActive
                    ? 'font-semibold text-[#E04F16]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-[#E04F16]"
                  />
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onSelectTab('projects')}
            className={`relative py-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E04F16] ${
              activeTab === 'projects'
                ? 'font-semibold text-[#E04F16]'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            Projects
            {activeTab === 'projects' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-[#E04F16]"
              />
            )}
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onQuickImport}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#E04F16] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#C84310] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E04F16]"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>Import Video</span>
          </button>
        </div>
      </div>
    </header>
  );
};
