/**
 * Scark – entry point
 *
 * Thin CLI wrapper around the modular pipeline.
 *
 * Pipeline stages are independently importable from  ./pipeline/
 * so crawl-only or embed-only workers can cherry-pick what they need:
 *
 *   import { crawl }  from './pipeline/index.js';   // crawl worker
 *   import { embed, store } from './pipeline/index.js';  // embed worker
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

import { runPipeline } from './pipeline/index.js';
import { output }      from './pipeline/config.js';

chromium.use(StealthPlugin());

(async () => {
    const browser = await chromium.launch({ headless: true });

    try {
        const { pages, newPages, stats } = await runPipeline(browser);

        // ── Summary ───────────────────────────────────────
        console.log('\n========================================');
        console.log(`Pipeline complete.`);
        console.log(`  Total pages processed : ${pages.length}`);
        console.log(`  New pages stored      : ${newPages.length}`);

        pages.forEach((r, i) => {
            console.log(`${i + 1}. ${r.title}`);
            console.log(`   ${r.url}\n`);
        });

        // ── Dump results to disk ──────────────────────────
        fs.writeFileSync(output.file, JSON.stringify(pages, null, 2), 'utf-8');
        console.log(`Results saved to ${output.file}`);
    } finally {
        await browser.close();
    }
})();