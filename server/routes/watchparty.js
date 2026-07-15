const express = require("express");
const router = express.Router();

const auth = require("../auth");
const { createRestreamer } = require("../services/restreamer");

const DEFAULT_ROOM = "default";
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const sharedStates = new Map();

function normalizeRoom(value) {
    const room = String(value || DEFAULT_ROOM).trim();
    return ROOM_PATTERN.test(room) ? room : null;
}

function emptyShareState(room) {
    return {
        room,
        url: null,
        position: 0,
        playing: true,
        updatedAt: null,
        sessionId: null
    };
}

/**
 * Published shares for share.html, keyed by room.
 * position/updatedAt are a snapshot; GET extrapolates while playing.
 */
function getLiveShareState(room) {
    const sharedState = sharedStates.get(room) || emptyShareState(room);
    if (!sharedState.url || sharedState.updatedAt == null) {
        return { ...sharedState };
    }

    let position = sharedState.position || 0;
    if (sharedState.playing !== false) {
        const elapsed = (Date.now() - sharedState.updatedAt) / 1000;
        if (elapsed > 0) position += elapsed;
    }

    return {
        ...sharedState,
        position
    };
}

/**
 * Clear a room's published share so share.html shows Offline.
 */
function clearShareState(room) {
    sharedStates.delete(room);
    return emptyShareState(room);
}

/**
 * Publish the host playback URL (usually the normal transcode session m3u8)
 * and current playhead for share.html to seek to.
 *
 * POST /api/watchparty/share
 * Body: { url, position?, playing?, sessionId?, room? }
 * Clear: { clear: true, room? } or { url: null, room? }
 */
router.post(
    "/share",
    auth.requireAuth,
    (req, res) => {
        try {
            const { url, position, playing, sessionId } = req.body;
            const room = normalizeRoom(req.body.room);
            const clear =
                req.body.clear === true || url === null || url === "";

            if (!room) {
                return res.status(400).json({ error: "invalid room" });
            }

            if (clear) {
                const cleared = clearShareState(room);
                return res.json({
                    success: true,
                    ...cleared,
                    sharePage: `/share.html?room=${encodeURIComponent(room)}`
                });
            }

            if (!url) {
                return res.status(400).json({ error: "url is required" });
            }

            sharedStates.set(room, {
                room,
                url,
                position: typeof position === "number" ? Math.max(0, position) : 0,
                playing: playing !== false,
                updatedAt: Date.now(),
                sessionId: sessionId || null
            });

            res.json({
                success: true,
                ...getLiveShareState(room),
                sharePage: `/share.html?room=${encodeURIComponent(room)}`
            });
        } catch (err) {
            console.error("Watchparty share error:", err);
            res.status(500).json({ error: err.message });
        }
    }
);

/**
 * Current share pointer (public).
 * While playing, position advances from the last host snapshot by wall clock.
 * GET /api/watchparty/share
 */
router.get("/share", (req, res) => {
    const room = normalizeRoom(req.query.room);
    if (!room) {
        return res.status(400).json({ error: "invalid room" });
    }

    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(getLiveShareState(room));
});

// --- Restreamer ---

router.post(
    "/start",
    auth.requireAuth,
    async (req, res) => {
        try {
            const { processId, url } = req.body;

            if (!processId || !url) {
                return res.status(400).json({
                    error: "processId and url are required"
                });
            }

            const restreamer = createRestreamer();
            await restreamer.switchSource(processId, url);

            res.json({ success: true });
        } catch (err) {
            console.error("Watchparty error:", err);
            res.status(500).json({ error: err.message });
        }
    }
);

router.post(
    "/stop",
    auth.requireAuth,
    async (req, res) => {
        try {
            const { processId } = req.body;
            const restreamer = createRestreamer();
            await restreamer.stopProcess(processId);
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    }
);

module.exports = router;
