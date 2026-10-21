import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Image as ImageIcon, Sparkles, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { Output } from '../lib/types';
import { useStudios } from '../lib/queries';
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Select, Textarea } from '../components/ui';
import { relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';

interface GenerationResult { output_id: string; name: string; path: string; seed: number; width: number; height: number; prompt: string; model: string; url: string }

export function ImageStudioPage() {
  const queryClient = useQueryClient();
  const { data: capabilities, isLoading } = useStudios();
  const { data: outputs = [] } = useQuery({ queryKey: ['outputs'], queryFn: () => api<{ outputs: Output[] }>('/outputs'), select: (data) => data.outputs.filter((output) => output.kind === 'image') });
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [model, setModel] = useState('');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(24);
  const [seed, setSeed] = useState(-1);
  const [generating, setGenerating] = useState(false);
  const [last, setLast] = useState<GenerationResult | null>(null);

  const imageCap = capabilities?.image;
  const selectedModel = model || imageCap?.models[0]?.path || '';

  async function generate() {
    if (!prompt.trim() || !selectedModel) return;
    setGenerating(true);
    try {
      const result = await api<GenerationResult>('/studios/image/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, negative_prompt: negative, model: selectedModel, width, height, steps, seed }),
      });
      setLast(result);
      toast.success('Image generated locally', result.name);
      void queryClient.invalidateQueries({ queryKey: ['outputs'] });
    } catch (error) { toast.error('Generation failed', errorMessage(error)); }
    finally { setGenerating(false); }
  }

  async function removeOutput(id: string) {
    try { await api(`/outputs/${id}`, { method: 'DELETE' }); void queryClient.invalidateQueries({ queryKey: ['outputs'] }); }
    catch (error) { toast.error('Could not delete output', errorMessage(error)); }
  }

  return (
    <ScrollPage>
      <PageHeader eyebrow="Local image generation" title="Image Studio" description="Generate images with a local Diffusers pipeline. Capabilities are detected from installed libraries and local model directories — nothing is fabricated." actions={<Badge tone={imageCap?.available ? 'success' : 'warn'} dot>{imageCap?.available ? 'Backend ready' : 'Backend unavailable'}</Badge>} />

      {!isLoading && !imageCap?.available && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warn/25 bg-warn/5 p-4">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warn" />
          <div><p className="text-[13px] font-medium text-warn">Local image generation is not available</p><p className="mt-1 text-[11px] leading-relaxed text-muted">{imageCap?.reason}</p>{imageCap?.hint && <p className="mt-1 text-[11px] text-faint">{imageCap.hint}</p>}<p className="mt-2 text-[10.5px] text-faint">The studio stays disabled until a real backend is installed. VANTARA will not show placeholder progress or fake outputs.</p></div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Panel className="p-4">
          <div className="space-y-3">
            <Field label="Prompt" help="Describe the image you want."><Textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="A graphite control room with violet lighting, cinematic…" /></Field>
            <Field label="Negative prompt"><Textarea rows={2} value={negative} onChange={(event) => setNegative(event.target.value)} placeholder="blurry, low detail" /></Field>
            <Field label="Pipeline">{imageCap?.models.length ? <Select value={selectedModel} onChange={(event) => setModel(event.target.value)}>{imageCap.models.map((item) => <option key={item.path} value={item.path}>{item.name}</option>)}</Select> : <Input disabled placeholder="No local pipeline detected" />}</Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width"><Input type="number" min={64} max={2048} step={64} value={width} onChange={(event) => setWidth(Number(event.target.value))} /></Field>
              <Field label="Height"><Input type="number" min={64} max={2048} step={64} value={height} onChange={(event) => setHeight(Number(event.target.value))} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Steps"><Input type="number" min={1} max={100} value={steps} onChange={(event) => setSteps(Number(event.target.value))} /></Field>
              <Field label="Seed (-1 random)"><Input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></Field>
            </div>
            <Button variant="primary" className="w-full" onClick={() => void generate()} loading={generating} disabled={!imageCap?.available || !prompt.trim() || !selectedModel}><Sparkles size={14} /> Generate locally</Button>
            <p className="text-[10px] leading-relaxed text-faint">Generation runs on your CPU/GPU. Large resolutions and step counts can exhaust memory; VANTARA reports the backend error rather than inventing a result.</p>
          </div>
        </Panel>

        <div className="space-y-4">
          {last && (
            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-lineSoft px-4 py-2.5"><div><p className="text-xs font-medium text-ink-50">Latest generation</p><p className="text-[10px] text-faint">seed {last.seed} · {last.width}×{last.height} · {last.model.split('/').pop()}</p></div><a href={last.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent-soft hover:underline"><Download size={11} className="mr-1 inline" />Open</a></div>
              <img src={last.url} alt={last.prompt} className="max-h-[480px] w-full bg-ink-950 object-contain" />
              <p className="px-4 py-3 text-[11px] leading-relaxed text-muted">{last.prompt}</p>
            </Panel>
          )}
          <Panel className="p-4">
            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold text-ink-50">Output gallery</h2><Link to="/runs" className="text-[11px] text-accent-soft hover:underline">All runs</Link></div>
            {outputs.length === 0 ? <EmptyState className="mt-3 border-0 bg-transparent py-10" icon={<ImageIcon size={19} />} title="No images yet" description="Generated images will appear here and in the output gallery." /> : (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {outputs.map((output) => (
                  <div key={output.id} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-ink-950">
                    <img src={output.url} alt={output.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                    <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/80 via-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="truncate text-[9px] text-white/80">{relativeTime(output.created_at)}</span>
                      <div className="flex gap-1"><a href={output.url} target="_blank" rel="noreferrer" className="rounded bg-black/50 p-1 text-white/80 hover:text-white"><Download size={11} /></a><button onClick={() => void removeOutput(output.id)} className="rounded bg-black/50 p-1 text-white/80 hover:text-danger"><Trash2 size={11} /></button></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </ScrollPage>
  );
}
