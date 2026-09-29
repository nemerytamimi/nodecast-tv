/**
 * Casting support
 * - AirPlay (Safari on iPhone/iPad/Mac): routes the <video> element to an Apple TV / AirPlay TV
 * - Google Cast (Chrome/Edge, HTTPS only): sends the stream URL to a Chromecast / Google TV
 * - Otherwise: explains how to mirror the screen with the OS/browser
 *
 * Players register an adapter; this module adds the button state, the "casting" overlay
 * and keeps the TV in sync when the channel/movie changes.
 */

const CAST_ICONS = {
    cast: '<path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />',
    castConnected: '<path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm18-7H5v1.63c3.96 1.28 7.09 4.41 8.37 8.37H19V7zM1 10v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />',
    airplay: '<path d="M6 22h12l-6-6-6 6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />',
    play: '<path d="M8 5v14l11-7z" />',
    pause: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />'
};

const castSvg = (name) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">${CAST_ICONS[name]}</svg>`;

const Cast = {
    adapters: [],
    airplaySupported: typeof window.WebKitPlaybackTargetAvailabilityEvent !== 'undefined',
    googleCastState: 'unavailable', // unavailable | NO_DEVICES_AVAILABLE | NOT_CONNECTED | CONNECTING | CONNECTED
    activeAdapter: null,             // adapter currently playing on a Chromecast
    lastCastUrl: null,
    remotePlayer: null,
    remoteController: null,

    init() {
        if (this._initialized) return;
        this._initialized = true;

        // The Google Cast web SDK only works in Chrome-based browsers on HTTPS (or localhost)
        if (!this.airplaySupported && window.chrome && window.isSecureContext) {
            this.loadGoogleCastSdk();
        }
    },

    /**
     * adapter: {
     *   video, container, button, menuItem,
     *   getHls(), clearHls(),
     *   getMedia() -> { title, subtitle, image, live } | null
     * }
     */
    register(adapter) {
        this.init();
        this.adapters.push(adapter);

        const { video, button, menuItem } = adapter;
        video.setAttribute('x-webkit-airplay', 'allow');

        button?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.start(adapter);
        });
        menuItem?.addEventListener('click', (e) => {
            e.stopPropagation();
            menuItem.closest('.player-overflow-menu')?.classList.add('hidden');
            this.start(adapter);
        });

        if (this.airplaySupported) {
            video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => this.updateButtons());
        }

        // Keep the TV in sync: as soon as a new channel/movie starts loading locally
        // while casting, send it to the TV
        video.addEventListener('loadstart', () => {
            if (!this.isGoogleCastConnected()) return;
            const media = this.buildMedia(adapter);
            if (media && media.url !== this.lastCastUrl) {
                this.loadOnGoogleCast(adapter);
            }
        });

        // ...and keep the local copy paused if it starts playing anyway
        video.addEventListener('playing', () => {
            if (!this.isGoogleCastConnected()) return;
            const media = this.buildMedia(adapter);
            if (media && media.url !== this.lastCastUrl) {
                this.loadOnGoogleCast(adapter);
            } else {
                this.suspendLocal(adapter);
            }
        });

        this.createOverlay(adapter);
        this.updateButtons();
    },

    // ---------------------------------------------------------------- state

    isAirPlayActive(video) {
        return !!video?.webkitCurrentPlaybackTargetIsWireless;
    },

    isGoogleCastConnected() {
        return this.googleCastState === 'CONNECTED' && !!this.getCastSession();
    },

    getCastSession() {
        try {
            return cast.framework.CastContext.getInstance().getCurrentSession();
        } catch (e) {
            return null;
        }
    },

    /**
     * Players call this before creating an hls.js instance. While AirPlay is active the
     * stream must play natively - hls.js (Media Source) playback cannot be AirPlayed.
     */
    preferNativeHls(video) {
        return this.airplaySupported && this.isAirPlayActive(video) &&
            !!video.canPlayType('application/vnd.apple.mpegurl');
    },

    updateButtons() {
        const googleAvailable = ['NOT_CONNECTED', 'CONNECTING', 'CONNECTED'].includes(this.googleCastState);

        this.adapters.forEach(adapter => {
            const { button, menuItem, video } = adapter;
            let icon = 'cast';
            let title = 'Cast to TV';
            let visible = false;
            let active = false;

            if (this.airplaySupported) {
                icon = 'airplay';
                title = 'AirPlay';
                visible = true;
                active = this.isAirPlayActive(video);
            } else if (googleAvailable) {
                visible = true;
                active = this.googleCastState === 'CONNECTED' && this.activeAdapter === adapter;
                icon = active ? 'castConnected' : 'cast';
                title = active ? 'Casting - tap to stop or change' : 'Cast to TV';
            }

            if (button) {
                button.classList.toggle('hidden', !visible);
                button.classList.toggle('active', active);
                button.title = title;
                button.setAttribute('aria-label', title);
                button.innerHTML = castSvg(icon);
            }
            if (menuItem) {
                const label = menuItem.querySelector('.cast-menu-label');
                if (label) label.textContent = this.airplaySupported ? 'AirPlay / Screen Mirroring' : 'Cast / Mirror to TV';
            }
        });
    },

    // ---------------------------------------------------------------- actions

    start(adapter) {
        if (this.airplaySupported) {
            this.startAirPlay(adapter);
        } else if (this.googleCastState !== 'unavailable' && this.googleCastState !== 'NO_DEVICES_AVAILABLE') {
            this.startGoogleCast(adapter);
        } else {
            this.showHelp();
        }
    },

    startAirPlay(adapter) {
        const video = adapter.video;
        this.warnIfLocalhost(adapter);

        // hls.js disables remote playback for Media Source playback; switch to Safari's native HLS
        this.switchToNativeHls(adapter);

        video.disableRemotePlayback = false;
        if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
            video.webkitShowPlaybackTargetPicker();
        } else if (video.remote?.prompt) {
            video.remote.prompt().catch(err => {
                if (err.name !== 'AbortError') this.toast('AirPlay is not available for this stream');
            });
        } else {
            this.showHelp();
        }
    },

    /**
     * Replace hls.js playback with native playback of the same URL (Safari only)
     */
    switchToNativeHls(adapter) {
        const hls = adapter.getHls();
        const video = adapter.video;
        if (!hls || !hls.url || !video.canPlayType('application/vnd.apple.mpegurl')) return;

        const url = hls.url;
        const time = video.currentTime;
        const isLive = video.duration === Infinity;
        const wasPlaying = !video.paused;

        hls.destroy();
        adapter.clearHls();

        video.src = url;
        if (!isLive && time > 0) {
            video.addEventListener('loadedmetadata', () => {
                try { video.currentTime = time; } catch (e) { /* ignore */ }
            }, { once: true });
        }
        if (wasPlaying) {
            video.play().catch(() => { });
        }
    },

    async startGoogleCast(adapter) {
        const context = cast.framework.CastContext.getInstance();
        try {
            if (!context.getCurrentSession()) {
                await context.requestSession();
            } else if (this.activeAdapter === adapter && this.lastCastUrl === this.buildMedia(adapter)?.url) {
                // Already casting this - show the device picker to stop/switch
                await context.requestSession();
                return;
            }
            await this.loadOnGoogleCast(adapter);
        } catch (err) {
            // 'cancel' = user closed the device picker
            if (err !== 'cancel' && err?.code !== 'cancel') {
                console.warn('[Cast] Failed to start casting:', err);
                this.toast('Could not start casting');
            }
        }
    },

    async loadOnGoogleCast(adapter) {
        const session = this.getCastSession();
        const media = this.buildMedia(adapter);
        if (!session) return;
        if (!media) {
            this.toast('Start playing something first, then cast it');
            return;
        }
        this.warnIfLocalhost(adapter);

        const info = new chrome.cast.media.MediaInfo(media.url, media.contentType);
        info.streamType = media.live ? chrome.cast.media.StreamType.LIVE : chrome.cast.media.StreamType.BUFFERED;

        const metadata = new chrome.cast.media.GenericMediaMetadata();
        metadata.title = media.title || 'nodecast-tv';
        if (media.subtitle) metadata.subtitle = media.subtitle;
        if (media.image) metadata.images = [new chrome.cast.Image(media.image)];
        info.metadata = metadata;

        const request = new chrome.cast.media.LoadRequest(info);
        request.autoplay = true;
        if (!media.live && media.currentTime > 0 && media.seekable) {
            request.currentTime = media.currentTime;
        }

        // Switching players (e.g. live -> movie): hide the previous player's overlay
        if (this.activeAdapter && this.activeAdapter !== adapter) {
            this.activeAdapter.overlay?.classList.add('hidden');
        }

        this.activeAdapter = adapter;
        this.lastCastUrl = media.url;
        this.suspendLocal(adapter);
        this.updateOverlay();
        this.updateButtons();

        try {
            await session.loadMedia(request);
        } catch (err) {
            console.warn('[Cast] loadMedia failed:', err);
            this.toast('The TV could not play this stream');
        }
    },

    stopGoogleCast() {
        try {
            cast.framework.CastContext.getInstance().endCurrentSession(true);
        } catch (e) { /* ignore */ }
    },

    /**
     * While the TV plays, pause/mute locally and stop downloading
     */
    suspendLocal(adapter) {
        const video = adapter.video;
        if (!adapter.suspended) {
            adapter.suspended = { muted: video.muted };
        }
        video.muted = true;
        video.pause();
        try { adapter.getHls()?.stopLoad(); } catch (e) { /* ignore */ }
    },

    resumeLocal(adapter, remoteTime) {
        if (!adapter?.suspended) return;
        const video = adapter.video;
        const isLive = video.duration === Infinity;
        const hls = adapter.getHls();

        video.muted = adapter.suspended.muted;
        adapter.suspended = null;

        if (hls) {
            hls.startLoad(isLive ? -1 : (remoteTime || video.currentTime));
        } else if (isLive && video.getAttribute('src')) {
            video.load(); // reconnect at the live edge
        }
        if (!isLive && remoteTime > 0) {
            try { video.currentTime = remoteTime; } catch (e) { /* ignore */ }
        }
        video.play().catch(() => { });
    },

    // ---------------------------------------------------------------- media

    /**
     * Work out a URL the TV can fetch itself
     */
    buildMedia(adapter) {
        const info = adapter.getMedia?.();
        const hls = adapter.getHls();
        let source = hls?.url || adapter.video.currentSrc || adapter.video.getAttribute('src');
        if (!info || !source || source.startsWith('blob:')) return null;

        const abs = new URL(source, window.location.href);
        const sameOrigin = abs.origin === window.location.origin;
        const path = abs.pathname + abs.search;
        const isHls = /m3u8/i.test(path) || /\/api\/transcode\/[^/]+\/stream\.m3u8/.test(abs.pathname);
        const origin = window.location.origin;

        let url = abs.href;
        let contentType = 'video/mp4';
        let seekable = !info.live;

        if (isHls) {
            contentType = 'application/x-mpegurl';
            // Chromecast loads HLS with CORS requests - go through our proxy for external playlists
            if (!sameOrigin) url = `${origin}/api/proxy/stream?url=${encodeURIComponent(abs.href)}`;
        } else if (abs.pathname.startsWith('/api/remux')) {
            contentType = 'video/mp4';
            seekable = false;
        } else if (!sameOrigin) {
            const needsRemux = /\.(mkv|avi|ts)(\?|$)/i.test(abs.pathname) ||
                (window.location.protocol === 'https:' && abs.protocol === 'http:');
            if (needsRemux) {
                // Convert container (and avoid http media on an https receiver)
                url = `${origin}/api/remux?url=${encodeURIComponent(abs.href)}`;
                seekable = false;
            } else if (/\.webm(\?|$)/i.test(abs.pathname)) {
                contentType = 'video/webm';
            }
        }

        let image = info.image || null;
        if (image) {
            try {
                const img = new URL(image, window.location.href);
                image = img.origin === origin ? img.href : `${origin}/api/proxy/image?url=${encodeURIComponent(img.href)}`;
            } catch (e) {
                image = null;
            }
        }

        return {
            url,
            contentType,
            title: info.title,
            subtitle: info.subtitle,
            image,
            live: !!info.live,
            seekable,
            currentTime: adapter.video.currentTime
        };
    },

    warnIfLocalhost() {
        const host = window.location.hostname;
        if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
            this.toast('The TV cannot reach "localhost". Open nodecast-tv using this server\'s network address (e.g. http://192.168.x.x:3000).', 7000);
        }
    },

    // ---------------------------------------------------------------- Google Cast SDK

    loadGoogleCastSdk() {
        window.__onGCastApiAvailable = (isAvailable) => {
            if (isAvailable) this.setupGoogleCast();
        };
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
        script.async = true;
        document.head.appendChild(script);
    },

    setupGoogleCast() {
        const context = cast.framework.CastContext.getInstance();
        context.setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });

        this.remotePlayer = new cast.framework.RemotePlayer();
        this.remoteController = new cast.framework.RemotePlayerController(this.remotePlayer);

        context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e) => {
            this.googleCastState = e.castState;
            this.updateButtons();
        });

        context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e) => {
            const S = cast.framework.SessionState;
            if (e.sessionState === S.SESSION_ENDED) {
                const adapter = this.activeAdapter;
                const remoteTime = this.remotePlayer?.currentTime || 0;
                this.activeAdapter = null;
                this.lastCastUrl = null;
                if (adapter) {
                    adapter.overlay?.classList.add('hidden');
                    this.resumeLocal(adapter, remoteTime);
                }
            }
            this.updateButtons();
            this.updateOverlay();
        });

        const T = cast.framework.RemotePlayerEventType;
        [T.IS_PAUSED_CHANGED, T.PLAYER_STATE_CHANGED, T.IS_CONNECTED_CHANGED].forEach(type => {
            this.remoteController.addEventListener(type, () => this.updateOverlay());
        });

        this.googleCastState = context.getCastState();
        this.updateButtons();
    },

    // ---------------------------------------------------------------- overlay / UI

    createOverlay(adapter) {
        if (!adapter.container) return;
        const overlay = document.createElement('div');
        overlay.className = 'cast-overlay hidden';
        overlay.innerHTML = `
            <div class="cast-overlay-card">
                <span class="cast-overlay-icon">${castSvg('castConnected')}</span>
                <div class="cast-overlay-text">
                    <span class="cast-overlay-label">Playing on</span>
                    <strong class="cast-overlay-device">TV</strong>
                    <span class="cast-overlay-title"></span>
                </div>
                <div class="cast-overlay-actions">
                    <button type="button" class="watch-btn cast-overlay-playpause" title="Play/Pause" aria-label="Play/Pause">${castSvg('pause')}</button>
                    <button type="button" class="btn btn-sm btn-secondary cast-overlay-stop">Stop casting</button>
                </div>
            </div>`;
        overlay.addEventListener('click', e => e.stopPropagation());
        overlay.addEventListener('dblclick', e => e.stopPropagation());
        overlay.querySelector('.cast-overlay-playpause').addEventListener('click', () => {
            this.remoteController?.playOrPause();
        });
        overlay.querySelector('.cast-overlay-stop').addEventListener('click', () => this.stopGoogleCast());
        adapter.container.appendChild(overlay);
        adapter.overlay = overlay;
    },

    updateOverlay() {
        this.adapters.forEach(adapter => {
            const overlay = adapter.overlay;
            if (!overlay) return;
            const show = this.isGoogleCastConnected() && this.activeAdapter === adapter;
            overlay.classList.toggle('hidden', !show);
            if (!show) return;

            const session = this.getCastSession();
            const device = session?.getCastDevice?.()?.friendlyName || 'TV';
            overlay.querySelector('.cast-overlay-device').textContent = device;
            overlay.querySelector('.cast-overlay-title').textContent =
                this.remotePlayer?.mediaInfo?.metadata?.title || adapter.getMedia?.()?.title || '';
            overlay.querySelector('.cast-overlay-playpause').innerHTML =
                castSvg(this.remotePlayer?.isPaused ? 'play' : 'pause');
        });
    },

    toast(message, duration = 4000) {
        let el = document.getElementById('cast-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'cast-toast';
            el.className = 'cast-toast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
    },

    /**
     * No in-app casting available: explain screen mirroring for this device
     */
    showHelp() {
        const ua = navigator.userAgent;
        const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isAndroid = /Android/.test(ua);
        const isEdge = /Edg\//.test(ua);
        const isChromium = !!window.chrome;
        const insecure = !window.isSecureContext;

        let steps;
        if (isIOS) {
            steps = `<p>Open <strong>Control Center</strong> → <strong>Screen Mirroring</strong> and choose your Apple TV or AirPlay TV.</p>`;
        } else if (isAndroid) {
            steps = `<p>Swipe down from the top of the screen and tap <strong>Cast</strong>, <strong>Screen Cast</strong> or <strong>Smart View</strong> (the name depends on your phone), then choose your TV.</p>`;
        } else if (isEdge) {
            steps = `<p>Open the Edge menu <strong>⋯</strong> → <strong>More tools</strong> → <strong>Cast media to device</strong> and choose your TV.</p>`;
        } else if (isChromium) {
            steps = `<p>Open the Chrome menu <strong>⋮</strong> → <strong>Cast…</strong> (or <strong>Save and share</strong> → <strong>Cast…</strong>) and choose your TV. This mirrors the tab.</p>`;
        } else {
            steps = `<p>This browser can't cast. Use your device's screen mirroring, or open nodecast-tv in Chrome or Safari.</p>`;
        }

        const httpsNote = (isChromium && insecure && !isIOS)
            ? `<p class="hint">To cast straight from the player (the TV plays the stream itself, and your device stays free), open nodecast-tv over <strong>HTTPS</strong> - Chrome only allows Google Cast on secure pages. A reverse proxy such as Nginx Proxy Manager or Caddy with a certificate works.</p>`
            : '';

        let modal = document.getElementById('cast-help-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cast-help-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="cast-help-title">
                    <div class="modal-header">
                        <h3 id="cast-help-title">Watch on your TV</h3>
                        <button class="modal-close" aria-label="Close">&times;</button>
                    </div>
                    <div class="modal-body cast-help-body"></div>
                    <div class="modal-footer">
                        <button class="btn btn-primary cast-help-ok">OK</button>
                    </div>
                </div>`;
            const close = () => modal.classList.remove('active');
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            modal.querySelector('.modal-close').addEventListener('click', close);
            modal.querySelector('.cast-help-ok').addEventListener('click', close);
            document.body.appendChild(modal);
        }

        modal.querySelector('.cast-help-body').innerHTML =
            `<p>No cast device was found from this page. You can mirror your screen instead:</p>${steps}${httpsNote}`;
        modal.classList.add('active');
    }
};

window.Cast = Cast;
