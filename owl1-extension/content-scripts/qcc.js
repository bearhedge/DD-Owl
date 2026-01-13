// DD Owl - QCC Content Script
console.log('DD Owl content script loaded on:', window.location.href);

// Helper: Clean extracted text by removing UI artifacts
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/复制/g, '')           // Remove "copy" button text
    .replace(/关联企业\s*\d*/g, '')  // Remove "关联企业 N"
    .replace(/…展开/g, '')          // Remove "...expand"
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .trim();
}

// Helper: Extract value from a cell, preferring .copy-value if present
function extractCellValue(cell) {
  const copyValue = cell.querySelector('.copy-value');
  if (copyValue) {
    return cleanText(copyValue.textContent);
  }
  return cleanText(cell.textContent);
}

// Detect pagination on page
function detectPagination() {
  const pagination = {
    hasPagination: false,
    currentPage: 1,
    totalPages: 1,
    hasNextPage: false,
    pageUrls: []
  };

  // QCC uses .ant-pagination or similar
  const paginationEl = document.querySelector('.ant-pagination, [class*="pagination"], .page-list');
  if (!paginationEl) return pagination;

  pagination.hasPagination = true;

  // Find current page
  const activePage = paginationEl.querySelector('.ant-pagination-item-active, [class*="active"], .current');
  if (activePage) {
    pagination.currentPage = parseInt(activePage.textContent) || 1;
  }

  // Find all page links
  const pageItems = paginationEl.querySelectorAll('.ant-pagination-item, [class*="page-item"]:not(.prev):not(.next)');
  pageItems.forEach(item => {
    const pageNum = parseInt(item.textContent);
    if (pageNum && !isNaN(pageNum)) {
      pagination.pageUrls.push({
        page: pageNum,
        element: item.tagName
      });
      if (pageNum > pagination.totalPages) {
        pagination.totalPages = pageNum;
      }
    }
  });

  // Find next button
  const nextBtn = paginationEl.querySelector('.ant-pagination-next:not(.ant-pagination-disabled), [class*="next"]:not(.disabled)');
  if (nextBtn) {
    pagination.hasNextPage = true;
  }

  return pagination;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);

  if (message.type === 'EXTRACT_DATA') {
    try {
      const pageType = detectPageType();
      let data;

      if (pageType === 'company_profile') {
        data = extractCompanyProfile();
      } else if (pageType === 'person_profile') {
        data = extractPersonProfile();
      } else if (pageType === 'search_results') {
        data = extractSearchResults();
      } else {
        data = {
          error: 'Unknown page type - navigate to a company profile or search results',
          pageType,
          url: window.location.href
        };
      }

      sendResponse({ success: true, data: data });
    } catch (error) {
      console.error('Extraction error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  // Extract company URLs for auto-research (Research All button)
  if (message.type === 'EXTRACT_COMPANY_URLS') {
    try {
      const pageType = detectPageType();
      if (pageType !== 'person_profile') {
        sendResponse({ success: false, error: 'Not on a person profile page' });
        return true;
      }

      // Get person name
      const nameEl = document.querySelector('h1, .person-name, [class*="title"]');
      const personName = nameEl ? cleanText(nameEl.textContent) : 'Unknown';

      // Find all company links in affiliation tables
      const companies = [];
      const companyLinks = document.querySelectorAll('a[href*="/firm/"]');

      companyLinks.forEach(link => {
        const url = link.href;
        const name = cleanText(link.textContent);

        // Skip empty or duplicate
        if (!name || !url) return;
        if (companies.find(c => c.url === url)) return;

        // Try to get role from parent row
        let role = '';
        const row = link.closest('tr');
        if (row) {
          const cells = row.querySelectorAll('td');
          cells.forEach(cell => {
            const text = cleanText(cell.textContent);
            if (text.includes('股东') || text.includes('董事') || text.includes('监事') ||
                text.includes('经理') || text.includes('代表') || text.includes('法定代表人')) {
              if (!role) role = text;
            }
          });
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

  if (message.type === 'CLICK_NEXT_PAGE') {
    try {
      const paginationEl = document.querySelector('.ant-pagination, [class*="pagination"]');
      if (!paginationEl) {
        sendResponse({ success: false, error: 'No pagination found' });
        return true;
      }

      const nextBtn = paginationEl.querySelector('.ant-pagination-next:not(.ant-pagination-disabled), [class*="next"]:not(.disabled)');
      if (!nextBtn) {
        sendResponse({ success: false, error: 'No next page available' });
        return true;
      }

      nextBtn.click();

      // Wait for content to load then respond
      setTimeout(() => {
        sendResponse({ success: true, message: 'Clicked next page' });
      }, 1500);

      return true;
    } catch (error) {
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  if (message.type === 'CLICK_PAGE') {
    try {
      const pageNum = message.pageNumber;
      const paginationEl = document.querySelector('.ant-pagination, [class*="pagination"]');
      if (!paginationEl) {
        sendResponse({ success: false, error: 'No pagination found' });
        return true;
      }

      const pageItems = paginationEl.querySelectorAll('.ant-pagination-item, [class*="page-item"]');
      let clicked = false;
      pageItems.forEach(item => {
        if (parseInt(item.textContent) === pageNum) {
          item.click();
          clicked = true;
        }
      });

      if (!clicked) {
        sendResponse({ success: false, error: `Page ${pageNum} not found` });
        return true;
      }

      setTimeout(() => {
        sendResponse({ success: true, message: `Clicked page ${pageNum}` });
      }, 1500);

      return true;
    } catch (error) {
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Switch between current and historical affiliations tabs
  if (message.type === 'SWITCH_TAB') {
    try {
      const targetTab = message.tab; // 'current' or 'historical'

      // Find tab elements
      const tabLinks = document.querySelectorAll('.ant-tabs-tab, [class*="tab-item"], [role="tab"]');
      let clicked = false;

      tabLinks.forEach(tab => {
        const text = tab.textContent;
        if (targetTab === 'current' && text.includes('全部关联企业') && !text.includes('历史')) {
          tab.click();
          clicked = true;
        }
        if (targetTab === 'historical' && (text.includes('历史全部关联企业') || text.includes('历史'))) {
          tab.click();
          clicked = true;
        }
      });

      if (!clicked) {
        sendResponse({ success: false, error: `Tab '${targetTab}' not found` });
        return true;
      }

      // Wait for content to load
      setTimeout(() => {
        sendResponse({ success: true, message: `Switched to ${targetTab} tab` });
      }, 2000);

      return true;
    } catch (error) {
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // Extract all affiliations (both tabs) - comprehensive extraction
  if (message.type === 'EXTRACT_ALL_AFFILIATIONS') {
    try {
      const result = {
        sourceUrl: window.location.href,
        extractedAt: new Date().toISOString(),
        pageType: 'person_profile',
        personName: '',
        currentAffiliations: [],
        historicalAffiliations: [],
        tabInfo: {
          currentCount: 0,
          historicalCount: 0
        }
      };

      // Extract person name
      const h1El = document.querySelector('h1.copy-value, h1');
      if (h1El) {
        result.personName = cleanText(h1El.textContent);
      }

      // Get tab counts
      const tabLinks = document.querySelectorAll('.ant-tabs-tab, [class*="tab-item"], [role="tab"]');
      tabLinks.forEach(tab => {
        const text = tab.textContent;
        if (text.includes('全部关联企业') && !text.includes('历史')) {
          const match = text.match(/(\d+)/);
          if (match) result.tabInfo.currentCount = parseInt(match[1]);
        }
        if (text.includes('历史全部关联企业') || text.includes('历史')) {
          const match = text.match(/(\d+)/);
          if (match) result.tabInfo.historicalCount = parseInt(match[1]);
        }
      });

      // Extract current tab first (should be default)
      const affiliationTable = findAffiliationTable();
      if (affiliationTable) {
        result.currentAffiliations = extractAffiliationsFromTable(affiliationTable, true);
      }

      sendResponse({ success: true, data: result, needsHistoricalTab: result.tabInfo.historicalCount > 0 });
      return true;
    } catch (error) {
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // COMPREHENSIVE EXTRACTION - Get EVERYTHING from the page
  if (message.type === 'COMPREHENSIVE_EXTRACT') {
    try {
      const pageType = detectPageType();
      let result;

      if (pageType === 'person_profile') {
        result = comprehensivePersonExtract();
      } else if (pageType === 'company_profile') {
        result = comprehensiveCompanyExtract();
      } else {
        result = comprehensiveGenericExtract();
      }

      sendResponse({ success: true, data: result });
      return true;
    } catch (error) {
      console.error('Comprehensive extraction error:', error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // FIND PERSON IN COMPANY - Extract specific person's data from company page
  // Used when crawling companies to get appointment dates for a specific person
  if (message.type === 'FIND_PERSON_IN_COMPANY') {
    try {
      const personName = message.personName;
      if (!personName) {
        sendResponse({ success: false, error: 'personName required' });
        return true;
      }

      const result = findPersonInCompanyPage(personName);
      sendResponse({ success: true, data: result });
      return true;
    } catch (error) {
      console.error('Find person error:', error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // GET COMPANY BASIC INFO - Just registration number and basic details
  if (message.type === 'GET_COMPANY_BASIC') {
    try {
      const result = extractCompanyBasicInfo();
      sendResponse({ success: true, data: result });
      return true;
    } catch (error) {
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }

  // EXTRACT_AFFILIATIONS - Extract affiliations from current visible tab
  // Used by research orchestrator to get person's company list
  if (message.type === 'EXTRACT_AFFILIATIONS') {
    try {
      const result = {
        sourceUrl: window.location.href,
        extractedAt: new Date().toISOString(),
        personName: '',
        affiliations: []
      };

      // Extract person name
      const h1El = document.querySelector('h1.copy-value, h1');
      if (h1El) {
        result.personName = cleanText(h1El.textContent);
      }

      // Find and extract from the affiliations table
      const affiliationTable = findAffiliationTable();
      if (affiliationTable) {
        result.affiliations = extractAffiliationsFromTable(affiliationTable, true);
      }

      sendResponse({ success: true, affiliations: result.affiliations, personName: result.personName });
      return true;
    } catch (error) {
      console.error('Extract affiliations error:', error);
      sendResponse({ success: false, error: error.message, affiliations: [] });
      return true;
    }
  }

  return false;
});

// ============================================================
// COMPREHENSIVE EXTRACTION FUNCTIONS
// Get EVERYTHING from a page - nothing filtered out
// ============================================================

// Comprehensive person profile extraction
function comprehensivePersonExtract() {
  const data = {
    _extractionType: 'comprehensive',
    _pageType: 'person_profile',
    _sourceUrl: window.location.href,
    _extractedAt: new Date().toISOString(),
    _availableSections: [],

    // Basic info
    personName: '',
    personId: '',

    // All tabs/sections found on page
    sections: {},

    // All tables found (raw)
    tables: [],

    // All links for potential crawling
    relatedLinks: [],

    // Raw text content for AI processing
    rawTextContent: ''
  };

  // Extract person name
  const h1El = document.querySelector('h1.copy-value, h1');
  if (h1El) {
    data.personName = cleanText(h1El.textContent);
  }

  // Extract person ID from URL if available
  const urlMatch = window.location.href.match(/\/p([a-f0-9]+)\.html/);
  if (urlMatch) {
    data.personId = urlMatch[1];
  }

  // Find all tabs/sections on the page
  const allTabs = document.querySelectorAll('.ant-tabs-tab, [class*="tab-item"], [role="tab"], .nav-item, .menu-item');
  allTabs.forEach(tab => {
    const text = cleanText(tab.textContent);
    if (text && text.length < 50) {
      const countMatch = text.match(/(\d+)/);
      data._availableSections.push({
        name: text.replace(/\d+/g, '').trim(),
        count: countMatch ? parseInt(countMatch[1]) : null,
        isActive: tab.classList.contains('active') || tab.classList.contains('ant-tabs-tab-active')
      });
    }
  });

  // Extract ALL tables on the page
  const allTables = document.querySelectorAll('table');
  allTables.forEach((table, tableIdx) => {
    const tableData = extractTableComprehensive(table, tableIdx);
    if (tableData.rows.length > 0) {
      data.tables.push(tableData);
    }
  });

  // Also look for list-style data (not in tables)
  const listSections = document.querySelectorAll('[class*="list"], [class*="card"], [class*="item-wrap"]');
  listSections.forEach((section, idx) => {
    const sectionData = extractListSection(section, idx);
    if (sectionData.items.length > 0) {
      data.sections[`list_${idx}`] = sectionData;
    }
  });

  // Collect ALL links that might be relevant for crawling
  const allLinks = document.querySelectorAll('a[href*="/firm/"], a[href*="/pl/p"], a[href*="/run/"]');
  const seenUrls = new Set();
  allLinks.forEach(link => {
    const url = link.href;
    const text = cleanText(link.textContent);
    if (!seenUrls.has(url) && text && text.length > 1 && text.length < 100) {
      seenUrls.add(url);
      data.relatedLinks.push({
        text: text,
        url: url,
        type: url.includes('/firm/') ? 'company' : 'person'
      });
    }
  });

  // Get raw text for AI processing (truncated to avoid huge payloads)
  const mainContent = document.querySelector('main, .main-content, #app, body');
  if (mainContent) {
    data.rawTextContent = mainContent.innerText.slice(0, 100000);
  }

  return data;
}

// Comprehensive company profile extraction
function comprehensiveCompanyExtract() {
  const data = {
    _extractionType: 'comprehensive',
    _pageType: 'company_profile',
    _sourceUrl: window.location.href,
    _extractedAt: new Date().toISOString(),
    _availableSections: [],

    // Basic info
    companyName: '',
    companyId: '',

    // All sections/tabs
    sections: {},

    // All tables
    tables: [],

    // All links
    relatedLinks: [],

    // Raw text
    rawTextContent: ''
  };

  // Extract company name
  const h1El = document.querySelector('h1.copy-value, h1');
  if (h1El) {
    data.companyName = cleanText(h1El.textContent);
  }

  // Extract company ID from URL
  const urlMatch = window.location.href.match(/\/firm\/([a-f0-9]+)\.html/);
  if (urlMatch) {
    data.companyId = urlMatch[1];
  }

  // Find all tabs/sections
  const allTabs = document.querySelectorAll('.ant-tabs-tab, [class*="tab-item"], [role="tab"], .nav-item');
  allTabs.forEach(tab => {
    const text = cleanText(tab.textContent);
    if (text && text.length < 50) {
      const countMatch = text.match(/(\d+)/);
      data._availableSections.push({
        name: text.replace(/\d+/g, '').trim(),
        count: countMatch ? parseInt(countMatch[1]) : null,
        isActive: tab.classList.contains('active') || tab.classList.contains('ant-tabs-tab-active')
      });
    }
  });

  // Extract ALL tables
  const allTables = document.querySelectorAll('table');
  allTables.forEach((table, tableIdx) => {
    const tableData = extractTableComprehensive(table, tableIdx);
    if (tableData.rows.length > 0) {
      data.tables.push(tableData);
    }
  });

  // Key-value pairs (like registration info)
  const kvPairs = extractKeyValuePairs();
  if (Object.keys(kvPairs).length > 0) {
    data.sections['basicInfo'] = kvPairs;
  }

  // Collect all links
  const allLinks = document.querySelectorAll('a[href*="/firm/"], a[href*="/pl/p"], a[href*="/run/"]');
  const seenUrls = new Set();
  allLinks.forEach(link => {
    const url = link.href;
    const text = cleanText(link.textContent);
    if (!seenUrls.has(url) && url !== window.location.href && text && text.length > 1) {
      seenUrls.add(url);
      data.relatedLinks.push({
        text: text,
        url: url,
        type: url.includes('/firm/') ? 'company' : 'person'
      });
    }
  });

  // Raw text
  const mainContent = document.querySelector('main, .main-content, #app, body');
  if (mainContent) {
    data.rawTextContent = mainContent.innerText.slice(0, 100000);
  }

  return data;
}

// Generic extraction for unknown pages
function comprehensiveGenericExtract() {
  return {
    _extractionType: 'comprehensive',
    _pageType: 'unknown',
    _sourceUrl: window.location.href,
    _extractedAt: new Date().toISOString(),
    title: document.title,
    rawTextContent: document.body.innerText.slice(0, 100000),
    tables: Array.from(document.querySelectorAll('table')).map((t, i) => extractTableComprehensive(t, i)),
    links: Array.from(document.querySelectorAll('a')).slice(0, 200).map(a => ({
      text: cleanText(a.textContent),
      url: a.href
    })).filter(l => l.text && l.url)
  };
}

// Extract a table comprehensively (all rows, all columns, preserve structure)
function extractTableComprehensive(table, tableIdx) {
  const result = {
    tableIndex: tableIdx,
    headers: [],
    rows: [],
    summary: ''
  };

  // Try to identify what this table is about
  const prevSibling = table.previousElementSibling;
  if (prevSibling) {
    const headerText = prevSibling.textContent.trim();
    if (headerText.length < 100) {
      result.summary = headerText;
    }
  }

  // Extract headers
  const headerRow = table.querySelector('thead tr, tr:first-child');
  if (headerRow) {
    const headerCells = headerRow.querySelectorAll('th, td');
    headerCells.forEach(cell => {
      result.headers.push(cleanText(cell.textContent));
    });
  }

  // Extract all data rows
  const rows = table.querySelectorAll('tbody tr, tr');
  rows.forEach((row, rowIdx) => {
    // Skip header row
    if (rowIdx === 0 && row.querySelector('th')) return;
    if (row.closest('thead')) return;

    const cells = row.querySelectorAll('td');
    if (cells.length === 0) return;

    const rowData = {
      cells: [],
      links: []
    };

    cells.forEach((cell, cellIdx) => {
      const text = cleanText(cell.textContent);
      rowData.cells.push(text);

      // Capture any links in the cell
      const links = cell.querySelectorAll('a');
      links.forEach(link => {
        if (link.href && link.href.includes('qcc.com')) {
          rowData.links.push({
            text: cleanText(link.textContent),
            url: link.href,
            column: cellIdx
          });
        }
      });
    });

    if (rowData.cells.some(c => c.length > 0)) {
      result.rows.push(rowData);
    }
  });

  return result;
}

// Extract key-value pairs from the page (like registration info)
function extractKeyValuePairs() {
  const pairs = {};

  // Look for common patterns: label followed by value
  const cells = document.querySelectorAll('td, th, dt, dd, .label, .value');
  const labels = ['法定代表人', '统一社会信用代码', '注册资本', '成立日期', '企业状态', '登记状态',
                  '企业类型', '注册地址', '经营范围', '所属行业', '纳税人识别号', '组织机构代码'];

  labels.forEach(label => {
    // Find element containing this label
    const elements = Array.from(document.querySelectorAll('td, th, span, div'));
    elements.forEach(el => {
      if (el.textContent.includes(label) && el.textContent.length < 50) {
        // Look for next sibling or adjacent element with the value
        const next = el.nextElementSibling;
        if (next) {
          const value = extractCellValue(next);
          if (value && value !== label) {
            pairs[label] = value;
          }
        }
      }
    });
  });

  return pairs;
}

// Extract list-style sections (not tables)
function extractListSection(section, idx) {
  const result = {
    sectionIndex: idx,
    items: []
  };

  const items = section.querySelectorAll('[class*="item"], li, .card');
  items.forEach(item => {
    const text = cleanText(item.textContent);
    if (text && text.length > 5 && text.length < 500) {
      const links = Array.from(item.querySelectorAll('a')).map(a => ({
        text: cleanText(a.textContent),
        url: a.href
      })).filter(l => l.text);

      result.items.push({
        text: text.slice(0, 300),
        links: links
      });
    }
  });

  return result;
}

// ============================================================
// COMPANY PAGE EXTRACTION FOR SPECIFIC PERSON
// ============================================================

// Extract basic company info (registration number, name, status)
function extractCompanyBasicInfo() {
  const info = {
    companyName: '',
    registrationNumber: '',  // 统一社会信用代码
    status: '',
    sourceUrl: window.location.href
  };

  // Company name
  const h1El = document.querySelector('h1.copy-value, h1');
  if (h1El) {
    info.companyName = cleanText(h1El.textContent);
  }

  // Registration number - look in basic info table
  const allCells = document.querySelectorAll('td, th');
  allCells.forEach((cell, idx) => {
    const text = cell.textContent;
    if (text.includes('统一社会信用代码')) {
      const nextCell = cell.nextElementSibling;
      if (nextCell) {
        info.registrationNumber = extractCellValue(nextCell);
      }
    }
    if (text.includes('登记状态') || text.includes('企业状态')) {
      const nextCell = cell.nextElementSibling;
      if (nextCell) {
        info.status = cleanText(nextCell.textContent);
      }
    }
  });

  // Also try .copy-value elements
  const copyValues = document.querySelectorAll('.copy-value');
  copyValues.forEach(el => {
    const text = el.textContent.trim();
    // Registration numbers are typically 18 characters starting with numbers
    if (text.match(/^[0-9A-Z]{18}$/)) {
      info.registrationNumber = text;
    }
  });

  return info;
}

// Find a specific person in the company page and extract their appointment dates
function findPersonInCompanyPage(personName) {
  const result = {
    personName: personName,
    found: false,
    companyName: '',
    registrationNumber: '',
    roles: [],  // Array of { role, appointmentDate, percentage }
    sourceUrl: window.location.href
  };

  // Get basic company info
  const basicInfo = extractCompanyBasicInfo();
  result.companyName = basicInfo.companyName;
  result.registrationNumber = basicInfo.registrationNumber;

  // Search in shareholders table (股东信息)
  const shareholderRole = findPersonInShareholdersTable(personName);
  if (shareholderRole) {
    result.found = true;
    result.roles.push(shareholderRole);
  }

  // Search in directors/key personnel table (主要人员)
  const directorRoles = findPersonInDirectorsTable(personName);
  if (directorRoles.length > 0) {
    result.found = true;
    result.roles.push(...directorRoles);
  }

  // Search in change history (变更记录) for appointment dates
  const changeHistory = findPersonInChangeHistory(personName);
  if (changeHistory.length > 0) {
    // Merge change history dates with existing roles
    changeHistory.forEach(change => {
      const existingRole = result.roles.find(r =>
        r.role.includes(change.roleType) || change.roleType.includes(r.role)
      );
      if (existingRole && !existingRole.appointmentDate) {
        existingRole.appointmentDate = change.date;
        existingRole.changeType = change.changeType;
      } else if (!existingRole) {
        result.roles.push({
          role: change.roleType,
          appointmentDate: change.date,
          changeType: change.changeType
        });
      }
    });
  }

  return result;
}

// Find person in shareholders table
function findPersonInShareholdersTable(personName) {
  // Look for shareholders table - headers contain 股东 or 持股
  const tables = document.querySelectorAll('table');

  for (const table of tables) {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) continue;

    const headerText = headerRow.textContent;
    if (!headerText.includes('股东') && !headerText.includes('持股')) continue;

    // Found shareholders table - search for person
    const rows = table.querySelectorAll('tbody tr, tr');
    for (const row of rows) {
      const rowText = row.textContent;
      if (!rowText.includes(personName)) continue;

      // Found the person - extract their data
      const cells = row.querySelectorAll('td');
      const role = {
        role: '股东',
        percentage: '',
        appointmentDate: '',
        investmentAmount: ''
      };

      cells.forEach(cell => {
        const text = cleanText(cell.textContent);

        // Percentage
        const percentMatch = text.match(/([\d.]+)%/);
        if (percentMatch) {
          role.percentage = percentMatch[1] + '%';
        }

        // Date (subscription date or appointment)
        const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          role.appointmentDate = dateMatch[1];
        }

        // Investment amount
        const amountMatch = text.match(/([\d,.]+)\s*万/);
        if (amountMatch) {
          role.investmentAmount = amountMatch[1] + '万';
        }
      });

      if (role.percentage) {
        role.role = `股东 ${role.percentage}`;
      }

      return role;
    }
  }

  return null;
}

// Find person in directors/key personnel table
function findPersonInDirectorsTable(personName) {
  const roles = [];
  const tables = document.querySelectorAll('table');

  for (const table of tables) {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) continue;

    const headerText = headerRow.textContent;
    // Directors table usually has 姓名 and 职务
    if (!headerText.includes('姓名') && !headerText.includes('职务') && !headerText.includes('主要人员')) continue;

    const rows = table.querySelectorAll('tbody tr, tr');
    for (const row of rows) {
      const rowText = row.textContent;
      if (!rowText.includes(personName)) continue;

      // Found the person
      const cells = row.querySelectorAll('td');
      let position = '';
      let appointmentDate = '';

      cells.forEach(cell => {
        const text = cleanText(cell.textContent);

        // Position/role
        if (text.includes('董事') || text.includes('监事') || text.includes('经理') ||
            text.includes('代表') || text.includes('总经理') || text.includes('财务')) {
          position = text;
        }

        // Date
        const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          appointmentDate = dateMatch[1];
        }
      });

      if (position) {
        roles.push({
          role: position,
          appointmentDate: appointmentDate
        });
      }
    }
  }

  return roles;
}

// Find person in change history for appointment/resignation dates
function findPersonInChangeHistory(personName) {
  const changes = [];

  // Change history might be in a table or list
  const tables = document.querySelectorAll('table');

  for (const table of tables) {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) continue;

    const headerText = headerRow.textContent;
    if (!headerText.includes('变更') && !headerText.includes('日期')) continue;

    const rows = table.querySelectorAll('tbody tr, tr');
    for (const row of rows) {
      const rowText = row.textContent;
      if (!rowText.includes(personName)) continue;

      // Found a change record mentioning this person
      const cells = row.querySelectorAll('td');
      let date = '';
      let changeType = '';
      let roleType = '';

      cells.forEach(cell => {
        const text = cleanText(cell.textContent);

        // Date
        const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          date = dateMatch[1];
        }

        // Change type
        if (text.includes('新增') || text.includes('任命')) {
          changeType = 'appointed';
        } else if (text.includes('退出') || text.includes('离任')) {
          changeType = 'resigned';
        }

        // Role type
        if (text.includes('董事')) roleType = '董事';
        else if (text.includes('监事')) roleType = '监事';
        else if (text.includes('股东')) roleType = '股东';
        else if (text.includes('法定代表人')) roleType = '法定代表人';
        else if (text.includes('经理')) roleType = '经理';
      });

      if (date && roleType) {
        changes.push({
          date: date,
          changeType: changeType,
          roleType: roleType
        });
      }
    }
  }

  return changes;
}

// Detect page type from URL
function detectPageType() {
  const url = window.location.href;
  // Person profile: qcc.com/pl/p{hash}.html or /run/
  if (url.includes('/pl/p') || url.includes('/run/')) {
    return 'person_profile';
  }
  // Company profile: qcc.com/firm/{hash}.html
  if (url.includes('/firm/')) {
    return 'company_profile';
  }
  // Search results
  if (url.includes('/search') || url.includes('/web/search')) {
    return 'search_results';
  }
  return 'unknown';
}

// Extract company profile data from QCC page
function extractCompanyProfile() {
  const data = {
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    pageType: 'company_profile',

    // Basic registration info
    companyName: '',
    legalRepresentative: '',    // 法定代表人
    unifiedSocialCreditCode: '', // 统一社会信用代码
    registeredCapital: '',      // 注册资本
    paidInCapital: '',          // 实缴资本
    establishedDate: '',        // 成立日期
    operatingStatus: '',        // 登记状态
    companyType: '',            // 企业类型
    registeredAddress: '',      // 注册地址
    businessScope: '',          // 经营范围
    industry: '',               // 所属行业

    // Additional info
    organizationCode: '',       // 组织机构代码
    businessRegNumber: '',      // 工商注册号
    taxpayerNumber: '',         // 纳税人识别号
    approvalDate: '',           // 核准日期
    registrationAuthority: '',  // 登记机关

    // Shareholders
    shareholders: [],

    // Directors/Key Personnel
    directors: [],

    // Actual controller
    actualControllers: [],

    // Investments
    investments: [],

    // Risk counts
    legalCases: 0,
    businessRisks: 0,

    // Linked profiles for recursive scraping
    linkedProfiles: []
  };

  // 1. Extract company name from h1.copy-value
  const h1El = document.querySelector('h1.copy-value');
  if (h1El) {
    data.companyName = cleanText(h1El.textContent);
  } else {
    // Fallback: extract from page title
    const titleMatch = document.title.match(/^(.+?)\s*-\s*企查查/);
    if (titleMatch) {
      data.companyName = titleMatch[1].trim();
    }
  }

  // 2. Extract operating status from header
  const statusEl = document.querySelector('.nstatus, [class*="status"]');
  if (statusEl) {
    data.operatingStatus = cleanText(statusEl.textContent);
  }

  // 3. Extract registration info from main info table (table.ntable with registration fields)
  const registrationTable = document.querySelector('.cominfo-normal table.ntable, table.ntable');
  if (registrationTable) {
    const rows = registrationTable.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('td, th');
      // Process pairs: label cell, value cell, label cell, value cell...
      for (let i = 0; i < cells.length - 1; i++) {
        const labelCell = cells[i];
        const valueCell = cells[i + 1];

        const labelText = labelCell.textContent.trim();
        const value = extractCellValue(valueCell);

        // Map labels to fields
        if (labelText.includes('统一社会信用代码')) {
          data.unifiedSocialCreditCode = value;
          i++; // Skip the value cell
        } else if (labelText.includes('法定代表人')) {
          // Extract name from link if present
          const link = valueCell.querySelector('a');
          data.legalRepresentative = link ? cleanText(link.textContent) : value;
          i++;
        } else if (labelText.includes('登记状态') || labelText.includes('企业状态')) {
          data.operatingStatus = value;
          i++;
        } else if (labelText.includes('成立日期')) {
          data.establishedDate = value;
          i++;
        } else if (labelText.includes('注册资本') && !labelText.includes('实缴')) {
          data.registeredCapital = value;
          i++;
        } else if (labelText.includes('实缴资本')) {
          data.paidInCapital = value;
          i++;
        } else if (labelText.includes('组织机构代码')) {
          data.organizationCode = value;
          i++;
        } else if (labelText.includes('工商注册号')) {
          data.businessRegNumber = value;
          i++;
        } else if (labelText.includes('纳税人识别号')) {
          data.taxpayerNumber = value;
          i++;
        } else if (labelText.includes('企业类型') || labelText.includes('公司类型')) {
          data.companyType = value;
          i++;
        } else if (labelText.includes('核准日期')) {
          data.approvalDate = value;
          i++;
        } else if (labelText.includes('登记机关')) {
          data.registrationAuthority = value;
          i++;
        } else if (labelText.includes('注册地址') && !labelText.includes('通信')) {
          data.registeredAddress = value;
          i++;
        } else if (labelText.includes('经营范围')) {
          data.businessScope = value;
          i++;
        } else if (labelText.includes('国标行业') || labelText.includes('所属行业')) {
          data.industry = value;
          i++;
        }
      }
    });
  }

  // 4. Extract shareholders from shareholders table
  // Look for table with headers containing "股东名称" or "持股比例"
  const allTables = document.querySelectorAll('table.ntable');
  allTables.forEach(table => {
    const headerRow = table.querySelector('tr');
    if (!headerRow) return;

    const headerText = headerRow.textContent;

    // Shareholders table
    if (headerText.includes('股东名称') || headerText.includes('持股比例')) {
      const dataRows = table.querySelectorAll('tr');
      dataRows.forEach((row, idx) => {
        if (idx === 0) return; // Skip header

        const cells = row.querySelectorAll('td');
        if (cells.length < 3) return;

        // Find shareholder name (usually in a link)
        const nameLink = row.querySelector('a[href*="/pl/"], a[href*="/firm/"]');
        if (!nameLink) return;

        const name = cleanText(nameLink.textContent);
        const profileUrl = nameLink.href;

        // Find percentage - look for cell containing %
        let percentage = '';
        let investmentAmount = '';
        cells.forEach(cell => {
          const text = cell.textContent;
          const percentMatch = text.match(/([\d.]+)%/);
          if (percentMatch) {
            percentage = percentMatch[1] + '%';
          }
          // Investment amount often has 万 or 万元
          const amountMatch = text.match(/([\d.]+)\s*万?元?/);
          if (amountMatch && !text.includes('%') && text.includes('万')) {
            investmentAmount = amountMatch[1] + '万元';
          }
        });

        if (name && !data.shareholders.find(s => s.name === name)) {
          data.shareholders.push({
            name,
            percentage,
            investmentAmount,
            profileUrl,
            type: profileUrl.includes('/pl/p') ? 'individual' : 'corporate'
          });
        }
      });
    }

    // Directors/Key Personnel table
    if (headerText.includes('姓名') && headerText.includes('职务')) {
      const dataRows = table.querySelectorAll('tr');
      dataRows.forEach((row, idx) => {
        if (idx === 0) return; // Skip header

        const cells = row.querySelectorAll('td');
        if (cells.length < 2) return;

        const nameLink = row.querySelector('a[href*="/pl/"]');
        if (!nameLink) return;

        const name = cleanText(nameLink.textContent);
        const profileUrl = nameLink.href;

        // Find position cell
        let position = '';
        cells.forEach(cell => {
          const text = cleanText(cell.textContent);
          if (text.includes('董事') || text.includes('监事') || text.includes('经理') ||
              text.includes('总经理') || text.includes('财务') || text.includes('代表')) {
            position = text;
          }
        });

        if (name && !data.directors.find(d => d.name === name)) {
          data.directors.push({
            name,
            position,
            profileUrl
          });
        }
      });
    }

    // Actual controller table
    if (headerText.includes('实际控制人')) {
      const dataRows = table.querySelectorAll('tr');
      dataRows.forEach((row, idx) => {
        if (idx === 0) return;

        const nameLink = row.querySelector('a[href*="/pl/"]');
        if (!nameLink) return;

        const name = cleanText(nameLink.textContent);
        const profileUrl = nameLink.href;

        // Find holding percentage
        let holdingPercentage = '';
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
          const percentMatch = cell.textContent.match(/([\d.]+)%/);
          if (percentMatch) {
            holdingPercentage = percentMatch[1] + '%';
          }
        });

        if (name) {
          data.actualControllers.push({
            name,
            holdingPercentage,
            profileUrl
          });
        }
      });
    }

    // Investments table (对外投资)
    if (headerText.includes('被投资企业') || headerText.includes('对外投资')) {
      const dataRows = table.querySelectorAll('tr');
      dataRows.forEach((row, idx) => {
        if (idx === 0) return;

        const nameLink = row.querySelector('a[href*="/firm/"]');
        if (!nameLink) return;

        const name = cleanText(nameLink.textContent);
        const profileUrl = nameLink.href;

        let percentage = '';
        let amount = '';
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
          const text = cell.textContent;
          const percentMatch = text.match(/([\d.]+)%/);
          if (percentMatch) {
            percentage = percentMatch[1] + '%';
          }
          const amountMatch = text.match(/([\d.]+万?元)/);
          if (amountMatch) {
            amount = amountMatch[1];
          }
        });

        if (name) {
          data.investments.push({
            companyName: name,
            percentage,
            amount,
            profileUrl
          });
        }
      });
    }
  });

  // 5. Extract risk counts from tabs
  const tabItems = document.querySelectorAll('.tab-item, [class*="tab"]');
  tabItems.forEach(tab => {
    const text = tab.textContent;
    if (text.includes('司法案件') || text.includes('法律诉讼')) {
      const numMatch = text.match(/(\d+)/);
      if (numMatch) {
        data.legalCases = parseInt(numMatch[1]);
      }
    }
    if (text.includes('经营风险')) {
      const numMatch = text.match(/(\d+)/);
      if (numMatch) {
        data.businessRisks = parseInt(numMatch[1]);
      }
    }
  });

  // 6. Collect all linked profiles for recursive scraping
  const profileLinks = document.querySelectorAll('a[href*="/firm/"], a[href*="/pl/p"]');
  const seenUrls = new Set();
  profileLinks.forEach(link => {
    const url = link.href;
    const name = cleanText(link.textContent);

    // Skip if already seen, or if it's the current page, or if name is empty/junk
    if (seenUrls.has(url) || url === window.location.href || !name || name.length < 2) return;
    if (name.includes('基本信息') || name.includes('更多') || name.includes('查看')) return;

    seenUrls.add(url);
    data.linkedProfiles.push({
      name,
      url,
      type: url.includes('/pl/p') ? 'person' : 'company'
    });
  });

  // 7. Detect pagination
  data.pagination = detectPagination();

  return data;
}

// Extract person profile data
function extractPersonProfile() {
  const data = {
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    pageType: 'person_profile',

    personName: '',
    currentAffiliations: [],    // Current company affiliations (全部关联企业)
    historicalAffiliations: [], // Past affiliations (历史全部关联企业)
    companies: [],              // Legacy format for backward compatibility
    linkedProfiles: [],
    tabInfo: {
      currentTab: 'current',    // Which tab is currently active
      currentCount: 0,          // Number in 全部关联企业 tab
      historicalCount: 0        // Number in 历史全部关联企业 tab
    }
  };

  // Extract person name
  const h1El = document.querySelector('h1.copy-value, h1');
  if (h1El) {
    data.personName = cleanText(h1El.textContent);
  }

  // Detect which tab is active and get counts from tab labels
  const tabLinks = document.querySelectorAll('.ant-tabs-tab, [class*="tab-item"], [role="tab"]');
  tabLinks.forEach(tab => {
    const text = tab.textContent;
    if (text.includes('全部关联企业') && !text.includes('历史')) {
      const match = text.match(/(\d+)/);
      if (match) data.tabInfo.currentCount = parseInt(match[1]);
      if (tab.classList.contains('ant-tabs-tab-active') || tab.classList.contains('active')) {
        data.tabInfo.currentTab = 'current';
      }
    }
    if (text.includes('历史全部关联企业') || text.includes('历史')) {
      const match = text.match(/(\d+)/);
      if (match) data.tabInfo.historicalCount = parseInt(match[1]);
      if (tab.classList.contains('ant-tabs-tab-active') || tab.classList.contains('active')) {
        data.tabInfo.currentTab = 'historical';
      }
    }
  });

  // Extract company affiliations from the visible table
  // QCC person profile table columns: 序号, 企业名称, 状态, 角色, 持股比例, 注册资本, 成立日期, 地区, 行业
  const affiliationTable = findAffiliationTable();
  if (affiliationTable) {
    const affiliations = extractAffiliationsFromTable(affiliationTable, data.tabInfo.currentTab === 'current');

    if (data.tabInfo.currentTab === 'current') {
      data.currentAffiliations = affiliations;
    } else {
      data.historicalAffiliations = affiliations;
    }

    // Also populate legacy companies array for backward compatibility
    affiliations.forEach(aff => {
      data.companies.push({
        companyName: aff.companyName,
        position: aff.role,
        profileUrl: aff.companyUrl
      });
    });
  }

  // Detect pagination for the current table
  data.pagination = detectPagination();

  return data;
}

// Find the main affiliations table on person profile page
function findAffiliationTable() {
  // Look for tables that have the expected headers
  const tables = document.querySelectorAll('table');

  for (const table of tables) {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) continue;

    const headerText = headerRow.textContent;
    // Check for key column headers
    if (headerText.includes('企业名称') &&
        (headerText.includes('状态') || headerText.includes('角色') || headerText.includes('持股比例'))) {
      return table;
    }
  }

  // Fallback: look for table.ntable with company links
  const ntables = document.querySelectorAll('table.ntable');
  for (const table of ntables) {
    if (table.querySelector('a[href*="/firm/"]')) {
      return table;
    }
  }

  return null;
}

// Extract affiliations from the table
function extractAffiliationsFromTable(table, isCurrent) {
  const affiliations = [];

  // Determine column indices from header
  const headerRow = table.querySelector('thead tr, tr:first-child');
  const columnMap = {};

  if (headerRow) {
    const headers = headerRow.querySelectorAll('th, td');
    headers.forEach((header, idx) => {
      const text = header.textContent.trim();
      if (text.includes('企业名称')) columnMap.companyName = idx;
      if (text.includes('状态')) columnMap.status = idx;
      if (text.includes('角色') || text.includes('曾担任角色')) columnMap.role = idx;
      if (text.includes('持股比例')) columnMap.shareholding = idx;
      if (text.includes('注册资本')) columnMap.capital = idx;
      if (text.includes('成立日期')) columnMap.establishedDate = idx;
      if (text.includes('地区')) columnMap.region = idx;
      if (text.includes('行业')) columnMap.industry = idx;
    });
  }

  // Extract data rows
  const rows = table.querySelectorAll('tbody tr, tr');
  rows.forEach((row, idx) => {
    // Skip header row
    if (idx === 0 && row.querySelector('th')) return;
    if (row.closest('thead')) return;

    const cells = row.querySelectorAll('td');
    if (cells.length < 3) return;

    // Extract company name and URL
    const companyLink = row.querySelector('a[href*="/firm/"]');
    if (!companyLink) return;

    const affiliation = {
      companyName: cleanText(companyLink.textContent),
      companyUrl: companyLink.href,
      status: '',
      statusRaw: '',
      role: '',
      shareholdingPercent: '',
      registeredCapital: '',
      establishedDate: '',
      region: '',
      industry: '',
      isCurrent: isCurrent
    };

    // Extract each column based on detected indices or position
    cells.forEach((cell, cellIdx) => {
      const text = cleanText(cell.textContent);

      // Status column - look for status badges
      const statusBadge = cell.querySelector('[class*="tag"], [class*="status"], span[style*="background"]');
      if (statusBadge || (columnMap.status !== undefined && cellIdx === columnMap.status)) {
        const statusText = statusBadge ? cleanText(statusBadge.textContent) : text;
        if (statusText.includes('存续') || statusText.includes('在营')) {
          affiliation.status = 'active';
          affiliation.statusRaw = statusText;
        } else if (statusText.includes('注销')) {
          affiliation.status = 'cancelled';
          affiliation.statusRaw = statusText;
        } else if (statusText.includes('吊销')) {
          affiliation.status = 'revoked';
          affiliation.statusRaw = statusText;
        } else if (statusText && !affiliation.status) {
          affiliation.statusRaw = statusText;
        }
      }

      // Role column
      if (columnMap.role !== undefined && cellIdx === columnMap.role) {
        affiliation.role = text;
      } else if (text.includes('股东') || text.includes('董事') || text.includes('监事') ||
                 text.includes('经理') || text.includes('代表') || text.includes('总经理')) {
        if (!affiliation.role) affiliation.role = text;
      }

      // Shareholding percentage
      if (columnMap.shareholding !== undefined && cellIdx === columnMap.shareholding) {
        affiliation.shareholdingPercent = text;
      } else if (text.includes('%') && !text.includes('存续') && !text.includes('注销')) {
        if (!affiliation.shareholdingPercent) affiliation.shareholdingPercent = text;
      }

      // Registered capital
      if (columnMap.capital !== undefined && cellIdx === columnMap.capital) {
        affiliation.registeredCapital = text;
      } else if ((text.includes('万') && text.includes('元')) || text.match(/^\d+万/)) {
        if (!affiliation.registeredCapital && !text.includes('%')) affiliation.registeredCapital = text;
      }

      // Established date
      if (columnMap.establishedDate !== undefined && cellIdx === columnMap.establishedDate) {
        affiliation.establishedDate = text;
      } else if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {
        if (!affiliation.establishedDate) affiliation.establishedDate = text;
      }

      // Region
      if (columnMap.region !== undefined && cellIdx === columnMap.region) {
        affiliation.region = text;
      } else if (text.match(/(省|市|自治区)$/) && text.length <= 10) {
        if (!affiliation.region) affiliation.region = text;
      }

      // Industry
      if (columnMap.industry !== undefined && cellIdx === columnMap.industry) {
        affiliation.industry = text;
      }
    });

    // Only add if we have a company name
    if (affiliation.companyName && !affiliations.find(a => a.companyName === affiliation.companyName)) {
      affiliations.push(affiliation);
    }
  });

  return affiliations;
}

// Extract search results
function extractSearchResults() {
  const results = [];

  const items = document.querySelectorAll('[class*="search"] [class*="item"], [class*="result"] [class*="item"], .search-result, .search-list-item');

  items.forEach(item => {
    const nameLink = item.querySelector('a[href*="/firm/"]');
    if (!nameLink) return;

    const result = {
      companyName: cleanText(nameLink.textContent),
      profileUrl: nameLink.href,
      status: '',
      legalRep: '',
      registeredCapital: '',
      establishedDate: ''
    };

    const text = item.textContent;

    const statusMatch = text.match(/状态[：:]\s*([^\s]+)/);
    if (statusMatch) result.status = cleanText(statusMatch[1]);

    const legalRepMatch = text.match(/法定代表人[：:]\s*([^\s]+)/);
    if (legalRepMatch) result.legalRep = cleanText(legalRepMatch[1]);

    const capitalMatch = text.match(/注册资本[：:]\s*([^\s]+)/);
    if (capitalMatch) result.registeredCapital = cleanText(capitalMatch[1]);

    const dateMatch = text.match(/成立日期[：:]\s*([\d-]+)/);
    if (dateMatch) result.establishedDate = dateMatch[1];

    if (result.companyName) {
      results.push(result);
    }
  });

  return {
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    pageType: 'search_results',
    resultCount: results.length,
    results: results,
    pagination: detectPagination()
  };
}
