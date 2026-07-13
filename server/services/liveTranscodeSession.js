/**
 * Live Transcode Session
 *
 * Separate from TranscodeSession (VOD). Used only for Share Live.
 * Does not modify normal VOD session behavior.
 *
 * Live HLS: sliding window, input seek, no ENDLIST.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const sessions = new Map();
const CACHE_DIR = path.join(process.cwd(), 'live-transcode-cache');
const SEGMENT_DURATION = 4;
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let activeSessionId = null;
let cleanupInterval = null;

function generateSessionId() {
    return crypto.randomBytes(8).toString('hex');
}

async function ensureCacheDir() {
    await fs.mkdir(CACHE_DIR, { recursive: true });
}

class LiveTranscodeSession {
    constructor(url, options = {}) {
        this.id = generateSessionId();
        this.url = url;
        this.dir = path.join(CACHE_DIR, this.id);
        this.playlistPath = path.join(this.dir, 'stream.m3u8');
        this.process = null;
        this.status = 'pending';
        this.error = null;
        this.startTime = Date.now();
        this.lastAccess = Date.now();
        this.options = {
            ffmpegPath: options.ffmpegPath || 'ffmpeg',
            userAgent: options.userAgent || 'Mozilla/5.0',
            seekOffset: options.seekOffset || 0,
            ...options
        };
    }

    touch() {
        this.lastAccess = Date.now();
    }

    buildFFmpegArgs() {
        const seekOffset = Number(this.options.seekOffset) || 0;
        const args = [
            '-hide_banner',
            '-loglevel', 'warning',
            '-user_agent', this.options.userAgent,
            '-probesize', '5000000',
            '-analyzeduration', '5000000',
            '-fflags', '+genpts+discardcorrupt',
            '-err_detect', 'ignore_err',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '3',
            '-rw_timeout', '15000000'
        ];

        // Input seek — required for deep resumes on remote HTTP sources
        if (seekOffset > 0) {
            args.push('-ss', String(seekOffset));
        }

        args.push('-i', this.url);

        // Same stereo downmix + async resample as VOD sessions.
        // Bare `-ac 2` on 5.1/AC3 sources (or drifting timestamps) causes robotic audio.
        const audioFilter =
            'pan=stereo|FL=FL+0.707*FC+0.707*BL+0.5*LFE|FR=FR+0.707*FC+0.707*BR+0.5*LFE,' +
            'aresample=async=1:first_pts=0';

        args.push(
            '-map', '0:v:0',
            '-map', '0:a:0?',
            '-vf', 'scale=-2:720',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '28',
            '-profile:v', 'high',
            '-level', '4.1',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-ar', '48000',
            '-b:a', '192k',
            '-af', audioFilter,
            '-f', 'hls',
            '-hls_time', String(SEGMENT_DURATION),
            '-hls_list_size', '6',
            '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', path.join(this.dir, 'seg%04d.ts'),
            this.playlistPath
        );

        return args;
    }

    async start() {
        if (this.status === 'running') return;

        this.status = 'starting';
        console.log(`[LiveSession ${this.id}] Starting for: ${this.url} (seek=${this.options.seekOffset || 0})`);

        await fs.mkdir(this.dir, { recursive: true });

        const args = this.buildFFmpegArgs();
        console.log(`[LiveSession ${this.id}] Command: ${this.options.ffmpegPath} ${args.join(' ')}`);

        this.process = spawn(this.options.ffmpegPath, args, {
            cwd: this.dir,
            windowsHide: true
        });
        this.status = 'running';

        this.process.stderr.on('data', (data) => {
            const line = data.toString().trim();
            if (line) console.log(`[LiveFFmpeg ${this.id}] ${line}`);
        });

        this.process.on('close', (code) => {
            console.log(`[LiveSession ${this.id}] FFmpeg exited (${code})`);
            this.process = null;
            if (this.status === 'running') {
                this.status = code === 0 ? 'stopped' : 'error';
            }
        });
    }

    stop() {
        if (this.process) {
            console.log(`[LiveSession ${this.id}] Stopping FFmpeg`);
            this.process.kill('SIGTERM');
            setTimeout(() => {
                if (this.process) this.process.kill('SIGKILL');
            }, 2000);
        }
        this.status = 'stopped';
    }

    async isPlaylistReady() {
        try {
            await fs.access(this.playlistPath);
            const content = await fs.readFile(this.playlistPath, 'utf8');
            return content.includes('.ts');
        } catch {
            return false;
        }
    }

    async waitForPlaylist(timeoutMs = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await this.isPlaylistReady()) return true;
            if (this.status === 'error' || this.status === 'stopped') return false;
            await new Promise((r) => setTimeout(r, 250));
        }
        return false;
    }

    async getPlaylist() {
        this.touch();
        try {
            return await fs.readFile(this.playlistPath, 'utf8');
        } catch {
            return null;
        }
    }

    async getSegment(segmentName) {
        this.touch();
        const segmentPath = path.join(this.dir, segmentName);
        try {
            await fs.access(segmentPath);
            return segmentPath;
        } catch {
            return null;
        }
    }

    async cleanup() {
        this.stop();
        await new Promise((r) => setTimeout(r, 300));
        try {
            await fs.rm(this.dir, { recursive: true, force: true });
            console.log(`[LiveSession ${this.id}] Cleaned up`);
        } catch (err) {
            console.error(`[LiveSession ${this.id}] Cleanup failed:`, err.message);
        }
    }
}

async function createLiveSession(url, options = {}) {
    await ensureCacheDir();
    const session = new LiveTranscodeSession(url, options);
    sessions.set(session.id, session);
    return session;
}

function getLiveSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session) session.touch();
    return session;
}

function getActiveLiveSession() {
    if (!activeSessionId) return null;
    return getLiveSession(activeSessionId);
}

async function removeLiveSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return;
    await session.cleanup();
    sessions.delete(sessionId);
    if (activeSessionId === sessionId) activeSessionId = null;
}

/**
 * Replace any active live share with a new encode from sourceUrl.
 */
async function startShareSession(url, options = {}) {
    if (activeSessionId) {
        await removeLiveSession(activeSessionId);
    }

    const session = await createLiveSession(url, options);
    await session.start();

    const ready = await session.waitForPlaylist(60000);
    if (!ready) {
        await removeLiveSession(session.id);
        throw new Error('Live share playlist failed to start in time');
    }

    activeSessionId = session.id;
    return session;
}

async function cleanupStaleLiveSessions() {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (id === activeSessionId) {
            // Keep active share alive while viewers poll
            session.touch();
            continue;
        }
        if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
            await removeLiveSession(id);
        }
    }
}

function startCleanupInterval() {
    if (!cleanupInterval) {
        cleanupInterval = setInterval(cleanupStaleLiveSessions, CLEANUP_INTERVAL_MS);
        cleanupInterval.unref();
    }
}

module.exports = {
    LiveTranscodeSession,
    createLiveSession,
    getLiveSession,
    getActiveLiveSession,
    removeLiveSession,
    startShareSession,
    startCleanupInterval
};
