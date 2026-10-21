import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { RuntimeStatus, InstalledModel, Agent, KnowledgeBase, StudioCapabilities, HardwareReport, ToolInfo } from './types';

export function useRuntimes(options?: { includeLocalModels?: boolean }) {
  return useQuery({
    queryKey: ['runtimes'],
    queryFn: () => api<{ runtimes: RuntimeStatus[] }>('/runtimes'),
    refetchInterval: 30_000,
    staleTime: 10_000,
    select: (data) => data.runtimes,
    ...(options?.includeLocalModels ? {} : {}),
  });
}

export function useLocalModels() {
  return useQuery({
    queryKey: ['local-models'],
    queryFn: () => api<{ models: import('./types').RuntimeModel[]; installed: InstalledModel[]; runtimes: RuntimeStatus[]; hardware: HardwareReport }>('/models/local'),
    refetchInterval: 20_000,
  });
}

export function useAgents() {
  return useQuery({ queryKey: ['agents'], queryFn: () => api<{ agents: Agent[] }>('/agents'), select: (d) => d.agents });
}

export function useAgentTools() {
  return useQuery({ queryKey: ['agent-tools'], queryFn: () => api<{ tools: ToolInfo[] }>('/agents/tools'), select: (d) => d.tools, staleTime: 300_000 });
}

export function useKnowledgeBases() {
  return useQuery({ queryKey: ['knowledge-bases'], queryFn: () => api<{ knowledge_bases: KnowledgeBase[] }>('/knowledge-bases'), select: (d) => d.knowledge_bases });
}

export function useStudios() {
  return useQuery({ queryKey: ['studios'], queryFn: () => api<StudioCapabilities>('/studios/capabilities'), refetchInterval: 60_000 });
}

export function useHardware() {
  return useQuery({ queryKey: ['hardware'], queryFn: () => api<HardwareReport>('/system/info'), staleTime: 60_000 });
}

export function useDownloads() {
  return useQuery({
    queryKey: ['downloads'],
    queryFn: () => api<{ downloads: import('./types').DownloadRecord[] }>('/downloads'),
    refetchInterval: 1500,
    select: (d) => d.downloads,
  });
}
