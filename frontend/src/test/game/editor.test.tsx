import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEditorPage } from '../../pages/GameEditorPage';
import { useGameStore } from '../../game/state/store';

// The 3D canvas needs WebGL, which jsdom does not provide, so the viewport is stubbed.
// Everything around it (toolbar, outliner, details, content browser) is exercised for real.
vi.mock('../../game/components/Viewport', () => ({
  Viewport: () => <div data-testid="viewport-stub" className="h-full w-full" />,
}));

function resetStore() {
  useGameStore.setState({
    projects: [], project: null, spec: null, selection: [], history: [], future: [],
    dirty: false, loading: false, error: null,
  });
}

describe('game editor shell', () => {
  beforeEach(() => { resetStore(); });

  it('opens a project, adds an object, undoes it and saves', async () => {
    const projectId = await useGameStore.getState().createProject('Editor Test', 'sample');
    resetStore();

    render(
      <MemoryRouter initialEntries={[`/editor/${projectId}`]}>
        <Routes><Route path="/editor/:projectId" element={<GameEditorPage />} /></Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Editor Test')).toBeInTheDocument());
    expect(screen.getByTestId('viewport-stub')).toBeInTheDocument();
    expect(screen.getByText('Outliner')).toBeInTheDocument();
    expect(screen.getByText('Content Browser')).toBeInTheDocument();
    // The sample scene is listed in the outliner.
    expect(screen.getByText('Ground')).toBeInTheDocument();

    const before = useGameStore.getState().spec?.objects.length ?? 0;
    screen.getByRole('button', { name: 'Sphere' }).click();
    await waitFor(() => expect(useGameStore.getState().spec?.objects.length).toBe(before + 1));
    expect(screen.getAllByText('Sphere').length).toBeGreaterThan(0);

    // Undo removes it again.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await waitFor(() => expect(useGameStore.getState().spec?.objects.length).toBe(before));

    // Save clears the dirty flag.
    screen.getByRole('button', { name: 'Sphere' }).click();
    await waitFor(() => expect(useGameStore.getState().dirty).toBe(true));
    screen.getByRole('button', { name: /Save/i }).click();
    await waitFor(() => expect(useGameStore.getState().dirty).toBe(false));
  });

  it('shows the details panel for the selected object', async () => {
    const projectId = await useGameStore.getState().createProject('Details Test', 'sample');
    resetStore();
    render(
      <MemoryRouter initialEntries={[`/editor/${projectId}`]}>
        <Routes><Route path="/editor/:projectId" element={<GameEditorPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Details Test')).toBeInTheDocument());
    screen.getByText('Ground').click();
    await waitFor(() => expect(screen.getByDisplayValue('Ground')).toBeInTheDocument());
    expect(screen.getByText('Transform')).toBeInTheDocument();
    expect(screen.getByText('Material')).toBeInTheDocument();
  });
});
