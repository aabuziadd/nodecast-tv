const express = require("express");
const router = express.Router();

const auth = require("../auth");
const { createRestreamer } = require("../services/restreamer");


router.post(
    "/start",
    auth.requireAuth,
    async (req, res) => {

        try {

            const restreamer = createRestreamer();

            const process = await restreamer.createProcess(req.body.url);

            res.json({
                success:true,
                process,
                streamUrl:
                    `https://stream.productivity-cafe.com/memfs/${process.id}.m3u8`
            });

        } catch (err) {

            console.error("Watchparty error:", err);

            res.status(500).json({
                error: err.message
            });

        }
    }
);


module.exports = router;