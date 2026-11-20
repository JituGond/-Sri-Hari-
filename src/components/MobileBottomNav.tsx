import React from 'react';
import { Clapperboard, Scissors, FileText, Download, FolderClock } from 'lucide-react';
import { AppTab } from './TopBar';

interface MobileBottomNavProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}

const MOBILE_TABS: Array<{ id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'studio', label: 'Studio', icon: Clapperboard },
  { id: 'cuts', label: 'Cuts', icon: Scissors },
  { id: 'scripts', label: 'Scripts', icon: FileText },
  { id: 'export', label: 'Export', icon: Download },
  { id: 'projects', label: 'Projects', icon: FolderClock },
];

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav
      aria-label="Mobile bottom navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe md:hidden dark:border-slate-800 dark:bg-[#0B0E14]/95"
    >
      <div className="grid h-16 grid-cols-5 items-center">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`flex min-h-[48px] flex-col items-center justify-center px-1 transition-colors ${
                active
                  ? 'text-[#E04F16]'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="mt-1 text-[11px] font-medium tracking-tight whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
