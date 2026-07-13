const express = require("express");
const router = express.Router();

const auth = require("../auth");
const { createRestreamer } = require("../services/restreamer");

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

            await restreamer.switchSource(
                processId,
                url
            );

            res.json({
                success: true
            });

        } catch (err) {
            console.error("Watchparty error:", err);

            res.status(500).json({
                error: err.message
            });
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

            res.json({
                success: true
            });

        } catch (err) {
            console.error(err);

            res.status(500).json({
                error: err.message
            });
        }
    }
);

module.exports = router;