/**
 * Pipeline Stage 2 – Crawler (parallel workers)
 *
 * Spawns N browser tabs that pull URLs from a shared queue, fetch each page,
 * and return raw page objects.  Link discovery feeds the queue so the crawl
 * expands breadth-first.
 *
 * Data contract
 * ─────────────
 *   Input :  browser, seedUrls[], opts
 *   Output:  RawPage[] — { url, title, html, bodyText, links[] }
 *
 * The raw HTML is preserved so downstream stages (Cleaner) can re-process it
 * independently of the crawl.
 */

import { crawler as defaults } from './config.js';

/**
 * Crawl starting from `seedUrls` using parallel browser workers.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {string[]} seedUrls
 * @param {object}   [opts]
 * @param {number}   [opts.maxPages]
 * @param {number}   [opts.concurrency]
 * @param {boolean}  [opts.sameDomain]
 * @param {number}   [opts.navTimeout]
 * @param {Set<string>} [opts.skipUrls] – URLs to treat as already visited (e.g. from cache)
 * @returns {Promise<Array>}  array of RawPage objects
 */
export async function crawl(browser, seedUrls, opts = {}) {
    const maxPages    = opts.maxPages    ?? defaults.maxPages;
    const concurrency = opts.concurrency ?? defaults.concurrency;
    const sameDomain  = opts.sameDomain  ?? defaults.sameDomain;
    const navTimeout  = opts.navTimeout  ?? defaults.navTimeout;
    const skipUrls    = opts.skipUrls    ?? new Set();

    const visited  = new Set(skipUrls);
    const inFlight = new Set();
    const queued   = new Set(seedUrls.map(u => u.split('#')[0]));
    const queue    = [...queued].filter(u => !visited.has(u));
    const rawPages = [];
    let   activeWorkers = 0;

    const startDomain = seedUrls.length > 0
        ? new URL(seedUrls[0]).hostname
        : '';

    /**
     * A single crawler worker — picks URLs off the shared queue and fetches them.
     */
    const worker = async (id) => {
        const page = await browser.newPage();
        activeWorkers++;

        while (visited.size < maxPages) {
            const url = queue.shift();

            if (!url) {
                // Wait briefly for other workers to enqueue links
                if (activeWorkers <= 1) break;
                await new Promise(r => setTimeout(r, 150));
                continue;
            }

            queued.delete(url);
            if (visited.has(url) || inFlight.has(url)) continue;
            if (visited.size >= maxPages) break;

            inFlight.add(url);
            visited.add(url);

            console.log(`[Crawler W${id}] [${visited.size}/${maxPages}] ${url}`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
                inFlight.delete(url);

                // Capture full HTML + fallback body text
                const html     = await page.content();
                const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
                const title    = await page.title();

                // Discover outbound links for the queue
                const links = await page.$$eval('a[href]', anchors =>
                    anchors.map(a => a.href).filter(href => href.startsWith('http'))
                );

                rawPages.push({ url, title, html, bodyText, links });

                // Enqueue discovered links
                for (const link of links) {
                    try {
                        const cleanLink  = link.split('#')[0];
                        const linkDomain = new URL(cleanLink).hostname;

                        if (
                            !visited.has(cleanLink) &&
                            !inFlight.has(cleanLink) &&
                            !queued.has(cleanLink) &&
                            (!sameDomain || linkDomain === startDomain) &&
                            visited.size + inFlight.size + queue.length < maxPages * 3
                        ) {
                            queue.push(cleanLink);
                            queued.add(cleanLink);
                        }
                    } catch { /* ignore invalid URLs */ }
                }
            } catch (err) {
                inFlight.delete(url);
                console.log(`[Crawler W${id}]   Failed: ${err.message}`);
            }
        }

        activeWorkers--;
        await page.close();
    };

    const workers = Array.from(
        { length: Math.min(concurrency, Math.max(seedUrls.length, 1)) },
        (_, i) => worker(i + 1),
    );
    await Promise.all(workers);

    console.log(`[Crawler] Done – visited ${visited.size} page(s), captured ${rawPages.length} raw page(s).`);
    return rawPages;
}
