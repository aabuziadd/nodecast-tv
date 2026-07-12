const axios = require("axios");

const client = axios.create({
    baseURL: process.env.RESTREAMER_URL,
    auth: {
        username: process.env.RESTREAMER_USERNAME,
        password: process.env.RESTREAMER_PASSWORD,
    },
});

module.exports = {
    client,
};
