/**
 * share.html — play host's session m3u8 and seek to host playhead.
 * GET /api/watchparty/share already advances position while playing.
 *
 * Join lag (playlist/buffer load) is compensated when media is ready:
 * target = publishedPosition + (readyAt - fetchedAt).
 * Sub-second math already uses ms timestamps — microseconds wouldn't help.
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
    let sharePlaying = true;
    /** { position, fetchedAt } from last join/sync we intend to land on */
    let joinTarget = null;

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

    /** Position advanced by load time so we don't land behind existing viewers */
    function compensatedPosition(basePosition, fetchedAt, playing) {
        let t = basePosition;
        if (playing !== false && fetchedAt) {
            const loadSec = (Date.now() - fetchedAt) / 1000;
            if (loadSec > 0) t += loadSec;
        }
        return t;
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
            lastPosition = t;
            tryAutoplay();
        };

        if (video.readyState >= 1) {
            apply();
        } else {
            video.addEventListener('loadedmetadata', apply, { once: true });
        }
    }

    function seekWhenReady(basePosition, fetchedAt, playing) {
        joinTarget = { position: basePosition, fetchedAt, playing: playing !== false };
        const go = () => {
            if (!joinTarget) return;
            const t = compensatedPosition(
                joinTarget.position,
                joinTarget.fetchedAt,
                joinTarget.playing
            );
            seekToPosition(t, { force: true });
        };

        if (video.readyState >= 2) {
            go();
            return;
        }

        const onReady = () => go();
        video.addEventListener('canplay', onReady, { once: true });
        video.addEventListener('loadedmetadata', onReady, { once: true });
    }

    function playUrl(url, position, playing) {
        const abs = toAbsolute(url);
        if (!abs) return;

        const fetchedAt = Date.now();
        currentUrl = abs;
        hasJoined = true;
        sharePlaying = playing !== false;
        destroyPlayer();
        setOffline(false);

        // Rough start; final seek happens when media is ready (with load compensation)
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
                seekWhenReady(position, fetchedAt, playing);
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
                joinTarget = null;
                setOffline(true);
            });
            return;
        }

        if (video.canPlayType('application/vnd.apple.mpegurl') || abs.includes('.mp4') || abs.includes('/remux')) {
            video.src = abs;
            seekWhenReady(position, fetchedAt, playing);
            return;
        }

        setOffline(true);
    }

    function applyShareState(state) {
        if (!state || !state.url) {
            lastUpdatedAt = state?.updatedAt || null;
            lastPosition = null;
            joinTarget = null;
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
        const position = typeof state.position === 'number' ? state.position : 0;
        const playing = state.playing !== false;
        const fetchedAt = Date.now();

        // Same host snapshot — online viewers keep playing locally
        if (updatedAt && updatedAt === lastUpdatedAt && hasJoined) {
            return;
        }

        const urlChanged = abs !== currentUrl;
        const isFirstJoin = !hasJoined || !currentUrl;

        lastUpdatedAt = updatedAt || Date.now();
        lastPosition = position;
        sharePlaying = playing;

        if (urlChanged || isFirstJoin) {
            playUrl(state.url, position, playing);
            return;
        }

        // Host seek / pause / resume — compensate if we still need a hard sync
        seekWhenReady(position, fetchedAt, playing);

        if (!playing) {
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
            lastUpdatedAt = null;
            pollShare();
            if (currentUrl && video.paused && sharePlaying) tryAutoplay();
        }
    });

    pollShare();
    setInterval(pollShare, POLL_MS);

    video.addEventListener('durationchange', () => {
        if (!joinTarget) return;
        const t = compensatedPosition(
            joinTarget.position,
            joinTarget.fetchedAt,
            joinTarget.playing
        );
        if (!isFinite(video.duration) || video.duration < t) return;
        if (Math.abs((video.currentTime || 0) - t) > SEEK_DRIFT_SEC) {
            seekToPosition(t, { force: true });
        }
    });
})();
