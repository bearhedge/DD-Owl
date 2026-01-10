/**
 * Debug - check what content we're actually fetching
 */

import { fetchPageContent } from './src/analyzer.js';

const testUrls = [
  'https://www.spp.gov.cn/llyj/200804/t20080403_50777.shtml',
  'https://jjckb.xinhuanet.com/jjft/2008-02/05/content_84633.htm',
  'https://www.charltonslaw.com/cn/newsletters/227/latest.html',
];

async function debug() {
  for (const url of testUrls) {
    console.log('═'.repeat(70));
    console.log(`URL: ${url}`);
    console.log('═'.repeat(70));

    const content = await fetchPageContent(url);
    console.log(`Length: ${content.length} chars`);
    console.log('');
    console.log('First 1000 chars:');
    console.log(content.slice(0, 1000));
    console.log('\n');
  }
}

debug().catch(console.error);
