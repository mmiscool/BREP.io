// Detect mobile device
type FullscreenElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
};

function isMobile(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Request fullscreen
function goFullscreen(): void {
    const element = document.documentElement as FullscreenElement; // fullscreen the whole page

    if (element.requestFullscreen) {
        void element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) { // Safari
        void element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) { // IE/Edge
        void element.msRequestFullscreen();
    }
}

// Run check and trigger fullscreen (skip when embedded in an iframe)
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        try {
            if (window.self !== window.top) return;
        } catch {
            return;
        }
        if (isMobile()) {
            // Many browsers only allow fullscreen on user interaction (like a tap),
            // so it's safer to bind it to a user event:
            document.body.addEventListener('click', () => {
                goFullscreen();
            }, { once: true });
        }
    });
}
