export const getSearchSeeds = async (browser, query, max, opts = {}) => {
    const gotoTimeout = opts.gotoTimeout ?? 20000;
    const selectorTimeout = opts.selectorTimeout ?? 10000;
    const totalTimeout = opts.totalTimeout ?? 60000;
    const startedAt = Date.now();

    const hasBudget = () => (Date.now() - startedAt) < totalTimeout;

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale: 'en-US',
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });
    const page = await context.newPage();

    // Try DuckDuckGo HTML first
    try {
        if (hasBudget()) {
            console.log('Trying DuckDuckGo...');
            const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            await page.goto(ddgUrl, { waitUntil: 'domcontentloaded', timeout: gotoTimeout });
            await page.waitForSelector('.result__a, .result__url, .results .result', { timeout: selectorTimeout });

            const rawLinks = await page.$$eval('.result__a', anchors =>
                anchors.map(a => a.href).filter(href => href.startsWith('http'))
            );
            if (rawLinks.length > 0) {
                await page.close();
                await context.close();
                return [...new Set(rawLinks)].slice(0, max);
            }
        } else {
            console.log('Skipping DuckDuckGo due to seed-search budget limit.');
        }
    } catch (e) {
        console.log(`DuckDuckGo failed: ${e.message}`);
    }

    // Fallback: Google search
    try {
        if (hasBudget()) {
            console.log('Falling back to Google...');
            const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: gotoTimeout });
            await page.waitForSelector('a[href]', { timeout: selectorTimeout });

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
        } else {
            console.log('Skipping Google due to seed-search budget limit.');
        }
    } catch (e) {
        console.log(`Google failed: ${e.message}`);
    }

    // Fallback: Bing search
    try {
        if (hasBudget()) {
            console.log('Falling back to Bing...');
            const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
            await page.goto(bingUrl, { waitUntil: 'domcontentloaded', timeout: gotoTimeout });
            await page.waitForSelector('#b_results a', { timeout: selectorTimeout });

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
        } else {
            console.log('Skipping Bing due to seed-search budget limit.');
        }
    } catch (e) {
        console.log(`Bing failed: ${e.message}`);
    }

    await page.close();
    await context.close();
    return [];
};