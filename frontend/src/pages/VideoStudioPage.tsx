import { AlertTriangle, Film, Layers, Plug, Video } from 'lucide-react';
import { Badge, Button, PageHeader, Panel } from '../components/ui';
import { useStudios } from '../lib/queries';
import { ScrollPage } from '../components/Layout';

export function VideoStudioPage() {
  const { data: capabilities } = useStudios();
  const video = capabilities?.video;
  return (
    <ScrollPage>
      <PageHeader eyebrow="Video generation architecture" title="Video Studio" description="A capability-gated workspace for text-to-video, image-to-video, and video processing. No backend is installed in this build, so generation is deliberately disabled." actions={<Badge tone={video?.available ? 'success' : 'warn'} dot>{video?.available ? 'Backend ready' : 'Interface only'}</Badge>} />
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/25 bg-warn/5 p-4"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" /><div><p className="text-[13px] font-medium text-warn">Video generation is not available</p><p className="mt-1 text-[11px] leading-relaxed text-muted">{video?.reason}</p>{video?.hint && <p className="mt-1 text-[11px] text-faint">{video.hint}</p>}<p className="mt-2 text-[10.5px] text-faint">VANTARA will not display simulated progress or placeholder clips that resemble completed generations.</p></div></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel className="p-5">
          <div className="flex items-center gap-2"><span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><Video size={17} /></span><div><h2 className="text-sm font-semibold text-ink-50">Text to video</h2><p className="text-[11px] text-muted">Requires a registered local video backend</p></div></div>
          <div className="mt-4 space-y-3">
            <div><label className="label">Prompt</label><textarea disabled placeholder="Describe a shot, camera movement, and duration…" className="field mt-1.5 min-h-[110px] resize-none opacity-50" /></div>
            <div className="grid grid-cols-3 gap-2"><div><label className="label">Width</label><input disabled value={768} className="field mt-1.5 opacity-50" /></div><div><label className="label">Height</label><input disabled value={432} className="field mt-1.5 opacity-50" /></div><div><label className="label">Seconds</label><input disabled value={4} className="field mt-1.5 opacity-50" /></div></div>
            <Button variant="primary" disabled><Film size={14} /> Generate video</Button>
          </div>
        </Panel>
        <div className="space-y-4">
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Backend contract</h2><p className="mt-1 text-[11px] leading-relaxed text-muted">A video adapter must implement capability discovery, generation, progress events, cancellation, and output metadata. Never a mock loop.</p><div className="mt-3 space-y-2 text-[11px] text-muted"><p className="flex items-center gap-2"><Plug size={12} className="text-accent-soft" /> Register a backend in the studio capability registry</p><p className="flex items-center gap-2"><Layers size={12} className="text-accent-soft" /> Expose text-to-video / image-to-video tasks</p><p className="flex items-center gap-2"><Film size={12} className="text-accent-soft" /> Stream real progress from the runtime</p></div></Panel>
          <Panel className="p-5"><h2 className="text-sm font-semibold text-ink-50">Current status</h2><div className="mt-2 space-y-1.5 text-[11px] text-muted"><p className="flex justify-between"><span>Text to video</span><Badge tone="neutral">unavailable</Badge></p><p className="flex justify-between"><span>Image to video</span><Badge tone="neutral">unavailable</Badge></p><p className="flex justify-between"><span>Video processing</span><Badge tone="neutral">unavailable</Badge></p></div></Panel>
        </div>
      </div>
    </ScrollPage>
  );
}
