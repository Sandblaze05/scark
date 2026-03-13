// Polyfill process/global BEFORE importing @xenova/transformers.
// Static imports are hoisted in ES modules, so dynamic import() is required.
const g = globalThis;

function ensureProcessPolyfills() {
    try {
        if (!g.process || typeof g.process !== 'object') {
            g.process = {};
        }
        if (!g.process.versions || typeof g.process.versions !== 'object') {
            g.process.versions = {};
        }
        if (!g.process.env || typeof g.process.env !== 'object') {
            g.process.env = {};
        }
        if (!g.process.release || typeof g.process.release !== 'object') {
            g.process.release = { name: 'browser' };
        }
    } catch {
        // Best-effort only; worker continues and reports detailed init errors.
    }

    try {
        if (!g.global) {
            g.global = g;
        }
    } catch {
        // ignore
    }
}

ensureProcessPolyfills();

let transformersModule = null;

async function getTransformers() {
    if (!transformersModule) {
        ensureProcessPolyfills();
        transformersModule = await import('@xenova/transformers');
        if (transformersModule?.env) {
            transformersModule.env.allowLocalModels = false;
            transformersModule.env.useBrowserCache = true;
        }
    }
    return transformersModule;
}

class PipelineFactory {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny.en';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            const { pipeline } = await getTransformers();
            this.instance = await pipeline(this.task, this.model, {
                progress_callback,
                revision: 'main',
            });
        }
        return this.instance;
    }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
    try {
        const payload = (event && typeof event.data === 'object' && event.data !== null) ? event.data : {};
        const audio = payload.audio;
        if (!audio || typeof audio.length !== 'number') {
            throw new Error('Invalid audio payload received by whisper worker.');
        }
        console.log('[Worker] Received audio data, length:', audio.length);

        const transcriber = await PipelineFactory.getInstance(data => {
            self.postMessage({ status: 'progress', data });
        });

        console.log('[Worker] Pipeline ready, starting transcription...');
        self.postMessage({ status: 'decoding' });

        const result = await transcriber(audio, {
            chunk_length_s: 30,
            stride_length_s: 5,
        });

        console.log('[Worker] Transcription complete:', result.text);
        self.postMessage({
            status: 'complete',
            text: result.text
        });

    } catch (err) {
        console.error('[Worker] Error:', err);
        self.postMessage({
            status: 'error',
            error: {
                message: err?.message || String(err),
                stack: err?.stack || null,
                name: err?.name || null,
            }
        });
    }
});
