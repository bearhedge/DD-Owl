import fs from 'fs';
import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ImportResult {
  ticker: number;
  company: string;
  success: boolean;
  banksFound: number;
  error?: string;
  banks?: Array<any>;
}

// Normalize bank object to consistent format
function normalizeBank(b: any): { fullName: string; shortName: string; roles: string[]; isLead: boolean; rawRole: string } {
  return {
    fullName: b.name || b.bank || 'Unknown',
    shortName: b.normalized || b.bankNormalized || 'Unknown',
    roles: b.roles || [],
    isLead: b.isLead || false,
    rawRole: b.rawRole || '',
  };
}

interface ExcelDeal {
  ticker: number;
  company: string;
  type: string;
  prospectusUrl: string;
  date: string;
}

// Read Excel to get URLs and dates
function readExcel(): Map<number, ExcelDeal> {
  const excelPath = path.join(__dirname, '../Reference files/2. HKEX IPO Listed (Historical)/HKEX_IPO_Listed.xlsx');
  const workbook = xlsx.readFile(excelPath);
  const indexSheet = workbook.Sheets['Index'];
  const rows = xlsx.utils.sheet_to_json(indexSheet, { header: 1 }) as any[][];

  const deals = new Map<number, ExcelDeal>();

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[1]) continue;

    const ticker = typeof row[1] === 'number' ? row[1] : parseInt(row[1]);
    if (isNaN(ticker)) continue;

    deals.set(ticker, {
      ticker,
      company: String(row[2] || '').trim(),
      type: String(row[3] || '').trim(),
      prospectusUrl: String(row[4] || '').trim(),
      date: String(row[5] || '').trim(),
    });
  }

  return deals;
}

// Generate HTML
function generateHtml(results: ImportResult[], excelData: Map<number, ExcelDeal>): string {
  const successful = results.filter(r => r.success).sort((a, b) => {
    const dateA = excelData.get(a.ticker)?.date || '';
    const dateB = excelData.get(b.ticker)?.date || '';
    return dateB.localeCompare(dateA);
  });

  // Count total banks
  let totalBanks = 0;
  successful.forEach(r => totalBanks += r.banksFound);

  // Get unique banks (use shortName for counting)
  const bankCounts = new Map<string, number>();
  successful.forEach(r => {
    r.banks?.forEach(b => {
      const bank = normalizeBank(b);
      bankCounts.set(bank.shortName, (bankCounts.get(bank.shortName) || 0) + 1);
    });
  });

  const topBanks = [...bankCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // Collect all unique raw roles
  const allRoles = new Set<string>();
  successful.forEach(r => {
    r.banks?.forEach(b => {
      const bank = normalizeBank(b);
      if (bank.rawRole) allRoles.add(bank.rawRole);
    });
  });

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IPO Historical Data Review (2015-2023)</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1600px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      font-size: 14px;
    }
    h1 { color: #333; margin-bottom: 10px; }
    .subtitle { color: #666; margin-bottom: 30px; }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      text-align: center;
    }
    .stat-number { font-size: 32px; font-weight: bold; color: #2196F3; }
    .stat-label { color: #666; margin-top: 5px; }

    .top-banks {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .top-banks h3 { margin-top: 0; }
    .bank-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .bank-chip {
      background: #E3F2FD;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 13px;
    }
    .bank-chip .count { color: #1976D2; font-weight: bold; }

    .filters {
      background: white;
      padding: 15px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      gap: 20px;
      align-items: center;
      flex-wrap: wrap;
    }
    .filters input, .filters select {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }
    .filters input { width: 300px; }

    .deal-card {
      background: white;
      border-radius: 8px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .deal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 20px;
      background: #fafafa;
      border-bottom: 1px solid #eee;
    }
    .deal-title {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .ticker {
      background: #2196F3;
      color: white;
      padding: 4px 10px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 13px;
    }
    .company-name { font-weight: 500; font-size: 15px; }
    .deal-meta {
      display: flex;
      gap: 20px;
      color: #666;
      font-size: 13px;
    }
    .deal-body { padding: 15px 20px; }

    .banks-table {
      width: 100%;
      border-collapse: collapse;
    }
    .banks-table th {
      text-align: left;
      padding: 8px 12px;
      background: #f8f9fa;
      font-size: 12px;
      color: #666;
      border-bottom: 1px solid #eee;
    }
    .banks-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #f0f0f0;
      vertical-align: top;
    }
    .banks-table tr:last-child td { border-bottom: none; }

    .bank-row.decision-maker {
      background: linear-gradient(90deg, #FFF8E1 0%, white 100%);
    }
    .bank-row.decision-maker td:first-child {
      border-left: 4px solid #FFC107;
    }

    .decision-badge {
      display: inline-block;
      background: #FFC107;
      color: #333;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 8px;
    }

    .bank-full-name {
      font-weight: 500;
      color: #333;
    }
    .raw-role {
      font-size: 12px;
      color: #666;
      font-style: italic;
    }

    .pdf-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: #1976D2;
      text-decoration: none;
      font-size: 13px;
    }
    .pdf-link:hover { text-decoration: underline; }

    .hidden { display: none !important; }

    .roles-found {
      background: white;
      padding: 15px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .roles-found h3 { margin-top: 0; font-size: 14px; }
    .role-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .role-chip {
      background: #f0f0f0;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>IPO Historical Data Review</h1>
  <p class="subtitle">2015-2023 HKEX IPO Deals - Review for accuracy. Decision makers (first listed) are highlighted.</p>

  <div class="summary">
    <div class="stat-card">
      <div class="stat-number">${successful.length}</div>
      <div class="stat-label">Deals Extracted</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${totalBanks}</div>
      <div class="stat-label">Bank Relationships</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${bankCounts.size}</div>
      <div class="stat-label">Unique Banks</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">85</div>
      <div class="stat-label">Delisted (no PDF)</div>
    </div>
  </div>

  <div class="top-banks">
    <h3>Top 20 Banks by Deal Count</h3>
    <div class="bank-list">
      ${topBanks.map(([bank, count]) => `<span class="bank-chip">${bank} <span class="count">(${count})</span></span>`).join('')}
    </div>
  </div>

  <div class="roles-found">
    <h3>All Roles Found in PDFs (${allRoles.size} unique)</h3>
    <div class="role-chips">
      ${[...allRoles].sort().map(role => `<span class="role-chip">${role}</span>`).join('')}
    </div>
  </div>

  <div class="filters">
    <input type="text" id="search" placeholder="Search by ticker, company, or bank name...">
    <select id="yearFilter">
      <option value="">All Years</option>
      <option value="2023">2023</option>
      <option value="2022">2022</option>
      <option value="2021">2021</option>
      <option value="2020">2020</option>
      <option value="2019">2019</option>
      <option value="2018">2018</option>
      <option value="2017">2017</option>
      <option value="2016">2016</option>
      <option value="2015">2015</option>
    </select>
    <select id="bankFilter">
      <option value="">All Banks</option>
      ${topBanks.map(([bank]) => `<option value="${bank}">${bank}</option>`).join('')}
    </select>
    <span id="resultCount">${successful.length} deals</span>
  </div>

  <div id="deals">
`;

  for (const result of successful) {
    const excel = excelData.get(result.ticker);
    const date = excel?.date || 'Unknown';
    const year = date.split('/')[2] || '';
    const pdfUrl = excel?.prospectusUrl || '';

    // Normalize all banks
    const banks = (result.banks || []).map(normalizeBank);
    const bankNames = banks.map(b => b.shortName + ' ' + b.fullName).join(' ').toLowerCase();

    html += `
    <div class="deal-card" data-ticker="${result.ticker}" data-company="${result.company.toLowerCase()}" data-banks="${bankNames}" data-year="${year}">
      <div class="deal-header">
        <div class="deal-title">
          <span class="ticker">${result.ticker}</span>
          <span class="company-name">${result.company}</span>
        </div>
        <div class="deal-meta">
          <span>📅 ${date}</span>
          <span>🏦 ${banks.length} banks</span>
          ${pdfUrl ? `<a href="${pdfUrl}" target="_blank" class="pdf-link">📄 View PDF</a>` : '<span style="color:#999">No PDF</span>'}
        </div>
      </div>
      <div class="deal-body">
        <table class="banks-table">
          <thead>
            <tr>
              <th style="width: 50%">Bank (Full Name from PDF)</th>
              <th>Role (from PDF)</th>
            </tr>
          </thead>
          <tbody>
            ${(() => {
              // Smart decision maker identification based on role hierarchy
              // Priority: sponsor > coordinator > bookrunner > lead manager
              const roleHierarchy = ['sponsor', 'coordinator', 'bookrunner', 'lead', 'manager'];

              // Find the highest priority role present
              let decisionMakerRole: string | null = null;
              for (const priority of roleHierarchy) {
                const hasRole = banks.some(b => b.rawRole.toLowerCase().includes(priority));
                if (hasRole) {
                  decisionMakerRole = priority;
                  break;
                }
              }

              return banks.map((bank) => {
                // A bank is a decision maker if it has the highest priority role
                const bankRoleLower = bank.rawRole.toLowerCase();
                const isDecisionMaker = decisionMakerRole ? bankRoleLower.includes(decisionMakerRole) : false;

                return `
            <tr class="bank-row${isDecisionMaker ? ' decision-maker' : ''}">
              <td>
                <span class="bank-full-name">${bank.fullName}</span>
                ${isDecisionMaker ? '<span class="decision-badge">DECISION MAKER</span>' : ''}
              </td>
              <td><span class="raw-role">${bank.rawRole || 'Unknown Role'}</span></td>
            </tr>`;
              }).join('');
            })()}
          </tbody>
        </table>
      </div>
    </div>
`;
  }

  html += `
  </div>

  <script>
    const searchInput = document.getElementById('search');
    const yearFilter = document.getElementById('yearFilter');
    const bankFilter = document.getElementById('bankFilter');
    const resultCount = document.getElementById('resultCount');
    const deals = document.querySelectorAll('.deal-card');

    function filterDeals() {
      const search = searchInput.value.toLowerCase();
      const year = yearFilter.value;
      const bank = bankFilter.value.toLowerCase();

      let visible = 0;
      deals.forEach(deal => {
        const ticker = deal.dataset.ticker;
        const company = deal.dataset.company;
        const banks = deal.dataset.banks;
        const dealYear = deal.dataset.year;

        const matchesSearch = !search ||
          ticker.includes(search) ||
          company.includes(search) ||
          banks.includes(search);
        const matchesYear = !year || dealYear === year;
        const matchesBank = !bank || banks.includes(bank);

        if (matchesSearch && matchesYear && matchesBank) {
          deal.classList.remove('hidden');
          visible++;
        } else {
          deal.classList.add('hidden');
        }
      });

      resultCount.textContent = visible + ' deals';
    }

    searchInput.addEventListener('input', filterDeals);
    yearFilter.addEventListener('change', filterDeals);
    bankFilter.addEventListener('change', filterDeals);
  </script>
</body>
</html>`;

  return html;
}

async function main() {
  console.log('Loading results...');
  const results: ImportResult[] = JSON.parse(fs.readFileSync('.historical-import-results.json', 'utf8'));

  console.log('Loading Excel data...');
  const excelData = readExcel();

  console.log('Generating HTML...');
  const html = generateHtml(results, excelData);

  const outputPath = path.join(__dirname, 'historical-review.html');
  fs.writeFileSync(outputPath, html);

  console.log(`\nGenerated: ${outputPath}`);
  console.log(`Open: http://localhost:8888/historical-review.html`);
}

main().catch(console.error);
