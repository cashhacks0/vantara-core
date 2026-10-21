import { useRef, useState } from 'react';
import { AlertTriangle, AudioLines, FileAudio, Info, Upload } from 'lucide-react';
import { errorMessage, uploadFile } from '../lib/api';
import { useStudios } from '../lib/queries';
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

interface Transcription { text: string; language?: string; duration?: number; segments?: Array<{ start: number; end: number; text: string }>; file?: string }

export function AudioStudioPage() {
  const { data: capabilities } = useStudios();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [result, setResult] = useState<Transcription | null>(null);
  const audio = capabilities?.audio;

  async function transcribe() {
    if (!file) return;
    setTranscribing(true);
    try {
      const data = await uploadFile<Transcription>('/studios/audio/transcribe', file);
      setResult(data);
      toast.success('Transcription complete', `${data.segments?.length ?? 0} segment(s)`);
    } catch (error) { toast.error('Transcription failed', errorMessage(error)); }
    finally { setTranscribing(false); }
  }

  return (
    <ScrollPage>
      <PageHeader eyebrow="Local audio tools" title="Audio Studio" description="Speech recognition and audio workflows through local backends. No audio leaves this machine." actions={<Badge tone={audio?.speech_recognition ? 'success' : 'warn'} dot>{audio?.speech_recognition ? 'faster-whisper ready' : 'No ASR backend'}</Badge>} />
      {!audio?.speech_recognition && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/25 bg-warn/5 p-4"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" /><div><p className="text-[13px] font-medium text-warn">Speech recognition is not installed</p><p className="mt-1 text-[11px] leading-relaxed text-muted">{audio?.reason}</p>{audio?.hint && <p className="mt-1 text-[11px] text-faint">{audio.hint}</p>}</div></div>
      )}
      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <Panel className="p-5">
          <div className="flex items-center gap-2"><span className="rounded-lg border border-line bg-raised p-2 text-accent-soft"><AudioLines size={16} /></span><div><h2 className="text-sm font-semibold text-ink-50">Transcribe audio</h2><p className="text-[11px] text-muted">WAV, MP3, M4A, OGG, FLAC, WebM · up to 50 MB</p></div></div>
          <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(event) => { const selected = event.target.files?.[0] ?? null; setFile(selected); setResult(null); event.target.value = ''; }} />
          <button onClick={() => inputRef.current?.click()} disabled={!audio?.speech_recognition} className="mt-4 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-ink-950/40 px-4 py-8 text-center transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50">
            <FileAudio size={22} className="text-muted" />
            <p className="mt-2 text-xs text-ink-50">{file ? file.name : 'Choose an audio file'}</p>
            <p className="mt-1 text-[10px] text-faint">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'Files stay on this machine'}</p>
          </button>
          <Button variant="primary" className="mt-3 w-full" onClick={() => void transcribe()} loading={transcribing} disabled={!file || !audio?.speech_recognition}><Upload size={13} /> Transcribe locally</Button>
          <div className="mt-4 rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[10.5px] leading-relaxed text-muted"><p className="flex items-center gap-1.5 font-medium text-ink-50"><Info size={12} /> Capability gating</p><p className="mt-1">VANTARA checks for faster-whisper at request time. Text-to-speech is reported when a Piper binary is detected, but the synthesis endpoint is not part of this release.</p></div>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-sm font-semibold text-ink-50">Result</h2>
          {!result ? <EmptyState className="mt-3 border-0 bg-transparent py-16" icon={<AudioLines size={20} />} title="No transcription yet" description="Upload audio and run transcription to see text and timestamped segments." /> : (
            <div className="mt-3 space-y-4">
              <div className="flex flex-wrap gap-1.5"><Badge tone="success">completed</Badge>{result.language && <Badge tone="neutral">language: {result.language}</Badge>}{result.duration !== undefined && <Badge tone="neutral">{result.duration.toFixed(1)}s</Badge>}{result.file && <Badge tone="neutral">{result.file}</Badge>}</div>
              <div className="rounded-lg border border-line bg-ink-950/50 p-4 text-[13px] leading-7 text-ink-50/90 whitespace-pre-wrap">{result.text}</div>
              {result.segments && result.segments.length > 0 && <div className="max-h-64 space-y-1 overflow-y-auto">{[...result.segments].reverse().map((segment, index) => <div key={index} className="flex gap-3 rounded-md px-2 py-1 text-[11px] hover:bg-raised/50"><span className="shrink-0 font-mono text-faint">{segment.start.toFixed(1)}s</span><span className="text-muted">{segment.text}</span></div>)}</div>}
            </div>
          )}
        </Panel>
      </div>
    </ScrollPage>
  );
}
