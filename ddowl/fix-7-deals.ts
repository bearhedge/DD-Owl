import fs from 'fs';
import axios from 'axios';
import { extractBanksFromProspectus } from './src/prospectus-parser.js';

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  banks?: any[];
}

// The 7 deals we fixed with correct URLs
const fixedDeals = [
  { ticker: 6098, company: 'Country Garden Services Holdings Company Limited', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0606/ltn20180606051.pdf' },
  { ticker: 1856, company: 'Ernest Borel Holdings Limited', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0630/ltn20140630123.pdf' },
  { ticker: 911, company: 'Hang Fat Ginseng Holdings Company Limited', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2014/0617/ltn20140617033.pdf' },
  { ticker: 2076, company: 'KANZHUN LIMITED', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0625/2025062500135.pdf' },
  { ticker: 1933, company: 'OneForce Holdings Limited', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2018/0212/ltn20180212037.pdf' },
  { ticker: 2489, company: 'Persistence Resources Group Ltd', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2023/1214/2023121400075.pdf' },
  { ticker: 3738, company: 'Vobile Group Limited', url: 'https://www1.hkexnews.hk/listedco/listconews/sehk/2017/1219/ltn20171219007.pdf' },
];

async function main() {
  // Load existing results
  const results: ImportResult[] = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));

  console.log('Re-processing 7 fixed deals...\n');

  for (const deal of fixedDeals) {
    console.log(`${deal.ticker} - ${deal.company}`);

    try {
      const resp = await axios.get(deal.url, { responseType: 'arraybuffer', timeout: 120000 });
      const buffer = Buffer.from(resp.data);

      const extracted = await extractBanksFromProspectus(buffer);

      if (extracted.banks.length > 0) {
        // Update the result in the array
        const idx = results.findIndex(r => r.ticker === deal.ticker);
        if (idx !== -1) {
          results[idx] = {
            ticker: deal.ticker,
            company: deal.company,
            success: true,
            banksFound: extracted.banks.length,
            banks: extracted.banks.map(b => ({
              name: b.bank,
              normalized: b.bankNormalized,
              roles: [...b.roles],
              isLead: b.isLead,
              rawRole: b.rawRole,
            })),
          };
          console.log(`  ✓ Updated: ${extracted.banks.length} banks`);
          extracted.banks.forEach(b => console.log(`    - ${b.bankNormalized} (${b.roles.join(', ')})`));
        }
      } else {
        console.log(`  ✗ Still no banks found`);
      }
    } catch (err: any) {
      console.log(`  ✗ Error: ${err.message}`);
    }
  }

  // Save updated results
  fs.writeFileSync('.historical-import-results.json', JSON.stringify(results, null, 2));

  // Print final stats
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log('\n=== Updated Stats ===');
  console.log('Total deals:', results.length);
  console.log('Successful:', successful.length);
  console.log('Failed:', failed.length);
  console.log('Success rate:', (successful.length / results.length * 100).toFixed(1) + '%');
}

main().catch(console.error);
