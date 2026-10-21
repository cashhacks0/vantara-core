export interface RuntimeModel {
  id: string;
  qualified_id: string;
  name: string;
  runtime: string;
  task: string;
  size_bytes: number;
  context_length?: number | null;
  quantization?: string | null;
  path?: string | null;
  repo_id?: string | null;
  metadata: Record<string, unknown>;
  runtime_available?: boolean;
  recommendation?: { fits: boolean | null; reason: string };
}

export interface RuntimeStatus {
  id: string;
  label: string;
  available: boolean;
  configured: boolean;
  version?: string | null;
  detail: string;
  error?: string | null;
  hint?: string | null;
  capabilities: string[];
  models: RuntimeModel[];
  local: boolean;
}

export interface Attachment {
  name: string;
  path: string;
  size_bytes: number;
  mime?: string | null;
  extracted_text?: string | null;
  extraction_error?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: string;
  model_id?: string | null;
  provider?: string | null;
  error?: string | null;
  attachments: Attachment[];
  tokens?: number | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  model_id?: string | null;
  system_prompt?: string | null;
  temperature: number;
  max_tokens: number;
  pinned: number;
  created_at: string;
  updated_at: string;
  message_count?: number;
  messages?: Message[];
}

export interface HfModel {
  id: string;
  author: string;
  downloads: number;
  likes: number;
  pipeline_tag: string;
  task: string;
  library?: string | null;
  tags: string[];
  license: string;
  updated_at?: string | null;
  created_at?: string | null;
  gated: boolean | string;
  private: boolean;
  gguf: boolean;
}

export interface HfFile {
  filename: string;
  size_bytes: number;
  sha256?: string | null;
  installed?: boolean;
  recommendation?: { fits: boolean | null; reason: string };
  runtime?: string;
}

export interface HfDetail extends HfModel {
  description?: string;
  siblings: HfFile[];
  gguf_files: HfFile[];
  formats: string[];
  readme?: string;
  card_data?: Record<string, unknown>;
  installed_files: string[];
  hardware?: { memory_available_bytes: number; gpus: Array<Record<string, unknown>> };
}

export interface CatalogPage {
  items: HfModel[];
  next_cursor?: string | null;
  count: number;
}

export interface DownloadRecord {
  id: string;
  repo_id: string;
  filename: string;
  status: string;
  total_bytes: number;
  downloaded_bytes: number;
  percent?: number | null;
  error?: string | null;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface InstalledModel {
  id: string;
  repo_id?: string | null;
  display_name: string;
  filename: string;
  path: string;
  size_bytes: number;
  runtime: string;
  task?: string | null;
  quantization?: string | null;
  license?: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  exists: boolean;
  runnable: boolean;
}

export interface PortSpec { name: string; type: string; required: boolean; description: string }
export interface ConfigField {
  key: string; label: string; type: string; default: unknown;
  options: string[]; help: string; required: boolean;
}
export interface NodeSpec {
  type: string; label: string; category: string; description: string;
  inputs: PortSpec[]; outputs: PortSpec[]; config: ConfigField[];
  requires: string[]; disabled: boolean;
}

export interface WorkflowNodeData {
  id: string; type: string; position: { x: number; y: number }; config: Record<string, unknown>;
}
export interface WorkflowEdge {
  id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null;
}
export interface WorkflowGraph { nodes: WorkflowNodeData[]; edges: WorkflowEdge[] }
export interface Workflow {
  id: string; name: string; description: string; graph: WorkflowGraph;
  node_count?: number; created_at: string; updated_at: string;
}
export interface WorkflowRun {
  id: string; workflow_id?: string | null; workflow_name?: string | null; status: string;
  started_at: string; finished_at?: string | null; error?: string | null;
  outputs: Record<string, unknown>; events: Array<Record<string, unknown>>; graph?: WorkflowGraph;
}

export interface ToolInfo {
  name: string; description: string; schema: Record<string, string>; modifies: boolean;
}
export interface Agent {
  id: string; name: string; description: string; system_prompt: string;
  model_id?: string | null; tools: string[]; max_steps: number;
  require_approval: boolean; created_at: string; updated_at: string;
}
export interface AgentStep {
  step: number; type: string; tool?: string; arguments?: Record<string, unknown>;
  observation?: unknown; text?: string;
}
export interface AgentRun {
  id: string; agent_id: string; agent_name?: string | null; status: string;
  input: string; steps: AgentStep[]; output?: string | null; error?: string | null;
  started_at: string; finished_at?: string | null; message?: string; tools?: string[];
}

export interface KnowledgeBase {
  id: string; name: string; description: string; embedding_model?: string | null;
  document_count: number; chunk_count: number; created_at: string; updated_at: string;
  documents?: KnowledgeDocument[];
}
export interface KnowledgeDocument {
  id: string; kb_id: string; name: string; size_bytes: number; status: string;
  error?: string | null; chunk_count: number; created_at: string;
}
export interface KnowledgeHit {
  document_id: string; document_name: string; ordinal: number; content: string;
  score: number; citation: string;
}
export interface KnowledgeSearch { results: KnowledgeHit[]; mode: string; query: string }

export interface Output {
  id: string; kind: string; name: string; path: string; mime?: string | null;
  meta: Record<string, unknown>; created_at: string; url: string; exists?: boolean;
}

export interface HardwareReport {
  os: { system: string; release: string; machine: string };
  python: string;
  cpu: { model: string; cores: number };
  memory: { total_bytes: number; available_bytes: number };
  gpus: Array<{ name: string; vendor: string; vram_total_bytes: number; backend: string }>;
  accelerators: Record<string, boolean>;
  disk: { total_bytes: number; free_bytes: number; used_bytes: number };
  inference_mode: string;
}

export interface DashboardData {
  counts: Record<string, number>;
  runtimes: RuntimeStatus[];
  recent_runs: Array<{ id: string; name: string; kind: string; status: string; started_at: string; finished_at?: string | null; error?: string | null }>;
  conversations: Array<{ id: string; title: string; updated_at: string }>;
  recent_outputs: Output[];
  downloads: DownloadRecord[];
  active_downloads: number;
  hardware: HardwareReport;
  local_only: boolean;
}

export interface StudioCapabilities {
  image: { available: boolean; reason: string; hint?: string | null; models: Array<{ path: string; name: string }> };
  audio: { available: boolean; speech_recognition: boolean; text_to_speech: boolean; reason: string; hint?: string | null };
  video: { available: boolean; reason: string; hint?: string | null };
}

export interface ProviderInfo {
  id: string; name: string; kind: string; base_url: string; enabled: boolean;
  has_key: boolean; key_hint?: string | null; created_at: string;
}
