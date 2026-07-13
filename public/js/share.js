/**
 * share.html — play host's session m3u8 and seek to host playhead.
 * GET /api/watchparty/share already advances position while playing.
 */
(function () {
    const video = document.getElementById('video');
    const offline = document.getElementById('offline');
    const POLL_MS = 2000;
    const SEEK_DRIFT_SEC = 5;

    let hls = null;
    let currentUrl = null;
    let lastUpdatedAt = null;
    let lastPosition = null;
    let hasJoined = false;

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

    function seekToPosition(position, { force = false } = {}) {
        if (typeof position !== 'number' || position < 0 || !isFinite(position)) return;

        const apply = () => {
            const duration = video.duration;
            let t = position;
            if (isFinite(duration) && duration > 0) {
                t = Math.min(position, Math.max(0, duration - 0.25));
            }
            const drift = Math.abs((video.currentTime || 0) - t);
            if (force || drift > SEEK_DRIFT_SEC) {
                video.currentTime = t;
            }
            tryAutoplay();
        };

        if (video.readyState >= 1) {
            apply();
        } else {
            video.addEventListener('loadedmetadata', apply, { once: true });
        }
    }

    function playUrl(url, position) {
        const abs = toAbsolute(url);
        if (!abs) return;

        currentUrl = abs;
        hasJoined = true;
        destroyPlayer();
        setOffline(false);

        const startPos = typeof position === 'number' && position > 0 ? position : -1;

        if (window.Hls && Hls.isSupported()) {
            hls = new Hls({
                enableWorker: true,
                startPosition: startPos,
                lowLatencyMode: false
            });
            hls.loadSource(abs);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                seekToPosition(position, { force: true });
            });
            hls.on(Hls.Events.ERROR, (_e, data) => {
                if (!data.fatal) return;
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    hls.startLoad();
                    return;
                }
                destroyPlayer();
                currentUrl = null;
                hasJoined = false;
                setOffline(true);
            });
            return;
        }

        if (video.canPlayType('application/vnd.apple.mpegurl') || abs.includes('.mp4') || abs.includes('/remux')) {
            video.src = abs;
            video.addEventListener(
                'loadedmetadata',
                () => seekToPosition(position, { force: true }),
                { once: true }
            );
            return;
        }

        setOffline(true);
    }

    function applyShareState(state) {
        if (!state || !state.url) {
            lastUpdatedAt = state?.updatedAt || null;
            lastPosition = null;
            if (currentUrl) {
                destroyPlayer();
                currentUrl = null;
                hasJoined = false;
            }
            setOffline(true);
            return;
        }

        const updatedAt = state.updatedAt || null;
        const abs = toAbsolute(state.url);
        // Server already extrapolated position while playing
        const position = typeof state.position === 'number' ? state.position : 0;

        // Same host snapshot — online viewers keep playing locally
        if (updatedAt && updatedAt === lastUpdatedAt && hasJoined) {
            return;
        }

        const urlChanged = abs !== currentUrl;
        const isFirstJoin = !hasJoined || !currentUrl;

        lastUpdatedAt = updatedAt || Date.now();
        lastPosition = position;

        if (urlChanged || isFirstJoin) {
            playUrl(state.url, position);
            return;
        }

        // Host seek / pause / resume — correct if drifted
        seekToPosition(position, { force: false });

        if (state.playing === false) {
            video.pause();
        } else {
            tryAutoplay();
        }
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
            // Treat as a fresh join check so pause/seek while hidden is applied
            lastUpdatedAt = null;
            pollShare();
            if (currentUrl && video.paused) tryAutoplay();
        }
    });

    pollShare();
    setInterval(pollShare, POLL_MS);

    video.addEventListener('durationchange', () => {
        if (lastPosition == null) return;
        if (!isFinite(video.duration) || video.duration < lastPosition) return;
        if (Math.abs((video.currentTime || 0) - lastPosition) > SEEK_DRIFT_SEC) {
            seekToPosition(lastPosition, { force: true });
        }
    });
})();
