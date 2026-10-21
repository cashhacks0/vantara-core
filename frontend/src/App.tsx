import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ChatPage } from './pages/ChatPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { WorkflowEditorPage } from './pages/WorkflowEditorPage';
import { ModelLibraryPage } from './pages/ModelLibraryPage';
import { LocalModelsPage } from './pages/LocalModelsPage';
import { ImageStudioPage } from './pages/ImageStudioPage';
import { AudioStudioPage } from './pages/AudioStudioPage';
import { VideoStudioPage } from './pages/VideoStudioPage';
import { AgentsPage } from './pages/AgentsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { RunsPage } from './pages/RunsPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="chat/:conversationId" element={<ChatPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="workflows/:workflowId" element={<WorkflowEditorPage />} />
        <Route path="models" element={<ModelLibraryPage />} />
        <Route path="local-models" element={<LocalModelsPage />} />
        <Route path="image-studio" element={<ImageStudioPage />} />
        <Route path="audio-studio" element={<AudioStudioPage />} />
        <Route path="video-studio" element={<VideoStudioPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
