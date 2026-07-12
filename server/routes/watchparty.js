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

            const info = await restreamer.getInfo();

            res.json({
                success: true,
                restreamer: info
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