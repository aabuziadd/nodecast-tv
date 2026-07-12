const express = require("express");
const router = express.Router();

const auth = require("../auth");

router.post(
    "/start",
    auth.requireAuth,
    async (req, res) => {

        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                error: "Missing stream URL"
            });
        }

        res.json({
            success: true
        });

    }
);

module.exports = router;
