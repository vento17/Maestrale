import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, useActivePageId } from '../../store';
import { bridge } from '../../ipc/bridge';

export default function Toolbar(): React.JSX.Element {
  const { setMode, openWidgetPicker, loadProject, project, openSettings, isSettingsOpen } = useStore(useShallow((s) => ({
    setMode: s.setMode,
    openWidgetPicker: s.openWidgetPicker,
    loadProject: s.loadProject,
    project: s.project,
    openSettings: s.openSettings,
    isSettingsOpen: s.isSettingsOpen,
  })));
  const activePageId = useActivePageId();

  async function handleSave() {
    await bridge.invoke('tr:project:save', project);
  }

  async function handleLoad() {
    const loaded = await bridge.invoke('tr:project:load', undefined as never);
    if (loaded) loadProject(loaded);
  }

  return (
    <div style={styles.bar}>
      <span style={styles.logo}>Maestrale</span>

      <div style={styles.group}>
        <ToolBtn onClick={openWidgetPicker}>+ Widget</ToolBtn>
      </div>

      <div style={styles.group}>
        <ToolBtn onClick={handleSave}>Save</ToolBtn>
        <ToolBtn onClick={handleLoad}>Load</ToolBtn>
      </div>

      <div style={{ flex: 1 }} />

      <ToolBtn onClick={openSettings} active={isSettingsOpen}>⚙ Settings</ToolBtn>

      <ToolBtn
        onClick={() => {
          if (activePageId) setMode('live');
        }}
        accent
      >
        ▶ Live
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  accent,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  active?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      ...styles.btn,
      ...(accent ? styles.btnAccent : {}),
      ...(active ? styles.btnActive : {}),
    }}>
      {children}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 50,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    background: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  logo: {
    fontWeight: 700,
    fontSize: 15,
    marginRight: 12,
    color: 'var(--color-accent)',
  },
  group: {
    display: 'flex',
    gap: 4,
    marginRight: 4,
  },
  btn: {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 12px',
    fontSize: 'var(--font-size-md)',
    cursor: 'pointer',
  },
  btnAccent: {
    background: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
    color: '#fff',
    fontWeight: 600,
  },
  btnActive: {
    background: 'var(--color-accent-dim)',
    borderColor: 'var(--color-accent)',
    color: 'var(--color-accent)',
  },
};
