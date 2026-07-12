const express = require("express");
const router = express.Router();
const { client } = require("../services/restreamer");

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

        const response = await client.get("/api");

        console.log(response.data);
        
        res.json({
            success: true
        });

    }
);

module.exports = router;
