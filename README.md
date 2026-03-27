# Scark

Scark is a desktop application scaffolded with Nextron (Electron + Next.js) that focuses on local/experimental AI workflows, web content extraction, and a fast developer-friendly UI. This repository provides the app shell and several integrated libraries to enable local inference, content processing, vector storage, and automated browsing — all packaged as an Electron desktop app.

> NOTE: Scark is a work in progress. Core functionality is available, but many features are experimental and actively being developed. Expect new features, improvements, and breaking changes in upcoming updates.

## Current capabilities

- Electron + Nextron desktop app shell
  - Cross-platform desktop packaging via electron-builder.
- Dynamic deliberation based thinking loop
  - `agentLoop.js` describes how the model deliberates actions
- Standardized tool registry
  - Any tool initialized by the tool registry can be used by the model.
- Local/experimental LLM support
  - Libraries present: @mlc-ai/web-llm and @xenova/transformers — used for running models locally (experimental).
- Embeddings and vector store integration
  - chromadb and better-sqlite3 are included for storing and querying embeddings and doing vector similarity searches.
- Web content extraction and document parsing
  - @mozilla/readability and jsdom are available for extracting readable article content from arbitrary web pages.
- Automated, stealthy web interaction and scraping
  - Playwright (and playwright-extra) plus puppeteer-extra-plugin-stealth are included for headless/automated browsing and stealthy scraping when needed.
- Markdown rendering and syntax highlighting
  - react-markdown and react-syntax-highlighter are present for rendering rich, readable content in the UI.
- Persistent local settings
  - electron-store is used for saving app settings persistently across runs.
- UI and animation tooling
  - @geist-ui/react, Tailwind CSS, framer-motion, gsap, lucide-react and next-themes are available for building a polished, responsive interface and animations.
- Developer & testing tooling
  - Playwright config and tooling are included for end-to-end tests.
- Packaging hooks
  - electron-builder config is present to help build distributable desktop installers.

## Quick start

1. Clone the repo
   - git clone https://github.com/Sandblaze05/scark.git
2. Install dependencies
   - yarn or npm install
3. Development
   - yarn dev (or `npm run dev` / `pnpm run dev`)
4. Build for production
   - yarn build (or `npm run build` / `pnpm run build`)
5. Packaging
   - electron-builder is configured in `electron-builder.yml` (postinstall hook in package.json installs app deps for building).

(See package.json for exact script names and current dev/build commands.)

## Project layout (high level)
- main/ — Electron main process code
- renderer/ — Next.js / React renderer UI
- services/, workers/, lib/ — service layer and auxiliary code (placeholders for current/next features)
- resources/ — static app resources and assets
- pipeline/ — automation/test pipelines and scripts

## Roadmap / coming soon
- Improved local model orchestration and easier model downloads for local inference (more model types & UI).
- UI for building/searching vector stores and inspecting embeddings.
- Workflow editor for automated scraping, content ingestion, and chunking pipelines.
- Better error handling, auto-updates, and cross-platform packaging improvements.
- User preferences, onboarding, and sample datasets to get started quickly.
- Autonomous task execution capabilities within a sandbox.

If you have feature ideas, bug reports, or want to help implement features, please open an issue or submit a PR.

## Contributing
Contributions are welcome. If you plan to contribute:
- Open an issue describing the feature or bug first (so we can coordinate).
- Follow the existing code style (Next + React + Tailwind patterns).

## Notes & warnings
- Many dependencies relate to experimental local ML usage. Running large models locally may require substantial disk space, memory, and compatible hardware.

---

Scark is evolving rapidly — this README reflects the repository's current state and intended direction. Expect more user-facing features and improvements soon.
