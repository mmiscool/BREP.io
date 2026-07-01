export function createInspectorToggleButton(viewer) {
    const onClick = () => {
        try {
            viewer && viewer.toggleInspectorPanel && viewer.toggleInspectorPanel();
        } catch {
            // best effort
        }
    };
    return {
        label: '🕵️',
        title: 'Toggle Inspector panel',
        onClick
    };
}
