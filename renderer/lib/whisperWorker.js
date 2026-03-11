// Webpack 5 does not polyfill 'process' in web workers, which causes
// @xenova/transformers/src/env.js to throw a TypeError when it calls Object.keys()
// on process.versions. We must safely polyfill it BEFORE importing.
if (typeof process === 'undefined') {
    self.process = { versions: {} };
} else if (!process.versions) {
    process.versions = {};
}
if (typeof global === 'undefined') {
    self.global = self;
}

import { pipeline, env } from '@xenova/transformers';

// Disable local models directory since we are letting transformers download directly to cache from HF Hub
env.allowLocalModels = false;
// Useful for electron to use fetch properly
env.useBrowserCache = true;

class PipelineFactory {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny.en';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                progress_callback,
                revision: 'main'
            });
        }
        return this.instance;
    }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
    // We only expect one type of message: { audio: Float32Array }
    const { audio } = event.data;

    try {
        // Retrieve the ASR pipeline
        const transcriber = await PipelineFactory.getInstance(data => {
            // Optional: send download progress back to the main thread
            self.postMessage({ status: 'progress', data });
        });

        self.postMessage({ status: 'decoding' });

        // Run the audio through the model
        const result = await transcriber(audio, {
            chunk_length_s: 30, // Max audio chunk size Whisper can process
            stride_length_s: 5,
        });

        // Send the result back
        self.postMessage({
            status: 'complete',
            text: result.text
        });

    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
});
