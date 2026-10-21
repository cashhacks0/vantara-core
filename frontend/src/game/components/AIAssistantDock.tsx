/** Docked AI assistant for the editor. Talks to the local model about the current scene. */
import { useEffect, useRef, useState } from 'react';
import { Bot, Info, Loader2, Send, Square } from 'lucide-react';
import { api, streamSSE } from '../../lib/api';
import type { Conversation, Message } from '../../lib/types';
import { ModelPicker } from '../../components/ModelPicker';
import { Markdown } from '../../components/Markdown';
import { Button, Textarea, cn } from '../../components/ui';
import { useGameStore } from '../state/store';

export function AIAssistantDock() {
  const spec = useGameStore((state) => state.spec);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const sceneSummary = spec
    ? `Scene: ${spec.name}. ${spec.objects.length} objects (${spec.objects.map((object) => object.name).slice(0, 12).join(', ')}). Materials: ${spec.materials.map((material) => material.name).join(', ')}.`
    : 'No scene loaded.';

  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    setBusy(true);
    setStatus('Preparing…');
    try {
      let id = conversationId;
      if (!id) {
        const created = await api<Conversation>('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'Scene assistant' }) });
        id = created.id;
        setConversationId(id);
      }
      const placeholder: Message = {
        id: `pending-${Date.now()}`, conversation_id: id, role: 'user', content: question,
        status: 'complete', attachments: [], created_at: new Date().toISOString(),
      };
      setMessages((current) => [...current, placeholder]);
      const controller = new AbortController();
      abortRef.current = controller;
      let answer = '';
      const assistantId = `pending-assistant-${Date.now()}`;
      setMessages((current) => [...current, {
        id: assistantId, conversation_id: id, role: 'assistant', content: '', status: 'streaming', attachments: [], created_at: new Date().toISOString(),
      }]);
      await streamSSE(`/api/conversations/${id}/stream`, {
        message: `${sceneSummary}\n\n${question}`,
        model_id: model,
        temperature: 0.5,
        max_tokens: 700,
      }, (event) => {
        const type = String(event.type || '');
        if (type === 'status') setStatus(String(event.message || ''));
        if (type === 'delta') {
          answer += String(event.content || '');
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: answer } : message));
        }
        if (type === 'error') {
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, status: 'error', error: String(event.error || '') } : message));
        }
        if (type === 'done') {
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: String(event.content || answer), status: 'complete' } : message));
        }
      }, controller.signal);
    } catch (error) {
      setMessages((current) => [...current, {
        id: `error-${Date.now()}`, conversation_id: conversationId ?? '', role: 'assistant',
        content: `The assistant could not answer: ${error instanceof Error ? error.message : 'unknown error'}`,
        status: 'error', attachments: [], created_at: new Date().toISOString(),
      }]);
    } finally {
      setBusy(false);
      setStatus('');
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-lineSoft px-3 py-2">
        <span className="rounded-md border border-line bg-raised p-1.5 text-accent-soft"><Bot size={12} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-ink-50">AI Assistant</p>
          <p className="text-[9px] text-faint">Local model · asks about this scene</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {messages.length === 0 && (
          <div className="rounded-lg border border-lineSoft bg-ink-950/50 p-2.5 text-[10px] leading-relaxed text-faint">
            <p className="flex items-center gap-1.5 font-medium text-muted"><Info size={11} /> Phase 1 scope</p>
            <p className="mt-1">The assistant can explain your scene and answer questions using a local model. Direct scene commands ("add a forest with a river") arrive in Phase 2 with full validation and undo.</p>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={cn('rounded-lg border p-2.5 text-[11px]', message.role === 'user' ? 'border-accent/20 bg-accent/5' : 'border-lineSoft bg-panel/50')}>
            {message.role === 'assistant' ? <Markdown content={message.content || (message.status === 'streaming' ? '_thinking…_' : '')} /> : <p className="whitespace-pre-wrap text-ink-50">{message.content}</p>}
            {message.status === 'error' && <p className="mt-1 text-[10px] text-danger">{message.error}</p>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-lineSoft p-2.5">
        <Textarea rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about this scene…" className="text-[11px]" />
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="min-w-0 flex-1"><ModelPicker value={model} onChange={setModel} compact /></div>
          {busy ? (
            <Button size="sm" variant="danger" onClick={() => abortRef.current?.abort()}><Square size={11} /> Stop</Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void send()} disabled={!input.trim()}><Send size={11} /> Ask</Button>
          )}
        </div>
        {busy && <p className="mt-1 flex items-center gap-1 text-[9.5px] text-muted"><Loader2 size={10} className="animate-spin" /> {status || 'Working locally…'}</p>}
      </div>
    </div>
  );
}
