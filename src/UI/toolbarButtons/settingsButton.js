export function createSettingsButton(viewer) {
  return {
    label: '⚙',
    title: 'Settings',
    global: true,
    onClick: () => {
      try { viewer?.openSettingsDialog?.(); } catch { }
    },
  };
}
