import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ChevronDown, Download, ExternalLink, Filter, HardDrive,
  Library, Loader2, Search, Sparkles, Trash2, X, Zap,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { CatalogPage, DownloadRecord, HfDetail, HfFile, HfModel, InstalledModel } from '../lib/types';
import { useDownloads } from '../lib/queries';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Panel, Progress, Select, Skeleton, Spinner, cn } from '../components/ui';
import { bytes, compact, relativeTime, statusTone } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';
import { Markdown } from '../components/Markdown';

const TASKS = [
  { value: '', label: 'All tasks' },
  { value: 'text-generation', label: 'Text generation / chat' },
  { value: 'image-text-to-text', label: 'Vision + text' },
  { value: 'text-to-image', label: 'Image generation' },
  { value: 'automatic-speech-recognition', label: 'Speech recognition' },
  { value: 'text-to-speech', label: 'Text to speech' },
  { value: 'feature-extraction', label: 'Embeddings' },
  { value: 'sentence-similarity', label: 'Sentence similarity' },
  { value: 'image-classification', label: 'Image classification' },
  { value: 'text-to-video', label: 'Text to video' },
];

function cleanReadme(readme?: string): string {
  if (!readme) return '';
  if (readme.startsWith('---')) {
    const end = readme.indexOf('\n---', 3);
    if (end !== -1) return readme.slice(end + 4).trim();
  }
  return readme;
}

export function ModelLibraryPage() {
  const queryClient = useQueryClient();
  const { data: downloads = [] } = useDownloads();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [task, setTask] = useState('');
  const [library, setLibrary] = useState('');
  const [sort, setSort] = useState('downloads');
  const [ggufOnly, setGgufOnly] = useState(true);
  const [license, setLicense] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(timer); }, [search]);

  const catalog = useInfiniteQuery({
    queryKey: ['catalog', debounced, task, library, sort, ggufOnly, license],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '25', sort });
      if (debounced) params.set('q', debounced);
      if (task) params.set('task', task);
      if (library) params.set('library', library);
      if (ggufOnly) params.set('filter', 'gguf');
      if (license) params.set('license', license);
      if (pageParam) params.set('cursor', pageParam);
      return api<CatalogPage>(`/catalog/search?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 60_000,
  });

  const installed = useQuery({ queryKey: ['installed-models'], queryFn: () => api<{ models: InstalledModel[] }>('/models/installed'), select: (data) => data.models });
  const detail = useQuery({ queryKey: ['catalog-detail', selectedRepo], queryFn: () => api<HfDetail>(`/catalog/models/${selectedRepo}`), enabled: Boolean(selectedRepo), staleTime: 120_000 });

  const models = useMemo(() => catalog.data?.pages.flatMap((page) => page.items) ?? [], [catalog.data]);
  const installedRepos = useMemo(() => new Set((installed.data ?? []).map((model) => model.repo_id).filter(Boolean)), [installed.data]);

  async function startDownload(repoId: string, filename: string) {
    try {
      await api<DownloadRecord>('/downloads', { method: 'POST', body: JSON.stringify({ repo_id: repoId, filename }) });
      toast.success('Download started', filename);
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog-detail', repoId] });
    } catch (error) { toast.error('Could not start download', errorMessage(error)); }
  }

  async function cancelDownload(id: string) {
    try { await api(`/downloads/${id}/cancel`, { method: 'POST' }); void queryClient.invalidateQueries({ queryKey: ['downloads'] }); }
    catch (error) { toast.error('Cancel failed', errorMessage(error)); }
  }

  async function retryDownload(id: string) {
    try { await api(`/downloads/${id}/retry`, { method: 'POST' }); void queryClient.invalidateQueries({ queryKey: ['downloads'] }); }
    catch (error) { toast.error('Retry failed', errorMessage(error)); }
  }

  async function removeModel(model: InstalledModel) {
    if (!window.confirm(`Delete ${model.display_name} from disk?`)) return;
    try {
      await api(`/models/installed/${model.id}`, { method: 'DELETE' });
      toast.success('Model removed');
      void queryClient.invalidateQueries({ queryKey: ['installed-models'] });
      void queryClient.invalidateQueries({ queryKey: ['local-models'] });
      void queryClient.invalidateQueries({ queryKey: ['runtimes'] });
    } catch (error) { toast.error('Could not remove model', errorMessage(error)); }
  }

  const activeDownloads = downloads.filter((item) => ['queued', 'downloading'].includes(item.status));

  return (
    <ScrollPage>
      <PageHeader
        eyebrow="Open model ecosystem"
        title="Model Library"
        description="Search the live Hugging Face Hub catalog with server-side pagination. Model metadata is real upstream data; installing a GGUF file makes it runnable through llama.cpp."
        actions={<Badge tone="accent"><Library size={11} /> Live Hub catalog</Badge>}
      />

      <Panel className="p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search models, publishers, architectures…" className="h-10 pl-9" />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink-50" aria-label="Clear search"><X size={13} /></button>}
          </div>
          <div className="flex items-center gap-2">
            <Select value={task} onChange={(event) => setTask(event.target.value)} className="h-10 w-[190px] text-xs">{TASKS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
            <Select value={sort} onChange={(event) => setSort(event.target.value)} className="h-10 w-[150px] text-xs">
              <option value="downloads">Most downloaded</option><option value="likes">Most liked</option><option value="lastModified">Recently updated</option><option value="createdAt">Newest</option><option value="trendingScore">Trending</option>
            </Select>
            <Button onClick={() => setShowFilters((value) => !value)} className="h-10"><Filter size={14} /> Filters</Button>
          </div>
        </div>
        {showFilters && (
          <div className="mt-3 grid gap-3 border-t border-lineSoft pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Framework"><Select value={library} onChange={(event) => setLibrary(event.target.value)}><option value="">Any framework</option><option value="gguf">GGUF</option><option value="transformers">Transformers</option><option value="diffusers">Diffusers</option><option value="sentence-transformers">Sentence Transformers</option><option value="timm">timm</option></Select></Field>
            <Field label="License"><Select value={license} onChange={(event) => setLicense(event.target.value)}><option value="">Any license</option><option value="apache-2.0">Apache 2.0</option><option value="mit">MIT</option><option value="llama3">Llama 3</option><option value="gemma">Gemma</option><option value="cc-by-4.0">CC-BY-4.0</option><option value="other">Other</option></Select></Field>
            <Field label="Install compatibility"><label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-ink-900 px-3 text-xs text-muted"><input type="checkbox" checked={ggufOnly} onChange={(event) => setGgufOnly(event.target.checked)} className="accent-[#8b5cf6]" /> GGUF only (direct install)</label></Field>
            <div className="flex items-end"><p className="text-[10.5px] leading-relaxed text-faint">The 10,000+ target refers to discoverable catalog tabs, not local installs. License filtering is applied to returned metadata and can reduce page size.</p></div>
          </div>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div>
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted"><span>{models.length} model listing(s) loaded</span>{catalog.isFetching && <span className="inline-flex items-center gap-1 text-faint"><Loader2 size={11} className="animate-spin" /> fetching</span>}</div>
          {catalog.isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3, 4].map((index) => <Skeleton key={index} className="h-20" />)}</div>
          ) : catalog.isError ? (
            <EmptyState icon={<AlertTriangle size={19} />} title="Catalog request failed" description={errorMessage(catalog.error)} action={<Button onClick={() => void catalog.refetch()}>Retry</Button>} />
          ) : models.length === 0 ? (
            <EmptyState icon={<Search size={19} />} title="No models match these filters" description="Try a broader search, clear the license filter, or disable GGUF-only mode." action={<Button onClick={() => { setSearch(''); setTask(''); setLibrary(''); setLicense(''); setGgufOnly(false); }}>Reset filters</Button>} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              {models.map((model) => (
                <ModelRow key={model.id} model={model} installed={installedRepos.has(model.id)} onOpen={() => setSelectedRepo(model.id)} />
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-center gap-2">
            {catalog.hasNextPage && <Button onClick={() => void catalog.fetchNextPage()} loading={catalog.isFetchingNextPage}>Load more models <ChevronDown size={14} /></Button>}
            {!catalog.hasNextPage && models.length > 0 && <p className="text-[11px] text-faint">End of this catalog cursor. Adjust filters to explore further.</p>}
          </div>
        </div>

        <div className="space-y-4">
          <Panel className="p-4">
            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold text-ink-50">Downloads</h2><Badge tone={activeDownloads.length ? 'warn' : 'neutral'}>{activeDownloads.length} active</Badge></div>
            <div className="mt-3 space-y-3">
              {downloads.length === 0 && <p className="text-[11px] leading-relaxed text-faint">No downloads yet. Open a GGUF model and choose a quantized file.</p>}
              {downloads.slice(0, 8).map((download) => (
                <div key={download.id}>
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-[11px] font-medium text-ink-50">{download.filename}</p><p className="truncate text-[9.5px] text-faint">{download.repo_id}</p></div><Badge tone={statusTone(download.status)}>{download.status}</Badge></div>
                  {download.status === 'downloading' && <><Progress className="mt-1.5" value={download.percent ?? 0} /><p className="mt-1 text-[9.5px] text-faint">{bytes(download.downloaded_bytes)} / {bytes(download.total_bytes)}</p></>}
                  {download.error && <p className="mt-1 line-clamp-3 text-[10px] text-danger">{download.error}</p>}
                  <div className="mt-1.5 flex gap-1">
                    {['queued', 'downloading'].includes(download.status) && <Button size="sm" variant="ghost" onClick={() => void cancelDownload(download.id)}>Cancel</Button>}
                    {['failed', 'cancelled'].includes(download.status) && <Button size="sm" variant="ghost" onClick={() => void retryDownload(download.id)}>Retry</Button>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold text-ink-50">Installed</h2><Badge tone="neutral">{installed.data?.length ?? 0}</Badge></div>
            <div className="mt-3 space-y-2">
              {!installed.data?.length && <p className="text-[11px] leading-relaxed text-faint">Installed model files appear here and in Local Models.</p>}
              {(installed.data ?? []).map((model) => (
                <div key={model.id} className="rounded-lg border border-lineSoft bg-ink-950/40 p-2.5">
                  <p className="truncate text-[11px] font-medium text-ink-50" title={model.display_name}>{model.display_name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1"><Badge tone={model.runnable ? 'success' : 'warn'}>{model.runtime}</Badge><span className="text-[9.5px] text-faint">{bytes(model.size_bytes)}</span>{model.quantization && <span className="text-[9.5px] text-faint">· {model.quantization}</span>}</div>
                  <div className="mt-1.5 flex items-center gap-1"><span className="text-[9px] text-faint">{relativeTime(model.created_at)}</span><button onClick={() => void removeModel(model)} className="ml-auto rounded p-1 text-faint hover:text-danger" title="Delete from disk"><Trash2 size={11} /></button></div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="rounded-xl border border-lineSoft bg-panel/40 p-4 text-[10.5px] leading-relaxed text-faint">
            <p className="flex items-center gap-1.5 font-medium text-muted"><HardDrive size={12} /> Installation truth</p>
            <p className="mt-1.5">Discovering a model does not mean it fits your hardware. VANTARA downloads only the file you choose and reports size, quantization, and runtime compatibility. Gated repositories require an accepted license and an HF token on the server.</p>
          </div>
        </div>
      </div>

      <Modal open={Boolean(selectedRepo)} onClose={() => setSelectedRepo(null)} size="xl" title={detail.data?.id ?? selectedRepo ?? 'Model'} description={detail.data ? `${compact(detail.data.downloads)} downloads · ${compact(detail.data.likes)} likes · ${detail.data.license}` : 'Loading model card…'}>
        {detail.isLoading ? <div className="flex items-center gap-2 py-10 text-xs text-muted"><Spinner /> Fetching metadata from Hugging Face…</div> : detail.isError ? <EmptyState title="Could not load model" description={errorMessage(detail.error)} /> : detail.data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{detail.data.task}</Badge>
              {detail.data.library && <Badge tone="neutral">{detail.data.library}</Badge>}
              <Badge tone="neutral">{detail.data.license}</Badge>
              {Boolean(detail.data.gated) && <Badge tone="warn">gated</Badge>}
              {detail.data.gguf && <Badge tone="blue">GGUF</Badge>}
              <a href={`https://huggingface.co/${detail.data.id}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent-soft hover:underline">Model card <ExternalLink size={10} /></a>
            </div>
            {detail.data.hardware && <div className="flex items-center gap-2 rounded-lg border border-lineSoft bg-ink-950/50 px-3 py-2 text-[10.5px] text-muted"><Zap size={12} className="text-accent-soft" /> Host memory available: {bytes(detail.data.hardware.memory_available_bytes)} · {detail.data.hardware.gpus.length ? detail.data.hardware.gpus[0].name as string : 'CPU inference'}</div>}

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Installable files</h3>
              {detail.data.gguf_files.length === 0 ? (
                <div className="rounded-lg border border-lineSoft bg-ink-950/40 p-3 text-[11px] leading-relaxed text-muted">This repository has no GGUF files. VANTARA can download its weights, but no managed runtime is attached automatically. Transformers directories can be used when PyTorch/Transformers is installed.</div>
              ) : (
                <div className="space-y-1.5">
                  {detail.data.gguf_files.map((file) => <FileRow key={file.filename} file={file} repoId={detail.data!.id} onDownload={() => void startDownload(detail.data!.id, file.filename)} downloads={downloads} />)}
                </div>
              )}
            </section>

            {detail.data.readme ? (
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Model card</h3>
                <div className="max-h-80 overflow-y-auto rounded-lg border border-lineSoft bg-ink-950/40 p-3"><Markdown content={cleanReadme(detail.data.readme)} /></div>
              </section>
            ) : <p className="text-[11px] text-faint">No README was available from the Hub.</p>}

            <div className="rounded-lg border border-warn/20 bg-warn/5 p-3 text-[10.5px] leading-relaxed text-warn">
              <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={12} /> Review license and safety notes</p>
              <p className="mt-1 text-muted">Model outputs can be inaccurate or harmful. VANTARA does not bypass gated access. Verify the repository license before commercial use.</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </ScrollPage>
  );
}

function ModelRow({ model, installed, onOpen }: { model: HfModel; installed: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-start gap-3 border-b border-lineSoft bg-surface/60 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-panel">
      <span className="mt-0.5 rounded-md border border-line bg-raised p-2 text-accent-soft"><Sparkles size={13} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-[12.5px] font-medium text-ink-50">{model.id}</span>{installed && <Badge tone="success"><CheckCircle2 size={9} /> installed</Badge>}{model.gguf && <Badge tone="blue">GGUF</Badge>}{Boolean(model.gated) && <Badge tone="warn">gated</Badge>}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted"><span>{model.task}</span><span>·</span><span>{model.license}</span><span>·</span><span>{compact(model.downloads)} downloads</span><span>·</span><span>{compact(model.likes)} likes</span>{model.updated_at && <><span>·</span><span>updated {relativeTime(model.updated_at)}</span></>}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-2 text-[10px] text-faint sm:flex"><Download size={11} /> details</span>
    </button>
  );
}

function FileRow({ file, repoId, onDownload, downloads }: { file: HfFile; repoId: string; onDownload: () => void; downloads: DownloadRecord[] }) {
  const active = downloads.find((download) => download.repo_id === repoId && download.filename === file.filename && ['queued', 'downloading'].includes(download.status));
  const fits = file.recommendation?.fits;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-lineSoft bg-ink-950/40 px-3 py-2">
      <div className="min-w-0 flex-1"><p className="truncate font-mono text-[10.5px] text-ink-50">{file.filename}</p><p className={cn('mt-0.5 text-[9.5px]', fits === false ? 'text-warn' : 'text-faint')}>{bytes(file.size_bytes)} · {file.recommendation?.reason ?? 'Compatibility unknown'}</p></div>
      {file.installed ? <Badge tone="success">installed</Badge> : active ? <Badge tone="warn">downloading</Badge> : <Button size="sm" onClick={onDownload}><Download size={11} /> Install</Button>}
    </div>
  );
}
