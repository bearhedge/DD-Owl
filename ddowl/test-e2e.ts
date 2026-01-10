import { searchGoogle } from './src/searcher.js';
import { fetchPageContent, analyzeWithLLM } from './src/analyzer.js';

async function test() {
  console.log('1. Searching for 徐明星 + 洗钱...');
  const results = await searchGoogle('"徐明星" 洗钱', 1, 10);
  console.log('   Found', results.length, 'results');

  // Try each result until we find one that works
  for (let i = 0; i < Math.min(results.length, 5); i++) {
    const result = results[i];
    console.log(`\n2. Trying result ${i + 1}: ${result.title}`);
    console.log('   URL:', result.link);

    console.log('   Fetching page content...');
    const content = await fetchPageContent(result.link);
    console.log('   Content length:', content.length, 'chars');

    if (content.length > 200) {
      console.log('   Preview:', content.slice(0, 150) + '...');
      console.log('\n3. Analyzing with Qwen 72B (this may take a minute)...');
      const analysis = await analyzeWithLLM(content, '徐明星', '洗钱');
      console.log('   Result:', JSON.stringify(analysis, null, 2));
      break;
    } else {
      console.log('   Content too short or blocked, trying next...');
    }
  }
}

test().catch(console.error);
