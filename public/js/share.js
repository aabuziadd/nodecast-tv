/**
 * share.html — host session m3u8 + playhead sync.
 * Custom controls: play/pause, volume, fullscreen, jump-to-live (no seek bar).
 */
(function () {
    const video = document.getElementById('video');
    const offline = document.getElementById('offline');
    const shell = document.getElementById('shell');
    const controls = document.getElementById('controls');
    const btnPlay = document.getElementById('btn-play');
    const btnMute = document.getElementById('btn-mute');
    const btnFs = document.getElementById('btn-fs');
    const btnLive = document.getElementById('btn-live');
    const volumeSlider = document.getElementById('volume');

    const POLL_MS = 2000;
    const SEEK_DRIFT_SEC = 5;
    const LIVE_BEHIND_SEC = 6;
    const CONTROLS_HIDE_MS = 2800;
    const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
    const requestedRoom = new URLSearchParams(window.location.search).get('room') || 'default';
    const room = ROOM_PATTERN.test(requestedRoom) ? requestedRoom : 'default';

    let hls = null;
    let currentUrl = null;
    let lastUpdatedAt = null;
    let lastPosition = null;
    let hasJoined = false;
    let sharePlaying = true;
    let joinTarget = null;
    let liveEdge = 0;
    let liveEdgeAt = 0;
    let hideControlsTimer = null;

    function setOffline(show) {
        offline.classList.toggle('hidden', !show);
        controls.style.visibility = show ? 'hidden' : '';
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

    function setLiveEdge(position, playing) {
        liveEdge = typeof position === 'number' ? position : 0;
        liveEdgeAt = Date.now();
        sharePlaying = playing !== false;
        updateLiveButton();
    }

    function currentLiveEdge() {
        if (!sharePlaying) return liveEdge;
        return liveEdge + (Date.now() - liveEdgeAt) / 1000;
    }

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
            updateLiveButton();
        };

        if (video.readyState >= 1) apply();
        else video.addEventListener('loadedmetadata', apply, { once: true });
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

    function jumpToLive() {
        const edge = currentLiveEdge();
        const fetchedAt = Date.now();
        joinTarget = { position: edge, fetchedAt, playing: sharePlaying };
        seekToPosition(edge, { force: true });
        tryAutoplay();
        updateLiveButton();
    }

    function updateLiveButton() {
        if (!hasJoined || !currentUrl || offline && !offline.classList.contains('hidden')) {
            btnLive.classList.remove('visible');
            return;
        }
        const behind = currentLiveEdge() - (video.currentTime || 0);
        btnLive.classList.toggle('visible', behind > LIVE_BEHIND_SEC);
    }

    function updatePlayUi() {
        controls.classList.toggle('playing', !video.paused);
    }

    function updateMuteUi() {
        const muted = video.muted || video.volume === 0;
        controls.classList.toggle('muted', muted);
        if (volumeSlider) {
            volumeSlider.value = muted ? 0 : Math.round(video.volume * 100);
        }
    }

    function showControls() {
        shell.classList.remove('controls-hidden');
        clearTimeout(hideControlsTimer);
        if (!video.paused) {
            hideControlsTimer = setTimeout(() => {
                shell.classList.add('controls-hidden');
            }, CONTROLS_HIDE_MS);
        }
    }

    function playUrl(url, position, playing) {
        const abs = toAbsolute(url);
        if (!abs) return;

        const fetchedAt = Date.now();
        currentUrl = abs;
        hasJoined = true;
        setLiveEdge(position, playing);
        destroyPlayer();
        setOffline(false);
        showControls();

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

        // Always refresh live edge for the Live button (even if snapshot unchanged)
        setLiveEdge(position, playing);

        if (updatedAt && updatedAt === lastUpdatedAt && hasJoined) {
            return;
        }

        const urlChanged = abs !== currentUrl;
        const isFirstJoin = !hasJoined || !currentUrl;

        lastUpdatedAt = updatedAt || Date.now();
        lastPosition = position;

        if (urlChanged || isFirstJoin) {
            playUrl(state.url, position, playing);
            return;
        }

        seekWhenReady(position, fetchedAt, playing);

        if (!playing) video.pause();
        else tryAutoplay();
    }

    async function pollShare() {
        try {
            const res = await fetch(`/api/watchparty/share?room=${encodeURIComponent(room)}`, {
                cache: 'no-store'
            });
            if (!res.ok) throw new Error('poll failed');
            applyShareState(await res.json());
        } catch {
            if (!currentUrl) setOffline(true);
        }
    }

    // --- Custom controls (Owncast-style: no seek / no duration) ---
    btnPlay?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (video.paused) tryAutoplay();
        else video.pause();
        showControls();
    });

    btnMute?.addEventListener('click', (e) => {
        e.stopPropagation();
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 0.8;
        updateMuteUi();
        showControls();
    });

    volumeSlider?.addEventListener('input', (e) => {
        const v = Number(e.target.value) / 100;
        video.volume = v;
        video.muted = v === 0;
        updateMuteUi();
        showControls();
    });

    btnFs?.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = shell;
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
        } else if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => {});
        } else if (el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
        } else if (video.webkitEnterFullscreen) {
            video.webkitEnterFullscreen();
        }
        showControls();
    });

    btnLive?.addEventListener('click', (e) => {
        e.stopPropagation();
        jumpToLive();
        showControls();
    });

    shell?.addEventListener('mousemove', showControls);
    shell?.addEventListener('touchstart', showControls, { passive: true });
    shell?.addEventListener('click', (e) => {
        if (e.target === video || e.target === shell) {
            showControls();
            if (video.paused) tryAutoplay();
            else video.pause();
        }
    });

    video.addEventListener('play', () => {
        updatePlayUi();
        showControls();
    });
    video.addEventListener('pause', () => {
        updatePlayUi();
        shell.classList.remove('controls-hidden');
        clearTimeout(hideControlsTimer);
    });
    video.addEventListener('volumechange', updateMuteUi);
    video.addEventListener('timeupdate', updateLiveButton);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            lastUpdatedAt = null;
            pollShare();
            if (currentUrl && video.paused && sharePlaying) tryAutoplay();
        }
    });

    pollShare();
    setInterval(pollShare, POLL_MS);
    setInterval(updateLiveButton, 1000);

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

    updatePlayUi();
    updateMuteUi();
    showControls();
})();
