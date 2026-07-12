/**
 * Datarhei Restreamer/Core API Client
 * Handles authentication and API calls
 */

class RestreamerApi {
    constructor(baseUrl, username, password) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.username = username;
        this.password = password;
        this.token = null;
    }

    /**
     * Login and get JWT token
     */
    async login() {
        const response = await fetch(`${this.baseUrl}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: this.username,
                password: this.password
            })
        });

        if (!response.ok) {
            throw new Error(
                `Restreamer login failed: ${response.status} ${response.statusText}`
            );
        }

        const data = await response.json();

        this.token = data.token;

        return data;
    }


    /**
     * Make authenticated API request
     */
    async request(path, options = {}) {

        if (!this.token) {
            await this.login();
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                ...(options.headers || {})
            }
        });


        // Token expired, retry once
        if (response.status === 401) {
            await this.login();

            return this.request(path, options);
        }


        if (!response.ok) {
            throw new Error(
                `Restreamer API error: ${response.status} ${response.statusText}`
            );
        }

        return response.json();
    }


    /**
     * Test connection
     */
    async getInfo() {
        return this.request('/api/v3');
    }
}


/**
 * Factory from environment
 */
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