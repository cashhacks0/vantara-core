import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp, Bot, Check, Download, Edit3, FileText, History, Loader2,
  Paperclip, Plus, RefreshCw, Search, Settings2, Shield, Square, Trash2, X, Zap,
} from 'lucide-react';
import { api, ApiError, errorMessage, streamSSE, uploadFile } from '../lib/api';
import type { Attachment, Conversation, Message, RuntimeModel } from '../lib/types';
import { useLocalModels } from '../lib/queries';
import { ModelPicker } from '../components/ModelPicker';
import { Markdown } from '../components/Markdown';
import { Badge, Button, CopyButton, Field, Input, Modal, Progress, Spinner, Textarea, cn } from '../components/ui';
import { bytes, relativeTime } from '../lib/format';
import { toast } from '../lib/store';

interface ChatSettings { systemPrompt: string; temperature: number; maxTokens: number; contextWindow: number }

const SUGGESTIONS = [
  { title: 'Explain a concept', prompt: 'Explain how local LLM inference works, including quantization and memory use, for a developer new to it.' },
  { title: 'Write some code', prompt: 'Write a TypeScript function that debounces an async function and cancels stale calls. Include tests.' },
  { title: 'Summarize a document', prompt: 'I will attach a document. Summarize its key points and list any open questions.' },
  { title: 'Plan a workflow', prompt: 'Help me design a VANTARA workflow that summarizes uploaded PDFs and saves a Markdown report.' },
];

function pendingMessage(role: 'user' | 'assistant', content: string, extra?: Partial<Message>): Message {
  return {
    id: `pending-${Math.random().toString(36).slice(2)}`,
    conversation_id: '',
    role,
    content,
    status: role === 'assistant' ? 'streaming' : 'complete',
    attachments: [],
    created_at: new Date().toISOString(),
    ...extra,
  };
}

export function ChatPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: modelData } = useLocalModels();
  const { data: appSettings } = useQuery({ queryKey: ['settings'], queryFn: () => api<Record<string, unknown>>('/settings'), staleTime: 60_000 });

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('auto');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<{ error: string; hint?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>({ systemPrompt: '', temperature: 0.7, maxTokens: 1024, contextWindow: 4096 });
  const [search, setSearch] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [dragging, setDragging] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef<string | null>(null);
  const appliedDefaultModel = useRef(false);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<{ conversations: Conversation[] }>('/conversations'),
    select: (data) => data.conversations,
    refetchInterval: 20_000,
  });

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConversation(true);
    try {
      const data = await api<Conversation>(`/conversations/${id}`);
      setConversation(data);
      setMessages(data.messages ?? []);
      setModel(data.model_id || 'auto');
      setSettings((current) => ({ ...current, systemPrompt: data.system_prompt || '', temperature: data.temperature ?? 0.7, maxTokens: data.max_tokens ?? 1024 }));
      loadedRef.current = id;
    } catch (error) {
      toast.error('Could not load conversation', errorMessage(error));
      navigate('/chat', { replace: true });
    } finally {
      setLoadingConversation(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (conversationId) {
      if (loadedRef.current !== conversationId) void loadConversation(conversationId);
    } else {
      setConversation(null);
      setMessages([]);
      setDraft('');
      setAttachments([]);
      setModel('auto');
      setStreamError(null);
      loadedRef.current = null;
    }
  }, [conversationId, loadConversation]);

  useEffect(() => {
    if (!appliedDefaultModel.current && !conversationId && appSettings?.default_model) {
      setModel(String(appSettings.default_model));
      appliedDefaultModel.current = true;
    }
  }, [appSettings, conversationId]);

  useEffect(() => {
    const runtime = modelData?.models.find((item) => item.qualified_id === model) ?? modelData?.models.find((item) => item.qualified_id === conversation?.model_id);
    setSettings((current) => ({ ...current, contextWindow: runtime?.context_length || 4096 }));
  }, [model, modelData, conversation?.model_id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'end' });
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const filteredConversations = useMemo(() => {
    if (!search.trim()) return conversations;
    const term = search.toLowerCase();
    return conversations.filter((item) => item.title.toLowerCase().includes(term));
  }, [conversations, search]);

  const contextTokens = useMemo(() => Math.round(messages.reduce((sum, message) => sum + message.content.length, 0) / 4), [messages]);
  const contextPercent = Math.min(100, (contextTokens / Math.max(512, settings.contextWindow)) * 100);

  const refreshConversations = () => queryClient.invalidateQueries({ queryKey: ['conversations'] });

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 4 - attachments.length);
    if (!list.length) return;
    setUploading(true);
    for (const file of list) {
      if (file.size > 25 * 1024 * 1024) { toast.error('File too large', `${file.name} exceeds 25 MB.`); continue; }
      try {
        const uploaded = await uploadFile<Attachment>('/uploads', file);
        setAttachments((current) => [...current, uploaded]);
        if (uploaded.extraction_error) toast.info('File attached', `${file.name}: ${uploaded.extraction_error}`);
      } catch (error) {
        toast.error('Upload failed', errorMessage(error));
      }
    }
    setUploading(false);
  }

  async function persistSettings(next: ChatSettings) {
    if (!conversation) return;
    try {
      await api(`/conversations/${conversation.id}`, { method: 'PUT', body: JSON.stringify({ system_prompt: next.systemPrompt, temperature: next.temperature, max_tokens: next.maxTokens }) });
      setConversation((current) => current ? { ...current, system_prompt: next.systemPrompt, temperature: next.temperature, max_tokens: next.maxTokens } : current);
      toast.success('Conversation settings saved');
    } catch (error) { toast.error('Could not save settings', errorMessage(error)); }
  }

  async function streamReply(options: {
    conv: Conversation;
    baseMessages: Message[];
    modelId: string;
    attachmentList?: Attachment[];
    userText?: string;
    replaceMessageId?: string;
    regenerateMessageId?: string;
  }) {
    const { conv, baseMessages, modelId, attachmentList = [], userText, replaceMessageId, regenerateMessageId } = options;
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setStreamError(null);
    setBusyStatus('Preparing request…');

    const userMessage = userText !== undefined ? pendingMessage('user', userText, { conversation_id: conv.id, attachments: attachmentList }) : null;
    let assistantId = `pending-assistant-${Date.now()}`;
    const placeholder: Message = pendingMessage('assistant', '', { id: assistantId, conversation_id: conv.id, model_id: modelId });
    setMessages([...baseMessages, ...(userMessage ? [userMessage] : []), placeholder]);

    let accumulated = '';
    let finished = false;
    try {
      await streamSSE(
        `/conversations/${conv.id}/stream`,
        {
          message: userText ?? null,
          model_id: modelId,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          attachments: attachmentList,
          replace_message_id: replaceMessageId ?? null,
          regenerate_message_id: regenerateMessageId ?? null,
        },
        (event) => {
          const type = String(event.type || '');
          if (type === 'meta' && event.assistant_message_id) {
            const newId = String(event.assistant_message_id);
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, id: newId } : message));
            assistantId = newId;
          } else if (type === 'status') {
            setBusyStatus(String(event.message || ''));
          } else if (type === 'started') {
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, provider: String(event.runtime || ''), model_id: String((event.model as RuntimeModel | undefined)?.id ?? modelId) } : message));
          } else if (type === 'delta') {
            accumulated += String(event.content || '');
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: accumulated, status: 'streaming' } : message));
          } else if (type === 'notice') {
            toast.info('Remote provider', String(event.notice || 'This request is being sent to a remote provider.'));
          } else if (type === 'done') {
            finished = true;
            accumulated = String(event.content ?? accumulated);
            setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: accumulated, status: 'complete', provider: String(event.runtime || message.provider || ''), error: null } : message));
            setBusyStatus(null);
          } else if (type === 'error') {
            const message = String(event.error || 'Generation failed.');
            setStreamError({ error: message, hint: event.hint ? String(event.hint) : undefined });
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, status: 'error', error: message, content: accumulated || String(event.partial_content || '') } : item));
            setBusyStatus(null);
          }
        },
        controller.signal,
      );
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, status: 'cancelled', error: 'Generation stopped by the user.', content: accumulated } : message));
      } else {
        setStreamError({ error: errorMessage(error), hint: error instanceof ApiError ? error.hint : undefined });
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, status: 'error', error: errorMessage(error) } : message));
      }
    } finally {
      if (!finished && accumulated && !streamError) {
        setMessages((current) => current.map((message) => message.id === assistantId && message.status === 'streaming' ? { ...message, status: 'cancelled' } : message));
      }
      abortRef.current = null;
      setStreaming(false);
      setBusyStatus(null);
      void refreshConversations();
      if (loadedRef.current !== conv.id) {
        loadedRef.current = conv.id;
        navigate(`/chat/${conv.id}`, { replace: true });
      }
    }
  }

  async function sendMessage(text?: string) {
    const content = (text ?? draft).trim();
    if (!content || streaming) return;
    let conv = conversation;
    try {
      if (!conv) {
        conv = await api<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ title: content.slice(0, 60), model_id: model === 'auto' ? null : model }) });
        setConversation(conv);
      }
      const baseMessages = messages;
      const attachmentList = attachments;
      setDraft('');
      setAttachments([]);
      await streamReply({ conv, baseMessages, modelId: model, attachmentList, userText: content });
    } catch (error) {
      toast.error('Could not send message', errorMessage(error));
      setStreaming(false);
    }
  }

  async function regenerate() {
    if (streaming || !conversation) return;
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistant || lastAssistant.id.startsWith('pending-')) return;
    const index = messages.findIndex((message) => message.id === lastAssistant.id);
    const base = messages.slice(0, index);
    setStreamError(null);
    await streamReply({ conv: conversation, baseMessages: base, modelId: model, regenerateMessageId: lastAssistant.id });
  }

  async function submitEdit(message: Message) {
    if (!conversation || !editDraft.trim()) return;
    const index = messages.findIndex((item) => item.id === message.id);
    const base = messages.slice(0, index).map((item) => item.id === message.id ? { ...item, content: editDraft } : item);
    setEditingId(null);
    setStreamError(null);
    await streamReply({ conv: conversation, baseMessages: base, modelId: model, replaceMessageId: message.id, userText: undefined });
  }

  function stopGeneration() { abortRef.current?.abort(); }

  async function renameConversation() {
    if (!conversation || !titleDraft.trim()) { setRenaming(false); return; }
    try {
      const updated = await api<Conversation>(`/conversations/${conversation.id}`, { method: 'PUT', body: JSON.stringify({ title: titleDraft.trim() }) });
      setConversation(updated);
      setRenaming(false);
      void refreshConversations();
    } catch (error) { toast.error('Rename failed', errorMessage(error)); }
  }

  async function removeConversation(target: Conversation) {
    try {
      await api(`/conversations/${target.id}`, { method: 'DELETE' });
      setDeleteOpen(false);
      setDeleteTarget(null);
      void refreshConversations();
      if (target.id === conversation?.id) navigate('/chat', { replace: true });
      toast.success('Conversation deleted');
    } catch (error) { toast.error('Delete failed', errorMessage(error)); }
  }

  const isEmpty = messages.length === 0;
  const canSend = Boolean(draft.trim()) && !streaming;

  function settingsPanel() {
    return (
      <div className="space-y-5">
        <div><h3 className="text-sm font-semibold text-ink-50">Conversation controls</h3><p className="mt-0.5 text-[11px] leading-relaxed text-muted">Saved per conversation. Local inference has no VANTARA message quota.</p></div>
        <Field label="System instructions" help="Overrides the default VANTARA system prompt for this conversation.">
          <Textarea rows={5} value={settings.systemPrompt} placeholder="You are VANTARA…" onChange={(event) => setSettings((current) => ({ ...current, systemPrompt: event.target.value }))} />
        </Field>
        <Field label={`Temperature · ${settings.temperature.toFixed(2)}`} help="Lower is more deterministic; higher is more exploratory.">
          <input type="range" min={0} max={2} step={0.05} value={settings.temperature} onChange={(event) => setSettings((current) => ({ ...current, temperature: Number(event.target.value) }))} className="w-full accent-[#8b5cf6]" />
        </Field>
        <Field label="Maximum output tokens">
          <Input type="number" min={16} max={8192} value={settings.maxTokens} onChange={(event) => setSettings((current) => ({ ...current, maxTokens: Math.max(16, Math.min(8192, Number(event.target.value) || 16)) }))} />
        </Field>
        <div className="rounded-lg border border-lineSoft bg-ink-950/50 p-3">
          <div className="flex items-center justify-between text-[11px] text-muted"><span>Estimated context</span><span className="font-mono">{contextTokens.toLocaleString()} / {settings.contextWindow.toLocaleString()} tok</span></div>
          <Progress className="mt-2" value={contextPercent} />
          <p className="mt-1.5 text-[10px] leading-relaxed text-faint">Rough estimate from character count; the runtime enforces its own context window.</p>
        </div>
        <div className="space-y-2 rounded-lg border border-lineSoft bg-ink-950/50 p-3 text-[11px] text-muted">
          <p className="flex items-center gap-1.5 text-ink-50"><Shield size={12} className="text-success" /> Local by default</p>
          <p className="leading-relaxed">Prompts are sent only to the selected runtime. A remote provider is used only when you explicitly select one.</p>
        </div>
        <Button variant="primary" className="w-full" disabled={!conversation} onClick={() => void persistSettings(settings)}><Check size={14} /> Save settings</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-ink">
      {showHistory && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setShowHistory(false)} />}
      <aside className={cn('absolute inset-y-0 left-0 z-40 flex w-[272px] shrink-0 flex-col border-r border-lineSoft bg-ink-950/95 backdrop-blur transition-transform lg:static lg:z-auto lg:translate-x-0', showHistory ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-2 border-b border-lineSoft p-3">
          <Button variant="primary" className="flex-1 justify-start" onClick={() => { navigate('/chat'); setShowHistory(false); }}><Plus size={14} /> New conversation</Button>
          <button className="rounded-md p-2 text-muted hover:bg-raised lg:hidden" onClick={() => setShowHistory(false)} aria-label="Close history"><X size={15} /></button>
        </div>
        <div className="p-3">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" className="h-8 pl-8 text-xs" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {filteredConversations.length === 0 && <p className="px-2 py-4 text-[11px] text-faint">No conversations yet.</p>}
          {filteredConversations.map((item) => (
            <div key={item.id} className={cn('group relative flex items-center rounded-lg', item.id === conversationId || item.id === conversation?.id ? 'bg-accent/10 ring-1 ring-inset ring-accent/20' : 'hover:bg-raised/60')}>
              <Link to={`/chat/${item.id}`} className="min-w-0 flex-1 px-2.5 py-2.5" onClick={() => setShowHistory(false)}>
                <p className="truncate text-[12px] font-medium text-ink-50">{item.title}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-faint"><span>{relativeTime(item.updated_at)}</span>{item.message_count !== undefined && <><span>·</span><span>{item.message_count} msgs</span></>}</p>
              </Link>
              <div className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button className="rounded p-1.5 text-faint hover:bg-raised hover:text-ink-50" onClick={() => { setDeleteTarget(item); setDeleteOpen(true); }} aria-label={`Delete ${item.title}`}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-lineSoft p-3 text-[10px] leading-relaxed text-faint">
          <p className="flex items-center gap-1.5 text-muted"><Zap size={11} className="text-accent-soft" /> {modelData?.models.length ?? 0} local model(s) available</p>
          <p className="mt-1">History is stored in your local SQLite database.</p>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-lineSoft px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button className="rounded-md p-1.5 text-muted hover:bg-raised lg:hidden" onClick={() => setShowHistory(true)} aria-label="Conversation history"><History size={17} /></button>
            <div className="min-w-0">
              {renaming ? (
                <form onSubmit={(event) => { event.preventDefault(); void renameConversation(); }} className="flex items-center gap-1.5">
                  <Input autoFocus value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void renameConversation()} className="h-7 w-56 text-xs" maxLength={120} />
                </form>
              ) : (
                <button className="group flex min-w-0 items-center gap-2 text-left" onClick={() => { if (conversation) { setTitleDraft(conversation.title); setRenaming(true); } }} title="Rename conversation">
                  <span className="truncate text-[13px] font-semibold text-ink-50">{conversation?.title ?? 'New conversation'}</span>
                  {conversation && <Edit3 size={11} className="shrink-0 text-faint opacity-0 group-hover:opacity-100" />}
                </button>
              )}
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-faint">
                <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" /> Local runtime</span>
                <span>·</span><span>Streaming</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {conversation && <a href={`/api/conversations/${conversation.id}/export?format=markdown`} className="rounded-md p-2 text-muted hover:bg-raised hover:text-ink-50" title="Export Markdown"><Download size={15} /></a>}
            <button className={cn('rounded-md p-2 text-muted hover:bg-raised hover:text-ink-50', settingsOpen && 'bg-raised text-accent-soft')} onClick={() => setSettingsOpen((value) => !value)} title="Conversation settings"><Settings2 size={15} /></button>
            {conversation && <button className="rounded-md p-2 text-muted hover:bg-raised hover:text-danger" onClick={() => { setDeleteTarget(conversation); setDeleteOpen(true); }} title="Delete conversation"><Trash2 size={15} /></button>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
            {loadingConversation ? (
              <div className="flex items-center justify-center py-24 text-muted"><Spinner className="mr-2" /> Loading conversation…</div>
            ) : isEmpty ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center py-10 text-center animate-fadeUp">
                <div className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10">
                  <span className="h-5 w-5 rounded-md bg-gradient-to-br from-accent-soft to-electric" />
                  <span className="absolute inset-0 rounded-2xl shadow-glow" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-soft/80">VANTARA</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink-50">What should we build today?</h2>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">Ask questions, analyze files, write code, design workflows, or reason through a problem — all through a model running on this machine.</p>
                <div className="mt-6 grid w-full max-w-xl gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button key={suggestion.title} onClick={() => void sendMessage(suggestion.prompt)} className="group rounded-xl border border-line bg-panel/60 p-3.5 text-left transition-colors hover:border-accent/30 hover:bg-panel">
                      <p className="text-xs font-medium text-ink-50">{suggestion.title}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{suggestion.prompt}</p>
                    </button>
                  ))}
                </div>
                {!modelData?.models.length && (
                  <div className="mt-5 flex items-center gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-[11px] text-warn"><Zap size={13} /> No local model detected. <Link to="/local-models" className="underline">Install one to start chatting.</Link></div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => {
                  const isUser = message.role === 'user';
                  const isLastAssistant = message.role === 'assistant' && message.id === [...messages].reverse().find((item) => item.role === 'assistant')?.id;
                  if (isUser) {
                    return (
                      <div key={message.id} className="group flex flex-col items-end animate-fadeUp">
                        {editingId === message.id ? (
                          <div className="w-full max-w-2xl rounded-xl border border-accent/30 bg-panel p-3">
                            <Textarea autoFocus rows={3} value={editDraft} onChange={(event) => setEditDraft(event.target.value)} />
                            <div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={() => void submitEdit(message)}>Save & resend</Button></div>
                          </div>
                        ) : (
                          <div className="max-w-[85%] rounded-2xl rounded-br-md border border-accent/20 bg-accent/10 px-4 py-2.5 text-[13.5px] leading-6 text-ink-50 whitespace-pre-wrap">{message.content}</div>
                        )}
                        {message.attachments.length > 0 && (
                          <div className="mt-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
                            {message.attachments.map((attachment) => (
                              <span key={attachment.path} className="chip max-w-[220px]"><FileText size={10} className="shrink-0" /><span className="truncate">{attachment.name}</span><span className="text-faint">{bytes(attachment.size_bytes)}</span></span>
                            ))}
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <CopyButton text={message.content} />
                          <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:bg-raised hover:text-ink-50" onClick={() => { setEditingId(message.id); setEditDraft(message.content); }}><Edit3 size={11} /> Edit</button>
                          <span className="text-[10px] text-faint">{relativeTime(message.created_at)}</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={message.id} className="group flex gap-3 animate-fadeUp">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-accent-soft"><Bot size={14} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-ink-50">VANTARA</span>
                          {message.status === 'streaming' && <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-accent" />}
                          {message.status === 'cancelled' && <Badge tone="warn">stopped</Badge>}
                          {message.status === 'error' && <Badge tone="danger">error</Badge>}
                          <span className="ml-auto text-[10px] text-faint">{relativeTime(message.created_at)}</span>
                        </div>
                        {message.content ? <Markdown content={message.content} /> : message.status === 'streaming' ? (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2 text-[11px] text-muted"><Loader2 size={12} className="animate-spin text-accent-soft" /> {busyStatus ?? 'Generating locally…'}</div>
                            <div className="space-y-1.5"><div className="h-2.5 w-3/4 animate-pulse rounded bg-raised" /><div className="h-2.5 w-1/2 animate-pulse rounded bg-raised" /></div>
                          </div>
                        ) : null}
                        {message.status === 'streaming' && message.content && <span className="ml-0.5 inline-block h-4 w-1.5 animate-caret rounded-sm bg-accent align-middle" />}
                        {message.error && message.status !== 'cancelled' && (
                          <div className="mt-2 rounded-lg border border-danger/25 bg-danger/5 p-3">
                            <p className="text-xs text-danger">{message.error}</p>
                            {streamError?.hint && <p className="mt-1 text-[11px] text-muted">{streamError.hint}</p>}
                            <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void regenerate()}><RefreshCw size={11} /> Retry</Button><Link to="/local-models"><Button size="sm" variant="ghost">Check runtimes</Button></Link></div>
                          </div>
                        )}
                        {(message.status === 'complete' || message.status === 'cancelled') && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                            <CopyButton text={message.content} />
                            {isLastAssistant && !streaming && <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted hover:bg-raised hover:text-ink-50" onClick={() => void regenerate()}><RefreshCw size={11} /> Regenerate</button>}
                            {message.model_id && <span className="chip max-w-[260px] truncate">{message.model_id.replace(/\.gguf$/i, '')}</span>}
                            {message.provider && <Badge tone={message.provider === 'remote' ? 'warn' : 'accent'}>{message.provider}</Badge>}
                            {message.tokens ? <span className="text-[10px] text-faint">~{message.tokens} tokens</span> : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-lineSoft bg-ink-950/70 px-3 py-3 sm:px-4">
          <div className="mx-auto w-full max-w-3xl">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((attachment) => (
                  <span key={attachment.path} className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-muted">
                    <FileText size={11} className="shrink-0 text-accent-soft" />
                    <span className="truncate">{attachment.name}</span>
                    <span className="text-faint">{bytes(attachment.size_bytes)}</span>
                    <button onClick={() => setAttachments((current) => current.filter((item) => item.path !== attachment.path))} className="ml-1 text-faint hover:text-danger" aria-label={`Remove ${attachment.name}`}><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            <div
              className={cn('rounded-xl border bg-surface p-2 transition-colors', dragging ? 'border-accent/60 bg-accent/5' : 'border-line focus-within:border-accent/40')}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files); }}
            >
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => { setDraft(event.target.value); const el = event.target; el.style.height = 'auto'; el.style.height = `${Math.min(180, el.scrollHeight)}px`; }}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend) void sendMessage(); } }}
                rows={1}
                placeholder={dragging ? 'Drop files to attach…' : 'Message VANTARA — Enter to send, Shift+Enter for a new line'}
                className="max-h-[180px] min-h-[40px] w-full resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-6 text-ink-50 placeholder:text-faint"
                aria-label="Message"
              />
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) void handleFiles(event.target.files); event.target.value = ''; }} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading || attachments.length >= 4} className="rounded-md p-2 text-muted hover:bg-raised hover:text-ink-50 disabled:opacity-40" title="Attach files">{uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}</button>
                <div className="min-w-[150px] max-w-[260px] flex-1"><ModelPicker value={model} onChange={setModel} compact includeRemote={Boolean(appSettings?.remote_providers_enabled)} /></div>
                <span className="hidden items-center gap-1 text-[10px] text-faint sm:flex"><Shield size={10} /> {model.startsWith('remote::') ? 'remote' : 'local'}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="hidden text-[10px] text-faint md:inline">{contextPercent.toFixed(0)}% context</span>
                  {streaming ? (
                    <Button variant="danger" size="sm" onClick={stopGeneration} className="h-9"><Square size={13} /> Stop</Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => void sendMessage()} disabled={!canSend} className="h-9 px-3" title="Send message"><ArrowUp size={16} /></Button>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[10px] text-faint">
              <span className="truncate">{busyStatus ?? (model.startsWith('remote::') ? 'Remote inference · data leaves this machine' : 'Local inference · no VANTARA message quota')}</span>
              <span className="hidden shrink-0 sm:inline">Verify important outputs · models can be wrong</span>
            </div>
          </div>
        </div>
      </section>

      {settingsOpen && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50 xl:hidden" onClick={() => setSettingsOpen(false)} />
          <aside className="fixed inset-y-0 right-0 z-40 w-[320px] overflow-y-auto border-l border-lineSoft bg-ink-950/95 p-4 backdrop-blur xl:static xl:z-auto xl:w-[300px] xl:bg-transparent xl:backdrop-blur-none">
            <div className="mb-3 flex items-center justify-between xl:hidden"><p className="text-sm font-semibold text-ink-50">Settings</p><button onClick={() => setSettingsOpen(false)} className="rounded p-1 text-muted hover:text-ink-50" aria-label="Close settings"><X size={16} /></button></div>
            {settingsPanel()}
          </aside>
        </>
      )}

      <Modal
        open={deleteOpen} onClose={() => { setDeleteOpen(false); setDeleteTarget(null); }}
        title="Delete conversation" description="This removes the conversation and its messages from local storage."
        footer={<><Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => deleteTarget && void removeConversation(deleteTarget)}><Trash2 size={13} /> Delete</Button></>}
      >
        <p className="text-[13px] text-muted">Are you sure you want to delete <span className="text-ink-50">“{deleteTarget?.title}”</span>? This cannot be undone.</p>
      </Modal>
    </div>
  );
}
