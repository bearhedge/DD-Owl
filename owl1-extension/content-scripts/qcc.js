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

  return false;
});

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
    companies: [],      // Companies this person is associated with
    linkedProfiles: []
  };

  // Extract person name
  const h1El = document.querySelector('h1.copy-value, h1');
  if (h1El) {
    data.personName = cleanText(h1El.textContent);
  }

  // Extract company associations from tables
  const tables = document.querySelectorAll('table.ntable');
  tables.forEach(table => {
    const rows = table.querySelectorAll('tr');
    rows.forEach((row, idx) => {
      if (idx === 0) return; // Skip header

      const companyLink = row.querySelector('a[href*="/firm/"]');
      if (!companyLink) return;

      const companyName = cleanText(companyLink.textContent);
      const profileUrl = companyLink.href;

      // Try to find position/role
      let position = '';
      const cells = row.querySelectorAll('td');
      cells.forEach(cell => {
        const text = cleanText(cell.textContent);
        if (text.includes('董事') || text.includes('监事') || text.includes('股东') ||
            text.includes('经理') || text.includes('代表') || text.includes('总经理')) {
          position = text;
        }
      });

      if (companyName && !data.companies.find(c => c.companyName === companyName)) {
        data.companies.push({
          companyName,
          position,
          profileUrl
        });
      }
    });
  });

  // Detect pagination
  data.pagination = detectPagination();

  return data;
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
