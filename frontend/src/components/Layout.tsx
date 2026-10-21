import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  AudioLines, Bot, BookOpen, Boxes, ChevronLeft, ChevronRight, CircleHelp, Gamepad2, HardDrive, Wand2, TerminalSquare, Rocket,
  History, Home, Image as ImageIcon, Library, Menu, MessageSquare, Settings,
  Video, Workflow, X, Activity, Download,
} from 'lucide-react';
import { useUIStore } from '../lib/store';
import { useRuntimes, useDownloads } from '../lib/queries';
import { Badge, cn } from './ui';
import { Toaster } from './Toaster';

const NAV = [
  { to: '/projects', label: 'Projects', icon: Boxes },
  { to: '/editor', label: 'Game Editor', icon: Gamepad2 },
  { to: '/publish', label: 'Publish', icon: Rocket },
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/create', label: 'Creator Studio', icon: Wand2 },
  { to: '/terminal', label: 'AI Terminal', icon: TerminalSquare },
  { to: '/chat', label: 'VANTARA Chat', icon: MessageSquare },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/models', label: 'Model Library', icon: Library },
  { to: '/local-models', label: 'Local Models', icon: HardDrive },
  { to: '/image-studio', label: 'Image Studio', icon: ImageIcon },
  { to: '/audio-studio', label: 'Audio Studio', icon: AudioLines },
  { to: '/video-studio', label: 'Video Studio', icon: Video },
  { to: '/agents', label: 'AI Agents', icon: Bot },
  { to: '/knowledge', label: 'Knowledge Bases', icon: BookOpen },
  { to: '/runs', label: 'Runs & History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useUIStore();
  const { data: runtimes } = useRuntimes();
  const { data: downloads } = useDownloads();
  const location = useLocation();
  const [, setTick] = useState(0);

  useEffect(() => { setMobileNavOpen(false); }, [location.pathname, setMobileNavOpen]);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const localReady = runtimes?.some((runtime) => runtime.local && runtime.available) ?? false;
  const activeDownloads = downloads?.filter((item) => ['queued', 'downloading'].includes(item.status)).length ?? 0;
  const activeNav = useMemo(() => NAV.find((item) => item.end ? location.pathname === '/' : location.pathname.startsWith(item.to)), [location.pathname]);
  const title = activeNav?.label ?? 'VANTARA AI';

  return (
    <div className="flex h-screen overflow-hidden bg-ink">
      {mobileNavOpen && <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-ink-950/95 backdrop-blur transition-all duration-200 lg:static lg:z-auto',
          sidebarCollapsed ? 'lg:w-[68px]' : 'lg:w-[236px]',
          mobileNavOpen ? 'w-[260px] translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className={cn('flex h-16 items-center border-b border-lineSoft px-4', sidebarCollapsed && 'lg:justify-center lg:px-2')}>
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10">
              <span className="h-3 w-3 rounded-[3px] bg-gradient-to-br from-accent-soft to-electric" />
              <span className="absolute inset-0 rounded-lg shadow-glow" />
            </span>
            {!sidebarCollapsed && (
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold tracking-[0.16em] text-ink-50">VANTARA</span>
                <span className="block text-[9.5px] font-medium uppercase tracking-[0.22em] text-faint">AI Studio</span>
              </span>
            )}
          </Link>
          <button onClick={() => setMobileNavOpen(false)} className="ml-auto rounded p-1 text-muted hover:text-ink-50 lg:hidden" aria-label="Close navigation"><X size={16} /></button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to} to={item.to} end={item.end}
              title={sidebarCollapsed ? item.label : undefined}
              className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active', sidebarCollapsed && 'lg:justify-center lg:px-2')}
            >
              <item.icon size={16} className="shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              {!sidebarCollapsed && item.to === '/local-models' && localReady && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-success" />}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-lineSoft p-2">
          {activeDownloads > 0 && (
            <Link to="/models" className={cn('mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-warn hover:bg-raised', sidebarCollapsed && 'lg:justify-center')}>
              <Download size={13} className="animate-pulseSoft" />
              {!sidebarCollapsed && <span>{activeDownloads} download{activeDownloads > 1 ? 's' : ''} active</span>}
            </Link>
          )}
          <div className={cn('rounded-lg border border-lineSoft bg-panel/60 p-2.5', sidebarCollapsed && 'lg:flex lg:justify-center lg:p-2')}>
            <div className="flex items-center gap-2">
              <span className={cn('h-1.5 w-1.5 rounded-full', localReady ? 'bg-success' : 'bg-warn')} />
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <p className="truncate text-[10.5px] font-medium text-ink-50">{localReady ? 'Local engine ready' : 'No local runtime'}</p>
                  <p className="truncate text-[9.5px] text-faint">{runtimes?.find((r) => r.available)?.label ?? 'Configure in Local Models'}</p>
                </div>
              )}
            </div>
          </div>
          <button onClick={toggleSidebar} className="mt-1 hidden w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-[11px] text-faint hover:bg-raised hover:text-muted lg:flex">
            {sidebarCollapsed ? <ChevronRight size={13} /> : <><ChevronLeft size={13} /> Collapse</>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-lineSoft bg-ink-950/60 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setMobileNavOpen(true)} className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink-50 lg:hidden" aria-label="Open navigation"><Menu size={18} /></button>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Workspace</p>
              <h2 className="truncate text-[13px] font-semibold text-ink-50">{title}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Badge tone={localReady ? 'success' : 'warn'} dot className="hidden sm:inline-flex">
              {localReady ? 'Local inference' : 'Runtime offline'}
            </Badge>
            <div className="hidden items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11px] text-muted md:flex">
              <Activity size={12} className="text-accent-soft" /> Private by default
            </div>
            <Link to="/settings" className="rounded-md p-2 text-muted hover:bg-raised hover:text-ink-50" title="Settings"><Settings size={16} /></Link>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden"><Outlet /></main>
      </div>
      <Toaster />
    </div>
  );
}

export function ScrollPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('h-full overflow-y-auto', className)}><div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</div></div>;
}

export function HelpLink() {
  return <a href="/api/docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink-50"><CircleHelp size={13} /> API docs</a>;
}
