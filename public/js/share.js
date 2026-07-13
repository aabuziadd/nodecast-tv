/**
 * share.html — native autoplay player for /api/watchparty/live.m3u8
 */
(function () {
    const video = document.getElementById('video');
    const offline = document.getElementById('offline');
    const POLL_MS = 2000;

    let hls = null;
    let currentUrl = null;
    let lastUpdatedAt = null;

    function setOffline(show) {
        offline.classList.toggle('hidden', !show);
    }

    function tryAutoplay() {
        return video.play().catch(() => {});
    }

    function destroyPlayer() {
        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.removeAttribute('src');
        video.load();
    }

    function toAbsolute(url) {
        if (!url) return null;
        if (url.startsWith('http')) return url;
        return `${window.location.origin}${url}`;
    }

    /**
     * @param {string} url
     * @param {{ force?: boolean, cacheBust?: number }} [opts]
     */
    function playUrl(url, opts = {}) {
        const abs = toAbsolute(url);
        if (!abs) return;

        // Same fixed live.m3u8 alias — must still reload when Share Live is clicked again
        if (!opts.force && abs === currentUrl) return;

        currentUrl = abs;
        destroyPlayer();
        setOffline(false);

        // Bust caches / force hls.js to treat it as a new source
        const source = opts.cacheBust
            ? `${abs}${abs.includes('?') ? '&' : '?'}t=${opts.cacheBust}`
            : abs;

        if (window.Hls && Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                liveSyncDurationCount: 3
            });
            hls.loadSource(source);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => tryAutoplay());
            hls.on(Hls.Events.ERROR, (_e, data) => {
                if (!data.fatal) return;
                destroyPlayer();
                currentUrl = null;
                setOffline(true);
            });
            return;
        }

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = source;
            video.addEventListener('loadedmetadata', () => tryAutoplay(), { once: true });
            return;
        }

        setOffline(true);
    }

    function applyShareState(state) {
        if (!state || !state.url) {
            lastUpdatedAt = state?.updatedAt || null;
            if (currentUrl) {
                destroyPlayer();
                currentUrl = null;
            }
            setOffline(true);
            return;
        }

        const updatedAt = state.updatedAt || null;
        const abs = toAbsolute(state.url);

        // Unchanged share — keep playing
        if (updatedAt && updatedAt === lastUpdatedAt && abs === currentUrl) {
            return;
        }

        const isReshare = lastUpdatedAt != null && updatedAt !== lastUpdatedAt;
        lastUpdatedAt = updatedAt || Date.now();

        playUrl(state.url, {
            force: isReshare || abs !== currentUrl,
            cacheBust: updatedAt || Date.now()
        });
    }

    async function pollShare() {
        try {
            const res = await fetch('/api/watchparty/share', { cache: 'no-store' });
            if (!res.ok) throw new Error('poll failed');
            applyShareState(await res.json());
        } catch {
            if (!currentUrl) setOffline(true);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            pollShare();
            if (currentUrl && video.paused) tryAutoplay();
        }
    });

    pollShare();
    setInterval(pollShare, POLL_MS);
})();
