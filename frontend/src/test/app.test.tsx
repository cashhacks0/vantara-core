import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const dashboard = {
  counts: { conversations: 2, workflows: 2, agents: 1, knowledge_bases: 1, outputs: 0, installed_models: 1, local_models: 1, active_runs: 0 },
  runtimes: [
    { id: 'llama.cpp', label: 'llama.cpp (GGUF)', available: true, configured: true, detail: 'Server idle', error: null, hint: null, capabilities: ['chat'], models: [{ id: 'm.gguf', qualified_id: 'llama.cpp::m.gguf', name: 'm', runtime: 'llama.cpp', task: 'text-generation', size_bytes: 1000, metadata: {} }], local: true },
    { id: 'ollama', label: 'Ollama', available: false, configured: true, detail: 'Not reachable', error: null, hint: null, capabilities: [], models: [], local: true },
  ],
  recent_runs: [{ id: 'run_1', name: 'Smoke flow', kind: 'workflow', status: 'completed', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), error: null }],
  conversations: [{ id: 'conv_1', title: 'Local models', updated_at: new Date().toISOString() }],
  recent_outputs: [],
  downloads: [],
  active_downloads: 0,
  hardware: {
    os: { system: 'Linux', release: 'x', machine: 'x86_64' }, python: '3.11.2',
    cpu: { model: 'Test CPU', cores: 4 }, memory: { total_bytes: 16e9, available_bytes: 8e9 },
    gpus: [], accelerators: { cuda: false, rocm: false, metal: false },
    disk: { total_bytes: 100e9, free_bytes: 50e9, used_bytes: 50e9 }, inference_mode: 'CPU',
  },
  local_only: true,
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/dashboard')) return new Response(JSON.stringify(dashboard), { status: 200 });
    if (url.includes('/api/runtimes')) return new Response(JSON.stringify({ runtimes: dashboard.runtimes }), { status: 200 });
    if (url.includes('/api/downloads')) return new Response(JSON.stringify({ downloads: [] }), { status: 200 });
    if (url.includes('/api/projects/kinds')) return new Response(JSON.stringify({ kinds: [{ value: 'static', label: 'Website / static app' }] }), { status: 200 });
    if (url.includes('/api/projects')) return new Response(JSON.stringify({ projects: [] }), { status: 200 });
    if (url.includes('/api/settings')) return new Response(JSON.stringify({ theme: 'dark', default_model: 'auto' }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

describe('VANTARA app shell', () => {
  beforeEach(() => { vi.stubGlobal('fetch', mockFetch()); });

  it('renders the AI Terminal workspace without a selected project', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/terminal']}><App /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText('No project selected')).toBeInTheDocument());
    expect(screen.getAllByText(/AI Terminal/i).length).toBeGreaterThan(0);
  });

  it('renders the dashboard with runtime health', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('VANTARA')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Your private AI workspace')).toBeInTheDocument());
    expect(screen.getAllByText('llama.cpp (GGUF)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Local engine online/i).length).toBeGreaterThan(0);
  });
});
