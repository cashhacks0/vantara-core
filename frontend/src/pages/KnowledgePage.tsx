import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, FileText, Library, Plus, Search, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, errorMessage, uploadFile } from '../lib/api';
import type { KnowledgeBase, KnowledgeDocument, KnowledgeSearch } from '../lib/types';
import { useKnowledgeBases } from '../lib/queries';
import { Badge, Button, EmptyState, Field, Input, Modal, PageHeader, Panel, Skeleton, Textarea, cn } from '../components/ui';
import { bytes, relativeTime } from '../lib/format';
import { toast } from '../lib/store';
import { ScrollPage } from '../components/Layout';
import { ModelPicker } from '../components/ModelPicker';
import { Markdown } from '../components/Markdown';

interface AskResult { answer: string; sources: KnowledgeSearch['results']; mode: string; model?: { name: string }; runtime?: string }

export function KnowledgePage() {
  const queryClient = useQueryClient();
  const { data: kbs = [], isLoading } = useKnowledgeBases();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', embedding_model: '' });
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState<KnowledgeSearch | null>(null);
  const [question, setQuestion] = useState('');
  const [askModel, setAskModel] = useState('auto');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!selectedId && kbs.length) setSelectedId(kbs[0].id); }, [kbs, selectedId]);

  const { data: kb, isLoading: kbLoading } = useQuery({
    queryKey: ['knowledge-base', selectedId], queryFn: () => api<KnowledgeBase>(`/knowledge-bases/${selectedId}`), enabled: Boolean(selectedId),
    refetchInterval: (query) => query.state.data?.documents?.some((doc) => doc.status === 'processing') ? 2500 : false,
  });

  async function createKb() {
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const created = await api<KnowledgeBase>('/knowledge-bases', { method: 'POST', body: JSON.stringify({ ...form, embedding_model: form.embedding_model || null }) });
      setCreateOpen(false); setForm({ name: '', description: '', embedding_model: '' }); setSelectedId(created.id);
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      toast.success('Knowledge base created', created.name);
    } catch (error) { toast.error('Could not create knowledge base', errorMessage(error)); }
    finally { setCreating(false); }
  }

  async function deleteKb() {
    if (!selectedId || !kb) return;
    if (!window.confirm(`Delete “${kb.name}” and its indexed sources?`)) return;
    try {
      await api(`/knowledge-bases/${selectedId}`, { method: 'DELETE' });
      setSelectedId(null); setSearch(null); setAnswer(null);
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      toast.success('Knowledge base deleted');
    } catch (error) { toast.error('Delete failed', errorMessage(error)); }
  }

  async function uploadDocument(file: File) {
    if (!selectedId) return;
    setUploading(true);
    try {
      const doc = await uploadFile<KnowledgeDocument>(`/knowledge-bases/${selectedId}/documents`, file);
      void queryClient.invalidateQueries({ queryKey: ['knowledge-base', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      toast[doc.status === 'failed' ? 'error' : 'success'](doc.status === 'failed' ? 'Extraction failed' : 'Document indexed', doc.error || `${doc.chunk_count} chunks`);
    } catch (error) { toast.error('Upload failed', errorMessage(error)); }
    finally { setUploading(false); }
  }

  async function deleteDocument(document: KnowledgeDocument) {
    if (!selectedId) return;
    try {
      await api(`/knowledge-bases/${selectedId}/documents/${document.id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-base', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      toast.success('Document removed');
    } catch (error) { toast.error('Could not remove document', errorMessage(error)); }
  }

  async function runSearch() {
    if (!selectedId || !query.trim()) return;
    setSearching(true);
    try { setSearch(await api<KnowledgeSearch>(`/knowledge-bases/${selectedId}/search`, { method: 'POST', body: JSON.stringify({ query, top_k: 6 }) })); }
    catch (error) { toast.error('Search failed', errorMessage(error)); }
    finally { setSearching(false); }
  }

  async function ask() {
    if (!selectedId || !question.trim()) return;
    setAsking(true); setAnswer(null);
    try {
      const result = await api<AskResult>(`/knowledge-bases/${selectedId}/ask`, { method: 'POST', body: JSON.stringify({ question, model_id: askModel, top_k: 6 }) });
      setAnswer(result);
    } catch (error) { toast.error('Could not answer', errorMessage(error)); }
    finally { setAsking(false); }
  }

  return (
    <ScrollPage>
      <PageHeader eyebrow="Retrieval with citations" title="Knowledge Bases" description="Index local documents, retrieve relevant passages, and ask questions with explicit source citations. Extraction errors are surfaced instead of silently skipped." actions={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus size={14} /> New knowledge base</Button>} />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2">
          {isLoading ? <Skeleton className="h-48" /> : kbs.length === 0 ? <EmptyState icon={<Library size={19} />} title="No knowledge bases" description="Create one, then upload TXT, Markdown, PDF, or DOCX files." action={<Button onClick={() => setCreateOpen(true)}>Create knowledge base</Button>} /> : kbs.map((item) => (
            <button key={item.id} onClick={() => { setSelectedId(item.id); setSearch(null); setAnswer(null); }} className={cn('w-full rounded-xl border p-3.5 text-left transition-colors', selectedId === item.id ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface/70 hover:bg-panel')}>
              <div className="flex items-center gap-2"><span className="rounded-md border border-line bg-raised p-1.5 text-accent-soft"><BookOpen size={13} /></span><p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-50">{item.name}</p></div>
              <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted">{item.description || 'No description'}</p>
              <div className="mt-2 flex gap-1"><Badge tone="neutral">{item.document_count} docs</Badge><Badge tone="neutral">{item.chunk_count} chunks</Badge>{item.embedding_model ? <Badge tone="accent">vector</Badge> : <Badge tone="neutral">lexical</Badge>}</div>
            </button>
          ))}
          <div className="rounded-xl border border-lineSoft bg-panel/40 p-4 text-[10px] leading-relaxed text-faint"><p className="font-medium text-muted">Retrieval modes</p><p className="mt-1">With an embedding model, chunks are scored by cosine similarity. Without one, VANTARA uses deterministic lexical scoring and labels results accordingly.</p></div>
        </div>

        {!selectedId ? <Panel className="flex items-center justify-center p-12 text-sm text-muted"><BookOpen size={18} className="mr-2" /> Select a knowledge base</Panel> : kbLoading || !kb ? <Skeleton className="h-96" /> : (
          <div className="space-y-4">
            <Panel className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-ink-50">{kb.name}</h2><p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-muted">{kb.description || 'No description'}</p><div className="mt-2 flex flex-wrap gap-1.5"><Badge tone="neutral">{kb.documents?.length ?? 0} documents</Badge><Badge tone="neutral">{kb.chunk_count} chunks</Badge><Badge tone={kb.embedding_model ? 'accent' : 'neutral'}>{kb.embedding_model ? `embeddings: ${kb.embedding_model.split('::').pop()}` : 'lexical retrieval'}</Badge></div></div><div className="flex gap-1.5"><input ref={fileRef} type="file" accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json,.log" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); event.target.value = ''; }} /><Button size="sm" onClick={() => fileRef.current?.click()} loading={uploading}><Upload size={13} /> Add source</Button><Button size="sm" variant="ghost" onClick={() => void deleteKb()}><Trash2 size={13} /></Button></div></div>
              <div className="mt-4 space-y-1.5">
                {!kb.documents?.length && <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">No sources yet. Upload a document to build the index.</p>}
                {(kb.documents ?? []).map((document) => (
                  <div key={document.id} className="flex items-start gap-2.5 rounded-lg border border-lineSoft bg-ink-950/30 px-3 py-2.5">
                    <FileText size={13} className="mt-0.5 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1"><p className="truncate text-[11.5px] text-ink-50">{document.name}</p><p className="mt-0.5 text-[10px] text-faint">{bytes(document.size_bytes)} · {document.chunk_count} chunks · {relativeTime(document.created_at)}</p>{document.error && <p className="mt-1 text-[10px] text-danger">{document.error}</p>}</div>
                    <Badge tone={document.status === 'indexed' ? 'success' : document.status === 'failed' ? 'danger' : document.status === 'indexed_lexical' ? 'warn' : 'neutral'}>{document.status === 'indexed_lexical' ? 'lexical only' : document.status}</Badge>
                    <button onClick={() => void deleteDocument(document)} className="rounded p-1 text-faint hover:text-danger" title="Remove source"><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            </Panel>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel className="p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-50"><Search size={14} className="text-accent-soft" /> Search passages</h3>
                <p className="mt-1 text-[11px] text-muted">Inspect exactly what retrieval returns. Sources are shown before any model answer.</p>
                <div className="mt-3 flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void runSearch()} placeholder="Search this knowledge base…" /><Button onClick={() => void runSearch()} loading={searching} disabled={!query.trim()}>Search</Button></div>
                {search && <div className="mt-3 space-y-2"><div className="flex items-center gap-1.5 text-[10px] text-faint"><Badge tone={search.mode === 'vector' ? 'accent' : 'neutral'}>{search.mode}</Badge><span>{search.results.length} result(s)</span></div>{search.results.map((hit) => <div key={`${hit.document_id}-${hit.ordinal}`} className="rounded-lg border border-lineSoft bg-ink-950/40 p-2.5"><div className="flex items-center justify-between gap-2"><span className="truncate text-[10px] font-medium text-accent-soft">{hit.citation}</span><span className="text-[9px] text-faint">score {hit.score}</span></div><p className="mt-1 line-clamp-4 text-[10.5px] leading-relaxed text-muted">{hit.content}</p></div>)}</div>}
                {!search && <p className="mt-6 text-center text-[11px] text-faint">Search results include document names and chunk indexes.</p>}
              </Panel>

              <Panel className="p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-50"><Sparkles size={14} className="text-accent-soft" /> Ask over documents</h3>
                <p className="mt-1 text-[11px] text-muted">The model is instructed to answer only from retrieved context and cite passages.</p>
                <div className="mt-3 space-y-2"><Textarea rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What do these documents say about…?" /><ModelPicker value={askModel} onChange={setAskModel} compact /><Button variant="primary" className="w-full" onClick={() => void ask()} loading={asking} disabled={!question.trim()}><Send size={13} /> Ask with citations</Button></div>
                {answer && <div className="mt-3 space-y-2"><div className="flex flex-wrap items-center gap-1.5"><Badge tone="success">answered</Badge><Badge tone={answer.mode === 'vector' ? 'accent' : 'neutral'}>{answer.mode} retrieval</Badge>{answer.runtime && <Badge tone="accent">{answer.runtime}</Badge>}</div><div className="rounded-lg border border-line bg-ink-950/40 p-3"><Markdown content={answer.answer} /></div><div className="space-y-1.5">{answer.sources.map((source, index) => <div key={`${source.document_id}-${source.ordinal}`} className="rounded-md border border-lineSoft px-2 py-1.5 text-[10px] text-muted"><span className="text-accent-soft">[{index + 1}]</span> {source.citation} · <span className="text-faint">score {source.score}</span></div>)}</div><p className="text-[9.5px] leading-relaxed text-faint">Retrieved text is treated as untrusted data. Verify citations against the original document.</p></div>}
              </Panel>
            </div>
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New knowledge base" description="Sources and vectors stay in the local data directory." footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void createKb()} loading={creating} disabled={!form.name.trim()}>Create</Button></>}>
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Product documentation" /></Field>
          <Field label="Description"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Field label="Embedding model (optional)" help="Leave empty for lexical retrieval. Choose a local embedding-capable model to enable vector search."><ModelPicker value={form.embedding_model || ''} onChange={(value) => setForm({ ...form, embedding_model: value })} allowAuto={false} allowNone /></Field>
          <div className="flex items-start gap-2 rounded-lg border border-lineSoft bg-ink-950/40 p-2.5 text-[10px] leading-relaxed text-faint"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" /> PDF and DOCX extraction require pypdf and python-docx. Scanned image-only PDFs may fail extraction; the error will be shown.</div>
        </div>
      </Modal>
    </ScrollPage>
  );
}
