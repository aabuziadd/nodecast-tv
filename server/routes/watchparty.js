const express = require("express");
const router = express.Router();

const auth = require("../auth");
const { createRestreamer } = require("../services/restreamer");

/**
 * Published share for share.html — host's existing playlist + playhead.
 * No second FFmpeg / live session.
 */
let sharedState = {
    url: null,
    position: 0,
    playing: true,
    updatedAt: null,
    sessionId: null
};

/**
 * Publish the host playback URL (usually the normal transcode session m3u8)
 * and current playhead for share.html to seek to.
 *
 * POST /api/watchparty/share
 * Body: { url, position?, playing?, sessionId? }
 */
router.post(
    "/share",
    auth.requireAuth,
    (req, res) => {
        try {
            const { url, position, playing, sessionId } = req.body;

            if (!url) {
                return res.status(400).json({ error: "url is required" });
            }

            sharedState = {
                url,
                position: typeof position === "number" ? Math.max(0, position) : 0,
                playing: playing !== false,
                updatedAt: Date.now(),
                sessionId: sessionId || null
            };

            res.json({
                success: true,
                ...sharedState,
                sharePage: "/share.html"
            });
        } catch (err) {
            console.error("Watchparty share error:", err);
            res.status(500).json({ error: err.message });
        }
    }
);

/**
 * Current share pointer (public).
 * GET /api/watchparty/share
 */
router.get("/share", (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(sharedState);
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
