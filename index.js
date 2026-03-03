import { chromium } from 'playwright';
import fs from 'fs';

const KEYWORD = 'theory of relativity';
const SEED_COUNT = 10;
const MAX_PAGES = 20;
const SAME_DOMAIN = false;
const CONCURRENCY = 5; // number of parallel crawlers
const OUTPUT_FILE = 'results.json';

const getSearchSeeds = async (browser, query, max) => {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Try DuckDuckGo HTML first
    try {
        console.log('Trying DuckDuckGo...');
        const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        await page.goto(ddgUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('.result__a, .result__url, .results .result', { timeout: 10000 });

        const rawLinks = await page.$$eval('.result__a', anchors =>
            anchors.map(a => a.href).filter(href => href.startsWith('http'))
        );
        if (rawLinks.length > 0) {
            await page.close();
            await context.close();
            return [...new Set(rawLinks)].slice(0, max);
        }
    } catch (e) {
        console.log(`DuckDuckGo failed: ${e.message}`);
    }

    // Fallback: Google search
    try {
        console.log('Falling back to Google...');
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('a[href]', { timeout: 10000 });

        const rawLinks = await page.$$eval('#search a[href]', anchors =>
            anchors
                .map(a => a.href)
                .filter(href => href.startsWith('http') && !href.includes('google.com'))
        );
        if (rawLinks.length > 0) {
            await page.close();
            await context.close();
            return [...new Set(rawLinks)].slice(0, max);
        }
    } catch (e) {
        console.log(`Google failed: ${e.message}`);
    }

    // Fallback: Bing search
    try {
        console.log('Falling back to Bing...');
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        await page.goto(bingUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('#b_results a', { timeout: 10000 });

        const rawLinks = await page.$$eval('#b_results h2 a[href]', anchors =>
            anchors
                .map(a => a.href)
                .filter(href => href.startsWith('http') && !href.includes('bing.com'))
        );
        if (rawLinks.length > 0) {
            await page.close();
            await context.close();
            return [...new Set(rawLinks)].slice(0, max);
        }
    } catch (e) {
        console.log(`Bing failed: ${e.message}`);
    }

    await page.close();
    await context.close();
    return [];
};

(async () => {
    const browser = await chromium.launch({ headless: false });

    const seedUrls = await getSearchSeeds(browser, KEYWORD, SEED_COUNT);
    if (seedUrls.length === 0) {
        console.log('No seed URLs found from DuckDuckGo.');
        await browser.close();
        return;
    }

    const visited = new Set();
    const queued = new Set(seedUrls.map(u => u.split('#')[0]));
    const queue = [...queued];
    const results = [];

    // Used only if SAME_DOMAIN is true; based on first seed domain
    const startDomain = new URL(seedUrls[0]).hostname;

    const worker = async (id) => {
        const page = await browser.newPage();

        while (visited.size < MAX_PAGES) {
            const url = queue.shift();
            if (!url) break; // no work right now
            queued.delete(url);

            if (visited.has(url)) continue;
            visited.add(url);

            console.log(`[W${id}] [${visited.size}/${MAX_PAGES}] Crawling: ${url}`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

                const pageText = await page.evaluate(() => document.body?.innerText ?? '');
                const pageTitle = await page.title();

                const lowerText = pageText.toLowerCase();
                const lowerKeyword = KEYWORD.toLowerCase();

                if (lowerText.includes(lowerKeyword)) {
                    // Clean text: collapse whitespace, trim
                    const cleanedText = pageText.replace(/\s+/g, ' ').trim();
                    const wordCount = cleanedText.split(/\s+/).filter(Boolean).length;
                    const domain = new URL(url).hostname;

                    // Count keyword occurrences for density
                    let keywordCount = 0;
                    let searchIdx = 0;
                    while ((searchIdx = lowerText.indexOf(lowerKeyword, searchIdx)) !== -1) {
                        keywordCount++;
                        searchIdx += lowerKeyword.length;
                    }
                    const keywordDensity = wordCount > 0
                        ? parseFloat(((keywordCount / wordCount) * 100).toFixed(4))
                        : 0;

                    results.push({
                        title: pageTitle,
                        url,
                        cleaned_text: cleanedText,
                        metadata: {
                            word_count: wordCount,
                            domain,
                            keyword_density: keywordDensity,
                            timestamp: new Date().toISOString()
                        }
                    });
                    console.log(`[W${id}]   Match found: "${pageTitle}"`);
                }

                const links = await page.$$eval('a[href]', anchors =>
                    anchors.map(a => a.href).filter(href => href.startsWith('http'))
                );

                for (const link of links) {
                    try {
                        const cleanLink = link.split('#')[0];
                        const linkDomain = new URL(cleanLink).hostname;

                        if (!visited.has(cleanLink) &&
                            !queued.has(cleanLink) &&
                            (!SAME_DOMAIN || linkDomain === startDomain) &&
                            visited.size + queue.length < MAX_PAGES * 3 // soft cap
                        ) {
                            queue.push(cleanLink);
                            queued.add(cleanLink);
                        }
                    } catch {
                        // ignore invalid URLs
                    }
                }
            } catch (err) {
                console.log(`[W${id}]   Failed: ${err.message}`);
            }
        }

        await page.close();
    };

    const workers = Array.from(
        { length: Math.min(CONCURRENCY, seedUrls.length) },
        (_, i) => worker(i + 1)
    );

    await Promise.all(workers);

    console.log(`\n========================================`);
    console.log(`Crawl complete. Visited ${visited.size} pages.`);
    console.log(`Found ${results.length} pages matching "${KEYWORD}":\n`);
    results.forEach((r, i) => {
        console.log(`${i + 1}. ${r.title}`);
        console.log(`   ${r.url}\n`);
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`Results saved to ${OUTPUT_FILE}`);

    await browser.close();
})();