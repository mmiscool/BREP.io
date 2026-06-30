export function ensureSelectionPickerStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('selection-picker-styles')) return;
    const style = document.createElement('style');
    style.id = 'selection-picker-styles';
    style.textContent = `
        :root {
            --sfw-bg: #121519;
            --sfw-border: #1c2128;
            --sfw-shadow: rgba(0,0,0,0.35);
            --sfw-text: #d6dde6;
            --sfw-accent: #7aa2f7;
            --sfw-muted: #8b98a5;
            --sfw-control-height: 25px;
        }
        .selection-picker {
            position: fixed;
            min-width: 240px;
            max-width: 500px;
            max-height: 260px;
            overflow: hidden;
            background: linear-gradient(180deg, rgba(18,21,25,0.96), rgba(18,21,25,0.90));
            border: 1px solid var(--sfw-border);
            border-radius: 10px;
            box-shadow: 0 12px 30px var(--sfw-shadow);
            color: var(--sfw-text);
            padding: 10px;
            z-index: 1200;
            backdrop-filter: blur(6px);
            opacity: 0.8;
            transition: opacity .15s ease, transform .08s ease;
        }
        .selection-picker.is-hovered,
        .selection-picker.dragging {
            opacity: 1;
        }
        .selection-picker.dragging {
            cursor: grabbing;
        }
        .selection-picker__title {
            font-weight: 700;
            color: var(--sfw-muted);
            letter-spacing: .3px;
            cursor: grab;
            user-select: none;
            border: 1px solid var(--sfw-border);
            border-radius: 8px;
            padding: 0 10px;
            background: rgba(255,255,255,0.05);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
            flex: 1 1 auto;
            min-height: var(--sfw-control-height);
            display: flex;
            align-items: center;
        }
        .selection-picker__header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }
        .selection-picker__clear {
            flex: 0 0 auto;
            border-radius: 8px;
            border: 1px solid var(--sfw-border);
            background: rgba(255,255,255,0.08);
            color: var(--sfw-text);
            font-weight: 700;
            padding: 0 12px;
            cursor: pointer;
            transition: background .12s ease, border-color .12s ease, transform .05s ease;
            min-height: var(--sfw-control-height);
            display: flex;
            align-items: center;
        }
        .selection-picker__clear:hover {
            background: rgba(122,162,247,0.12);
            border-color: var(--sfw-accent);
        }
        .selection-picker__clear:active {
            transform: translateY(1px);
        }
        .selection-picker__list {
            display: flex;
            flex-direction: column;
            gap: 6px;
            max-height: 100px;
            overflow: auto;
            padding-top: 3px;
            padding-right: 4px;
        }
        .selection-picker__item {
            width: 100%;
            text-align: left;
            border: 1px solid var(--sfw-border);
            background: rgba(255,255,255,0.04);
            color: var(--sfw-text);
            border-radius: 8px;
            padding: 8px 10px;
            cursor: pointer;
            transition: border-color .12s ease, transform .08s ease, background .12s ease;
        }
        .selection-picker__item:hover {
            border-color: var(--sfw-accent);
            background: rgba(122,162,247,0.10);
            transform: translateY(-1px);
        }
        .selection-picker__item-label { font-weight: 700; }
        .selection-picker__line {
            display: flex;
            gap: 8px;
            align-items: center;
            overflow: hidden;
        }
        .selection-picker__type {
            font-weight: 700;
            color: var(--sfw-muted);
            flex: 0 0 auto;
        }
        .selection-picker__name {
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
}

export function ensureSidebarResizerStyles() {
    if (typeof document === 'undefined') return;
    let style = document.getElementById('sidebar-resizer-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'sidebar-resizer-styles';
        document.head.appendChild(style);
    }
    style.textContent = `
        #sidebar-resizer {
            position: fixed;
            top: 0;
            width: 10px;
            height: 100%;
            cursor: ew-resize;
            z-index: 8;
            touch-action: none;
        }
        #sidebar-resizer::after {
            content: '';
            position: absolute;
            top: 0;
            left: 50%;
            width: 2px;
            height: 100%;
            transform: translateX(-50%);
            background: linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.3), rgba(255,255,255,0.05));
            opacity: 0.5;
        }
        #sidebar-resizer.is-active::after,
        #sidebar-resizer:hover::after {
            opacity: 0.9;
        }
    `;
}

export function ensureSidebarDockStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('sidebar-dock-styles')) return;
    const style = document.createElement('style');
    style.id = 'sidebar-dock-styles';
    style.textContent = `
        #sidebar-hover-strip {
            position: fixed;
            top: 0;
            left: 0;
            width: 10px;
            height: 100%;
            z-index: 8;
            opacity: 0;
            pointer-events: none;
            background: linear-gradient(90deg, rgba(122,162,247,0.16), rgba(122,162,247,0.00));
            transition: opacity .12s ease;
        }
        #sidebar-hover-strip.is-active {
            opacity: 0.5;
            pointer-events: auto;
        }
        #sidebar-pin-tab {
            position: fixed;
            top: 72px;
            left: 0;
            width: 45px;
            height: 45px;
            border: 1px solid #364053;
            border-left: none;
            border-radius: 0 8px 8px 0;
            background: rgba(20,24,30,.92);
            color: #d6dde6;
            font: 22px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            letter-spacing: 1px;
            text-transform: uppercase;
            cursor: pointer;
            z-index: 9;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            user-select: none;
            writing-mode: vertical-rl;
            text-orientation: mixed;
        }
        #sidebar-pin-tab.is-pinned {
            border-color: #6ea8fe;
            color: #e9f0ff;
            box-shadow: 0 0 0 1px rgba(110,168,254,.18) inset;
        }
        #sidebar-pin-tab:active {
            transform: translateY(1px);
        }
    `;
    document.head.appendChild(style);
}

export function ensureViewCubeCameraToggleStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('viewcube-camera-toggle-styles')) return;
    const style = document.createElement('style');
    style.id = 'viewcube-camera-toggle-styles';
    style.textContent = `
        .viewcube-camera-toggle {
            position: absolute;
            left: 0;
            top: 0;
            transform: translate(-100%, -50%);
            border: 1px solid #364053;
            border-radius: 8px;
            background: rgba(20,24,30,0.92);
            color: #d6dde6;
            font: 700 11px/1.1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            letter-spacing: 0.45px;
            padding: 7px 8px;
            min-width: 58px;
            text-align: center;
            cursor: pointer;
            z-index: 6;
            user-select: none;
            box-shadow: 0 4px 14px rgba(0,0,0,.32);
        }
        .viewcube-camera-toggle:hover {
            border-color: #6ea8fe;
            color: #edf4ff;
        }
        .viewcube-camera-toggle.is-perspective {
            border-color: #6ea8fe;
            color: #e9f0ff;
            box-shadow: 0 0 0 1px rgba(110,168,254,.2) inset, 0 4px 14px rgba(0,0,0,.32);
        }
    `;
    document.head.appendChild(style);
}

