// DD Owl - Tianyancha Content Script
console.log('DD Owl content script loaded on Tianyancha:', window.location.href);

// Helper: Clean extracted text
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/复制/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect page type from URL
function detectPageType() {
  const url = window.location.href;

  if (url.includes('/human/')) {
    return 'person_profile';
  }
  if (url.includes('/company/') || url.includes('/firm/')) {
    return 'company_profile';
  }
  if (url.includes('/search')) {
    return 'search_results';
  }
  return 'unknown';
}

// Extract role from badges near a company link
function extractRoleFromRow(row) {
  const roles = [];

  // Look for role badges - they appear as small colored tags
  const badges = row.querySelectorAll('[class*="tag"], [class*="label"], [class*="badge"], span[style*="background"], span[style*="color"]');
  badges.forEach(badge => {
    const text = cleanText(badge.textContent);
    // Single character badges
    if (text === '法' || text === '法定代表人') roles.push('法定代表人');
    else if (text === '股' || text === '股东') roles.push('股东');
    else if (text === '董' || text === '董事') roles.push('董事');
    else if (text === '监' || text === '监事') roles.push('监事');
    else if (text === '经' || text === '经理') roles.push('经理');
    else if (text === '总' || text === '总经理') roles.push('总经理');
    // Multi-character role text
    else if (text.includes('法定代表')) roles.push('法定代表人');
    else if (text.includes('股东')) roles.push('股东');
    else if (text.includes('董事')) roles.push('董事');
    else if (text.includes('监事')) roles.push('监事');
    else if (text.includes('经理')) roles.push('经理');
  });

  // Also check cell text for roles
  const cells = row.querySelectorAll('td');
  cells.forEach(cell => {
    const text = cleanText(cell.textContent);
    if (text.length < 20) { // Short text might be a role
      if (text.includes('法定代表人') && !roles.includes('法定代表人')) roles.push('法定代表人');
      if (text.includes('股东') && !roles.includes('股东')) roles.push('股东');
      if (text.includes('董事') && !roles.includes('董事')) roles.push('董事');
      if (text.includes('监事') && !roles.includes('监事')) roles.push('监事');
      if (text.includes('总经理') && !roles.includes('总经理')) roles.push('总经理');
      if (text.includes('经理') && !text.includes('总经理') && !roles.includes('经理')) roles.push('经理');
    }
  });

  return roles.length > 0 ? roles.join(', ') : '';
}

// Extract affiliation from a table row
function extractAffiliationFromRow(row, isCurrent) {
  const companyLink = row.querySelector('a[href*="/company/"]');
  if (!companyLink) return null;

  const affiliation = {
    companyName: cleanText(companyLink.textContent),
    companyUrl: companyLink.href,
    shareholding: '',
    registeredCapital: '',
    establishedDate: '',
    region: '',
    status: '',
    role: extractRoleFromRow(row),
    isCurrent: isCurrent
  };

  // Extract data from cells
  const cells = row.querySelectorAll('td');
  cells.forEach(cell => {
    const text = cleanText(cell.textContent);

    // Shareholding percentage - look for X% or X.XX%
    const percentMatch = text.match(/(\d+\.?\d*%)/);
    if (percentMatch && !affiliation.shareholding) {
      affiliation.shareholding = percentMatch[1];
    }

    // Registered capital
    if (text.includes('万') && (text.includes('人民币') || text.match(/^\d/))) {
      if (!affiliation.registeredCapital) {
        affiliation.registeredCapital = text;
      }
    }

    // Date
    const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch && !affiliation.establishedDate) {
      affiliation.establishedDate = dateMatch[0];
    }

    // Region - province or city
    if ((text.includes('市') || text.includes('省')) && !text.includes('万') && text.length < 15) {
      if (!affiliation.region) {
        affiliation.region = text;
      }
    }

    // Status
    if (text.includes('存续') || text.includes('在营') || text.includes('开业')) {
      affiliation.status = 'active';
    } else if (text.includes('注销')) {
      affiliation.status = 'cancelled';
    } else if (text.includes('吊销')) {
      affiliation.status = 'revoked';
    }
  });

  return affiliation;
}

// Extract person profile data
function extractPersonProfile() {
  const data = {
    pageType: 'person_profile',
    source: 'tianyancha',
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    personName: '',
    affiliations: [],
    currentAffiliations: [],
    historicalAffiliations: [],
    riskInfo: {}
  };

  // Get person name - look for the main title
  const nameEl = document.querySelector('.human-name, h1');
  if (nameEl) {
    data.personName = cleanText(nameEl.textContent);
  }

  // Get risk summary
  const riskText = document.body.innerText;
  const selfRiskMatch = riskText.match(/自身风险[^\d]*(\d+)/);
  const relatedRiskMatch = riskText.match(/周边风险[^\d]*(\d+)/);
  const warningsMatch = riskText.match(/预警提醒[^\d]*(\d+)/);

  if (selfRiskMatch) data.riskInfo.selfRisk = parseInt(selfRiskMatch[1]);
  if (relatedRiskMatch) data.riskInfo.relatedRisk = parseInt(relatedRiskMatch[1]);
  if (warningsMatch) data.riskInfo.warnings = parseInt(warningsMatch[1]);

  // Use Map to deduplicate by URL
  const currentMap = new Map();
  const historicalMap = new Map();
  const allMap = new Map();

  // Find tables and their context (current vs historical)
  const tables = document.querySelectorAll('table');

  tables.forEach(table => {
    // Determine if this is current or historical by looking at nearby headers/tabs
    let isCurrent = true;
    let sectionEl = table.closest('[class*="section"], [class*="module"], [class*="card"], [class*="panel"], div[id]');

    // Look for section title
    let sectionTitle = '';
    if (sectionEl) {
      const titleEl = sectionEl.querySelector('h2, h3, [class*="title"], [class*="header"]');
      if (titleEl) {
        sectionTitle = cleanText(titleEl.textContent);
      }
    }

    // Also check preceding elements
    let prevEl = table.previousElementSibling;
    while (prevEl && !sectionTitle) {
      if (prevEl.tagName === 'H2' || prevEl.tagName === 'H3' || prevEl.className?.includes('title')) {
        sectionTitle = cleanText(prevEl.textContent);
        break;
      }
      prevEl = prevEl.previousElementSibling;
    }

    // Determine current vs historical from title
    if (sectionTitle.includes('曾任职') || sectionTitle.includes('历史')) {
      isCurrent = false;
    }

    // Extract rows
    const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
    rows.forEach(row => {
      // Skip header rows
      if (row.querySelector('th')) return;
      if (row.closest('thead')) return;

      const affiliation = extractAffiliationFromRow(row, isCurrent);
      if (!affiliation) return;

      const url = affiliation.companyUrl;

      // Add to appropriate map (dedupe by URL)
      if (isCurrent) {
        if (!currentMap.has(url)) {
          currentMap.set(url, affiliation);
        }
      } else {
        if (!historicalMap.has(url)) {
          historicalMap.set(url, affiliation);
        }
      }

      // Add to all map (merge roles if duplicate)
      if (allMap.has(url)) {
        const existing = allMap.get(url);
        if (affiliation.role && !existing.role.includes(affiliation.role)) {
          existing.role = existing.role ? `${existing.role}, ${affiliation.role}` : affiliation.role;
        }
        // Take non-empty values
        if (affiliation.shareholding && !existing.shareholding) existing.shareholding = affiliation.shareholding;
        if (affiliation.registeredCapital && !existing.registeredCapital) existing.registeredCapital = affiliation.registeredCapital;
        if (affiliation.establishedDate && !existing.establishedDate) existing.establishedDate = affiliation.establishedDate;
        if (affiliation.region && !existing.region) existing.region = affiliation.region;
        if (affiliation.status && !existing.status) existing.status = affiliation.status;
      } else {
        allMap.set(url, { ...affiliation });
      }
    });
  });

  // Convert maps to arrays
  data.currentAffiliations = Array.from(currentMap.values());
  data.historicalAffiliations = Array.from(historicalMap.values());
  data.affiliations = Array.from(allMap.values());

  console.log(`Extracted: ${data.currentAffiliations.length} current, ${data.historicalAffiliations.length} historical, ${data.affiliations.length} total unique`);

  return data;
}

// Extract company profile data
function extractCompanyProfile() {
  const data = {
    pageType: 'company_profile',
    source: 'tianyancha',
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    companyName: '',
    legalRepresentative: '',
    registeredCapital: '',
    establishedDate: '',
    status: '',
    companyNumber: '',
    address: '',
    businessScope: '',
    shareholders: [],
    executives: []
  };

  // Company name
  const nameEl = document.querySelector('h1, [class*="company-name"], [class*="name"]');
  if (nameEl) {
    data.companyName = cleanText(nameEl.textContent);
  }

  // Look for info items in detail sections
  const infoItems = document.querySelectorAll('[class*="detail"] td, [class*="info"] td, [class*="base"] td');
  infoItems.forEach((item, idx, items) => {
    const text = cleanText(item.textContent);
    const prevText = idx > 0 ? cleanText(items[idx - 1].textContent) : '';

    if (prevText.includes('法定代表人') || prevText.includes('法人')) {
      data.legalRepresentative = text;
    }
    if (prevText.includes('注册资本')) {
      data.registeredCapital = text;
    }
    if (prevText.includes('成立日期') || prevText.includes('成立时间')) {
      data.establishedDate = text;
    }
    if (prevText.includes('统一社会信用代码') || prevText.includes('信用代码')) {
      data.companyNumber = text;
    }
    if (prevText.includes('经营状态') || prevText.includes('企业状态')) {
      data.status = text;
    }
    if (prevText.includes('注册地址') || prevText.includes('企业地址')) {
      data.address = text;
    }
    if (prevText.includes('经营范围')) {
      data.businessScope = text;
    }
  });

  // Extract shareholders from tables
  const tables = document.querySelectorAll('table');
  tables.forEach(table => {
    const headerText = table.closest('section')?.querySelector('h2, h3, [class*="title"]')?.textContent || '';

    if (headerText.includes('股东') || headerText.includes('出资')) {
      const rows = table.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const nameLink = row.querySelector('a');
          const shareholder = {
            name: nameLink ? cleanText(nameLink.textContent) : cleanText(cells[0].textContent),
            percentage: '',
            amount: ''
          };

          cells.forEach(cell => {
            const text = cleanText(cell.textContent);
            if (text.includes('%')) shareholder.percentage = text;
            if (text.includes('万')) shareholder.amount = text;
          });

          if (shareholder.name) data.shareholders.push(shareholder);
        }
      });
    }
  });

  return data;
}

// Extract search results
function extractSearchResults() {
  const data = {
    pageType: 'search_results',
    source: 'tianyancha',
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    results: []
  };

  const resultItems = document.querySelectorAll('[class*="search-item"], [class*="result-item"], [class*="company-item"]');
  resultItems.forEach(item => {
    const link = item.querySelector('a[href*="/company/"]');
    if (link) {
      data.results.push({
        companyName: cleanText(link.textContent),
        companyUrl: link.href
      });
    }
  });

  data.resultCount = data.results.length;
  return data;
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Tianyancha content script received:', message);

  if (message.type === 'EXTRACT_DATA') {
    try {
      const pageType = detectPageType();
      let data;

      if (pageType === 'person_profile') {
        data = extractPersonProfile();
      } else if (pageType === 'company_profile') {
        data = extractCompanyProfile();
      } else if (pageType === 'search_results') {
        data = extractSearchResults();
      } else {
        data = {
          error: 'Unknown page type - navigate to a person or company profile',
          pageType,
          url: window.location.href
        };
      }

      sendResponse({ success: true, data });
    } catch (error) {
      console.error('Extraction error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  // Extract company URLs for auto-research
  if (message.type === 'EXTRACT_COMPANY_URLS') {
    try {
      const pageType = detectPageType();
      if (pageType !== 'person_profile') {
        sendResponse({ success: false, error: 'Not on a person profile page' });
        return true;
      }

      // Get person name
      const nameEl = document.querySelector('h1, [class*="human-name"], [class*="name"]');
      const personName = nameEl ? cleanText(nameEl.textContent) : 'Unknown';

      // Find all company links
      const companies = [];
      const companyLinks = document.querySelectorAll('a[href*="/company/"]');

      companyLinks.forEach(link => {
        const url = link.href;
        const name = cleanText(link.textContent);

        if (!name || !url) return;
        if (companies.find(c => c.url === url)) return;

        // Try to get role from nearby elements
        let role = '';
        const row = link.closest('tr');
        if (row) {
          const badge = row.querySelector('[class*="tag"], [class*="label"], [class*="badge"]');
          if (badge) role = cleanText(badge.textContent);
        }

        companies.push({ name, url, role });
      });

      console.log(`Found ${companies.length} company URLs for ${personName}`);
      sendResponse({ success: true, personName, companies });
    } catch (error) {
      console.error('Extract URLs error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  return false;
});

console.log('Tianyancha content script ready');
