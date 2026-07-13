/**
 * Datarhei Restreamer/Core API Client
 */

class RestreamerApi {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.username = username;
        this.password = password;

        this.accessToken = null;
    }

    async login() {
        const response = await fetch(`${this.baseUrl}/api/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: this.username,
                password: this.password
            })
        });

        if (!response.ok) {
            throw new Error(`Restreamer login failed (${response.status})`);
        }

        const data = await response.json();

        this.accessToken = data.access_token;

        return data;
    }

    async request(path, options = {}) {
        if (!this.accessToken) {
            await this.login();
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.accessToken}`,
                ...(options.headers || {})
            }
        });

        if (response.status === 401) {
            await this.login();
            return this.request(path, options);
        }

        if (!response.ok) {
            throw new Error(
                `Restreamer API ${response.status}: ${await response.text()}`
            );
        }

        if (response.status === 204) {
            return true;
        }

        return response.json();
    }

    async getInfo() {
        return this.request("/api/v3/config");
    }

    async getProcess(processId) {
        return this.request(`/api/v3/process/${encodeURIComponent(processId)}`);
    }

    async updateSource(processId, sourceUrl) {
        const process = await this.getProcess(processId);

        process.input[0].address = sourceUrl;

        return this.request(
            `/api/v3/process/${encodeURIComponent(processId)}`,
            {
                method: "PUT",
                body: JSON.stringify(process.config)
            }
        );
    }

    async startProcess(processId) {
        return this.request(
            `/api/v3/process/${encodeURIComponent(processId)}/command`,
            {
                method: "PUT",
                body: JSON.stringify({
                    command: "start"
                })
            }
        );
    }

    async stopProcess(processId) {
        return this.request(
            `/api/v3/process/${encodeURIComponent(processId)}/command`,
            {
                method: "PUT",
                body: JSON.stringify({
                    command: "stop"
                })
            }
        );
    }

    async switchSource(processId, sourceUrl) {
        await this.stopProcess(processId);
        await this.updateSource(processId, sourceUrl);
        await this.startProcess(processId);

        return true;
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
