const express = require("express");
const router = express.Router();

const auth = require("../auth");
const db = require("../db");
const { createRestreamer } = require("../services/restreamer");
const liveTranscode = require("../services/liveTranscodeSession");

liveTranscode.startCleanupInterval();

/** Published share state for share.html */
let sharedState = {
    url: null,
    updatedAt: null,
    sessionId: null
};

/**
 * Start a separate live HLS encode and publish it for share.html.
 * Does not touch the host's normal VOD TranscodeSession.
 *
 * POST /api/watchparty/share
 * Body: { url, seekOffset? }
 */
router.post(
    "/share",
    auth.requireAuth,
    async (req, res) => {
        try {
            const { url, seekOffset } = req.body;

            if (!url) {
                return res.status(400).json({ error: "url is required" });
            }

            const settings = await db.settings.get();
            const userAgent = db.getUserAgent(settings);
            const ffmpegPath = req.app.locals.ffmpegPath || "ffmpeg";

            const session = await liveTranscode.startShareSession(url, {
                ffmpegPath,
                userAgent,
                seekOffset: typeof seekOffset === "number" ? seekOffset : 0
            });

            sharedState = {
                url: "/api/watchparty/live.m3u8",
                updatedAt: Date.now(),
                sessionId: session.id
            };

            res.json({
                success: true,
                ...sharedState,
                playlistUrl: sharedState.url,
                sharePage: "/share.html"
            });
        } catch (err) {
            console.error("Watchparty share error:", err);
            res.status(500).json({ error: err.message });
        }
    }
);

/**
 * Current share playlist pointer (public).
 * GET /api/watchparty/share
 */
router.get("/share", (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(sharedState);
});

/**
 * Fixed live HLS playlist for embeds.
 * GET /api/watchparty/live.m3u8
 */
router.get("/live.m3u8", async (req, res) => {
    const session = liveTranscode.getActiveLiveSession();
    if (!session) {
        return res.status(404).json({ error: "No live share session" });
    }

    const playlist = await session.getPlaylist();
    if (!playlist) {
        return res.status(404).json({ error: "Playlist not ready" });
    }

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(playlist);
});

/**
 * Live HLS segments.
 * GET /api/watchparty/seg0000.ts
 */
router.get("/:segment", async (req, res, next) => {
    const { segment } = req.params;
    if (!segment.endsWith(".ts")) return next();

    const session = liveTranscode.getActiveLiveSession();
    if (!session) {
        return res.status(404).json({ error: "No live share session" });
    }

    const segmentPath = await session.getSegment(segment);
    if (!segmentPath) {
        return res.status(404).json({ error: "Segment not found" });
    }

    res.setHeader("Content-Type", "video/MP2T");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.sendFile(segmentPath);
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
