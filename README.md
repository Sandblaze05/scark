# Scark

Scark is a local-first research assistant built with Electron, Next.js, WebLLM, ChromaDB, and SQLite. It combines a desktop chat experience with retrieval-augmented generation, web research, and a background ingestion pipeline for building its own local knowledge base.

## Status

Scark is still a work in progress. The core chat, retrieval, local model inference, and ingestion pipeline are implemented, but the product is still evolving and some flows are rough around the edges.

## What It Can Do Today

### Local AI chat

- Runs LLM inference locally in the renderer through WebLLM using WebGPU.
- Streams responses token-by-token in the desktop UI.
- Caches the downloaded chat model locally after first load.
- Supports stopping an in-progress generation.

### Two response modes

- `Ask` mode favors low-latency responses using local knowledge first.
- `Research` mode performs broader evidence gathering when local context is weak or fresh information is needed.
- Queries are rewritten heuristically so short follow-up prompts can still retrieve the right context.

### Hybrid RAG stack

- Stores semantic vectors in ChromaDB.
- Stores page metadata, cleaned text, chunks, chat history, and user profile data in SQLite.
- Retrieves top matching chunks from local storage before answering.
- Builds source-grounded system prompts with numbered citations.

### Agentic research loop

- Plans tool usage for each request.
- Can choose between local knowledge retrieval, web search, and direct answer paths.
- Includes reflection-based quality checks and limited retry behavior.
- Tracks execution steps so long-running answers can be surfaced progressively in the UI.

### Web research and ingestion

- Performs seed search using search engine scraping.
- Crawls discovered pages with saturation-based stopping instead of only fixed page limits.
- Cleans content with Mozilla Readability.
- Chunks cleaned content for retrieval.
- Generates local embeddings with `@xenova/transformers`.
- Stores newly processed knowledge into ChromaDB and SQLite for future reuse.

### Desktop chat experience

- Electron shell with a Next.js renderer.
- Persistent chat sessions.
- Create, select, rename, pin, search, and delete chats.
- Markdown rendering with syntax highlighting for code blocks.
- Copy-to-clipboard support for generated code blocks.
- Animated UI and streaming status updates.

### Voice and profile features

- Microphone input with local Whisper transcription.
- Saved user profile and response preferences.
- Optional response-complete notification preference.
- Local-only privacy model for stored chats and profile data.

### Background workers and pipeline access

- Separate worker pools for ingestion and query tasks.
- IPC bridge for chat, query, pipeline, profile, and utility actions.
- CLI pipeline entry point for running the ingestion flow outside the desktop UI.

## High-Level Architecture

Scark uses a split architecture:

- `electron/` hosts the main process, window bootstrapping, permissions, and IPC handlers.
- `renderer/` contains the Next.js UI, local WebLLM runtime, Whisper worker, and agent loop.
- `services/` contains Chroma, SQLite, embedding, search, and chat-context services.
- `pipeline/` contains the end-to-end ingestion stages: seed search, crawl, clean, chunk, embed, and store.
- `workers/` provides worker-thread execution for ingestion and retrieval.

The main idea is simple: Scark can answer from local knowledge when possible, research the web when needed, and then store what it learned so future answers can be faster and more grounded.

## Tech Stack

- Electron
- Next.js / React
- WebLLM
- ChromaDB
- SQLite via `better-sqlite3`
- `@xenova/transformers`
- Playwright Extra with stealth plugin
- Tailwind CSS

## Running Locally

### Prerequisites

- Node.js 20 or newer is recommended.
- A running ChromaDB server, or a valid `CHROMA_URL` pointing to one.
- A machine/browser environment with WebGPU support for local WebLLM and Whisper features.
- Microphone access if you want to use voice input.

### Install

```bash
npm install
```

### Start ChromaDB

By default, Scark expects ChromaDB at `http://localhost:8000`.

```bash
chroma run --path ./chroma-data
```

If you already have Chroma running elsewhere, set `CHROMA_URL` accordingly.

### Start the app in development

```bash
npm run dev
```

This starts:

- the Next.js renderer on port `3000`
- the Electron desktop shell

## CLI Pipeline

You can also run the ingestion pipeline directly:

```bash
npm run pipeline
```

That flow launches the crawler pipeline, processes pages, stores results, and writes a JSON snapshot to `results.json` by default.

## Available Scripts

- `npm run dev` starts the renderer and Electron together.
- `npm run dev:renderer` starts only the Next.js renderer on port `3000`.
- `npm run dev:electron` starts only Electron.
- `npm run build:renderer` builds the renderer.
- `npm run build` builds the renderer and packages the Electron app.
- `npm run start` launches Electron.
- `npm run pipeline` runs the ingestion pipeline from the command line.

## Configuration

Scark currently uses environment variables for most runtime tuning.

### Common variables

- `CHROMA_URL`: ChromaDB server URL. Default: `http://localhost:8000`
- `CHROMA_COLLECTION`: Chroma collection name. Default: `scark_chunks`
- `SQLITE_PATH`: path to the SQLite database file
- `EMBED_MODEL`: embedding model ID. Default: `Xenova/nomic-embed-text-v1`
- `SCARK_KEYWORD`: default pipeline keyword for CLI runs
- `SCARK_SEED_COUNT`: number of seed URLs to collect
- `SCARK_CONCURRENCY`: crawler concurrency
- `SCARK_CHUNK_SIZE`: chunk size in words
- `SCARK_CHUNK_OVERLAP`: chunk overlap in words
- `SCARK_OUTPUT`: output JSON file for CLI pipeline runs
- `SCARK_DISABLE_HIGH_PERF_GPU=1`: disables forced high-performance GPU selection

## Data Stored Locally

Scark stores the following on disk:

- chat sessions and messages
- user profile and preferences
- crawled page metadata and cleaned page text
- chunk records used for retrieval
- vector embeddings in ChromaDB
- cached local model assets

By design, the app is local-first. It does not depend on a hosted LLM API for its core chat flow.

## Repository Layout

```text
electron/    Electron main process and preload bridge
pipeline/    ingestion stages and pipeline orchestration
renderer/    Next.js UI, local model runtime, workers, components
services/    Chroma, SQLite, embeddings, search, chat helpers
workers/     worker-thread implementations for ingestion and retrieval
chroma-data/ local Chroma persistence
```

## TLDR

Scark already functions as a local-first desktop research assistant with persistent memory, web-backed retrieval, local inference, and an ingestion pipeline that can continuously expand its knowledge base. It is usable today, but it should still be treated as a work in progress rather than a finished product.
