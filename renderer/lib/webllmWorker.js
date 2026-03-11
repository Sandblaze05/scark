/**
 * WebLLM Web Worker host.
 *
 * This file runs inside a dedicated Web Worker so that model inference
 * (tokenisation, GPU dispatch, KV-cache management) happens on a separate
 * thread and never blocks the React/UI main thread.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
