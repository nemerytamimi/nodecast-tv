/**
 * Fullscreen helper
 * Cross-browser fullscreen handling with mobile support:
 * - Standard Fullscreen API (desktop, Android)
 * - Prefixed WebKit API (Safari desktop, iPadOS)
 * - Native video fullscreen fallback (iPhone Safari, which cannot fullscreen a div)
 * - Landscape orientation lock on mobile while in fullscreen
 */

const Fullscreen = {
    /**
     * Whether the page (or the given video, on iOS) is currently fullscreen
     */
    isActive(video) {
        return !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            (video && video.webkitDisplayingFullscreen));
    },

    /**
     * Enter fullscreen on a container, falling back to native video fullscreen
     */
    async enter(container, video) {
        try {
            if (container?.requestFullscreen) {
                await container.requestFullscreen({ navigationUI: 'hide' });
            } else if (container?.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            } else if (video?.webkitEnterFullscreen) {
                // iPhone Safari: only <video> elements can go fullscreen
                video.webkitEnterFullscreen();
                return;
            } else {
                return;
            }
        } catch (err) {
            // Some mobile browsers reject container fullscreen; try the video itself
            if (video?.webkitEnterFullscreen) {
                try {
                    video.webkitEnterFullscreen();
                } catch (e) {
                    console.error('Fullscreen error:', e);
                }
            } else {
                console.error('Fullscreen error:', err);
            }
            return;
        }

        this.lockLandscape();
    },

    /**
     * Exit fullscreen (document or native video)
     */
    exit(video) {
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => { });
        } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
            video.webkitExitFullscreen();
        }
    },

    /**
     * Toggle fullscreen for a player container/video pair
     */
    toggle(container, video) {
        if (this.isActive(video)) {
            this.exit(video);
        } else {
            this.enter(container, video);
        }
    },

    /**
     * Rotate to landscape on phones/tablets while fullscreen (where supported)
     */
    lockLandscape() {
        const isTouch = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
        if (!isTouch || !screen.orientation?.lock) return;
        screen.orientation.lock('landscape').catch(() => {
            // Not supported (e.g. iOS) or not allowed - ignore
        });
    },

    unlockOrientation() {
        try {
            screen.orientation?.unlock?.();
        } catch (e) {
            // Ignore
        }
    }
};

// Release orientation lock when leaving fullscreen (including via back gesture / Esc)
['fullscreenchange', 'webkitfullscreenchange'].forEach(evt => {
    document.addEventListener(evt, () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            Fullscreen.unlockOrientation();
        }
    });
});

window.Fullscreen = Fullscreen;
