/**
 * Datarhei Restreamer/Core API Client
 */

class RestreamerApi {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.username = username;
        this.password = password;

        this.accessToken = null;
        this.refreshToken = null;
    }


    async login() {
        const response = await fetch(
            `${this.baseUrl}/api/login`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: this.username,
                    password: this.password
                })
            }
        );


        if (!response.ok) {
            throw new Error(
                `Restreamer login failed: ${response.status}`
            );
        }


        const data = await response.json();

        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;

        return data;
    }


    async request(path, options = {}) {

        if (!this.accessToken) {
            await this.login();
        }


        const response = await fetch(
            `${this.baseUrl}${path}`,
            {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization":
                        `Bearer ${this.accessToken}`,
                    ...(options.headers || {})
                }
            }
        );


        if (response.status === 401) {
            await this.login();
            return this.request(path, options);
        }


        if (!response.ok) {
            const body = await response.text();

            throw new Error(
                `Restreamer API ${response.status}: ${body}`
            );
        }


        return response.json();
    }


    async getInfo() {
        return this.request("/api/v3/config");
    }

    async createProcess(sourceUrl) {

        const processId =
            `watchparty-${Date.now()}`;


        const body = {
            id: processId,

            input: [
                {
                    id: "0",
                    address: sourceUrl,
                    options: []
                }
            ],

            output: [
                {
                    id: "0",
                    address: "{memfs}/{processid}.m3u8",
                    options: [
                        "-f",
                        "hls",
                        "-hls_time",
                        "4",
                        "-hls_list_size",
                        "6",
                        "-hls_flags",
                        "delete_segments"
                    ]
                }
            ],

            autostart: true,

            reconnect: true,

            reconnect_delay_seconds: 10,

            stale_timeout_seconds: 30,

            reference: "nodecast-watchparty"
        };


        return this.request(
            "/api/v3/process",
            {
                method: "POST",
                body: JSON.stringify(body)
            }
        );
    }
}


function createRestreamer() {
    return new RestreamerApi(
        process.env.RESTREAMER_URL,
        process.env.RESTREAMER_USERNAME,
        process.env.RESTREAMER_PASSWORD
    );
}


module.exports = {
    RestreamerApi,
    createRestreamer
};
