import { fetchPageContent, closeBrowser } from './src/analyzer.js';

async function test() {
  const content = await fetchPageContent('https://www.charltonslaw.com/cn/newsletters/227/latest.html');
  console.log('Content length:', content.length);
  console.log('');
  console.log('First 500 chars:');
  console.log(content.slice(0, 500));
  console.log('');
  console.log('Contains 陈玉兴:', content.includes('陈玉兴'));
  console.log('Contains 杭萧钢构:', content.includes('杭萧钢构'));
  console.log('Contains 罗高峰:', content.includes('罗高峰'));
  await closeBrowser();
}
test();
