import axios from 'axios';
import iconv from 'iconv-lite';
import * as cheerio from 'cheerio';

function detectEncoding(html: Buffer, contentType?: string): string {
  // Check Content-Type header
  if (contentType) {
    const match = contentType.match(/charset=([^\s;]+)/i);
    if (match) {
      console.log('Found encoding in Content-Type:', match[1]);
      return match[1].toLowerCase();
    }
  }

  // Check HTML meta tags
  const htmlStr = html.toString('ascii');

  // <meta charset="xxx">
  const charsetMatch = htmlStr.match(/<meta[^>]+charset=["']?([^"'\s>]+)/i);
  if (charsetMatch) {
    console.log('Found charset in meta tag:', charsetMatch[1]);
    return charsetMatch[1].toLowerCase();
  }

  // <meta http-equiv="Content-Type" content="text/html; charset=xxx">
  const contentTypeMatch = htmlStr.match(/content=["'][^"']*charset=([^"'\s;]+)/i);
  if (contentTypeMatch) {
    console.log('Found charset in http-equiv:', contentTypeMatch[1]);
    return contentTypeMatch[1].toLowerCase();
  }

  console.log('No charset found, defaulting to utf-8');
  return 'utf-8';
}

function normalizeEncoding(encoding: string): string {
  const map: Record<string, string> = {
    'gb2312': 'gbk',
    'gb_2312': 'gbk',
    'gb-2312': 'gbk',
    'gbk': 'gbk',
    'gb18030': 'gb18030',
    'big5': 'big5',
    'utf8': 'utf-8',
    'utf-8': 'utf-8',
  };
  const result = map[encoding.toLowerCase()] || 'utf-8';
  console.log(`Normalized "${encoding}" to "${result}"`);
  return result;
}

async function testFetch() {
  const url = 'https://www.charltonslaw.com/cn/newsletters/227/latest.html';
  console.log('Fetching:', url);

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const buffer = Buffer.from(response.data);
  console.log('Buffer length:', buffer.length);
  console.log('Content-Type header:', response.headers['content-type']);

  const detectedEncoding = detectEncoding(buffer, response.headers['content-type']);
  const encoding = normalizeEncoding(detectedEncoding);

  console.log('Final encoding:', encoding);

  const html = iconv.decode(buffer, encoding);
  console.log('\nFirst 300 chars of decoded HTML:');
  console.log(html.slice(0, 300));

  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  console.log('\nFirst 300 chars of extracted text:');
  console.log(text.slice(0, 300));

  console.log('\nContains 杭萧钢构:', text.includes('杭萧钢构'));
  console.log('Contains 陈玉兴:', text.includes('陈玉兴'));
}

testFetch();
