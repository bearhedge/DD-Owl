# Tianyancha Word Report Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract person affiliations from Tianyancha and generate a downloadable Word document with current/historical tables.

**Architecture:** Extension extracts data → sends to backend → backend generates .docx with two tables → saves to public/reports/ → extension shows download link.

**Tech Stack:** Chrome Extension (content script), Express.js backend, `docx` npm package for Word generation.

---

### Task 1: Install docx Package

**Files:**
- Modify: `ddowl/package.json`

**Step 1: Install the docx package**

Run:
```bash
cd /Users/home/Desktop/DD\ Owl/ddowl && npm install docx
```

**Step 2: Verify installation**

Run:
```bash
npm list docx
```
Expected: Shows `docx@x.x.x`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add docx package for Word generation"
```

---

### Task 2: Create Word Report Generator

**Files:**
- Create: `ddowl/src/word-report.ts`

**Step 1: Create the word-report.ts file**

```typescript
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, BorderStyle } from 'docx';
import fs from 'fs';
import path from 'path';

interface Affiliation {
  companyName: string;
  role?: string;
  shareholding?: string;
}

interface ReportData {
  personName: string;
  currentAffiliations: Affiliation[];
  historicalAffiliations: Affiliation[];
}

function formatRole(aff: Affiliation): string {
  const parts: string[] = [];
  if (aff.role) parts.push(aff.role);
  if (aff.shareholding) parts.push(aff.shareholding);
  return parts.join(' ') || '';
}

function createHeaderRow(): TableRow {
  const headers = ['Company Name', 'Registration #', 'Role/Shareholding', 'Appointment Date'];
  return new TableRow({
    children: headers.map(text => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true })]
      })],
      width: { size: 25, type: WidthType.PERCENTAGE }
    }))
  });
}

function createDataRow(aff: Affiliation): TableRow {
  return new TableRow({
    children: [
      new TableCell({ children: [new Paragraph(aff.companyName || '')] }),
      new TableCell({ children: [new Paragraph('')] }), // Registration # - empty
      new TableCell({ children: [new Paragraph(formatRole(aff))] }),
      new TableCell({ children: [new Paragraph('')] })  // Appointment Date - empty
    ]
  });
}

function createTable(affiliations: Affiliation[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      createHeaderRow(),
      ...affiliations.map(aff => createDataRow(aff))
    ]
  });
}

export async function generateWordReport(data: ReportData): Promise<string> {
  const sections: Paragraph[] = [];
  const tables: (Paragraph | Table)[] = [];

  // Current Affiliations
  if (data.currentAffiliations.length > 0) {
    tables.push(new Paragraph({
      children: [new TextRun({ text: 'Current Affiliations', bold: true, size: 28 })],
      spacing: { after: 200 }
    }));
    tables.push(createTable(data.currentAffiliations));
    tables.push(new Paragraph({ spacing: { after: 400 } }));
  }

  // Historical Affiliations
  if (data.historicalAffiliations.length > 0) {
    tables.push(new Paragraph({
      children: [new TextRun({ text: 'Historical Affiliations', bold: true, size: 28 })],
      spacing: { after: 200 }
    }));
    tables.push(createTable(data.historicalAffiliations));
  }

  const doc = new Document({
    sections: [{
      children: tables
    }]
  });

  // Generate filename
  const date = new Date().toISOString().split('T')[0];
  const safeName = data.personName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
  const filename = `${safeName}-${date}.docx`;

  // Ensure reports directory exists
  const reportsDir = path.join(process.cwd(), 'public', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Save file
  const filepath = path.join(reportsDir, filename);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filepath, buffer);

  return filename;
}
```

**Step 2: Commit**

```bash
git add src/word-report.ts
git commit -m "feat: add Word report generator for affiliations"
```

---

### Task 3: Add Report API Endpoint

**Files:**
- Modify: `ddowl/src/server.ts`

**Step 1: Add import at top of server.ts**

Add after other imports:
```typescript
import { generateWordReport } from './word-report.js';
```

**Step 2: Add the /api/dd/report endpoint**

Add before the server.listen() call:
```typescript
// Generate Word report from extracted data
app.post('/api/dd/report', async (req: Request, res: Response) => {
  try {
    const data = req.body;

    if (!data || !data.personName) {
      res.status(400).json({ error: 'Missing personName' });
      return;
    }

    const filename = await generateWordReport({
      personName: data.personName,
      currentAffiliations: data.currentAffiliations || [],
      historicalAffiliations: data.historicalAffiliations || []
    });

    const reportUrl = `/reports/${filename}`;

    res.json({
      success: true,
      filename,
      reportUrl,
      currentCount: data.currentAffiliations?.length || 0,
      historicalCount: data.historicalAffiliations?.length || 0
    });
  } catch (error: any) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

**Step 3: Rebuild and verify**

Run:
```bash
cd /Users/home/Desktop/DD\ Owl/ddowl && npm run build
```
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: add /api/dd/report endpoint for Word generation"
```

---

### Task 4: Update Extension Popup - Add Progress States

**Files:**
- Modify: `owl1-extension/popup/popup.js`

**Step 1: Update the extractBtn click handler**

Replace the existing extractBtn click handler with:
```javascript
// Extract button click (Manual Mode)
extractBtn.addEventListener('click', async () => {
  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting...';
  resultContentEl.textContent = '';
  resultEl.classList.remove('visible');
  sendToBackendBtn.style.display = 'none';

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check if on supported site
    if (!tab.url.includes('qcc.com') && !tab.url.includes('qichacha.com') && !tab.url.includes('tianyancha.com')) {
      resultContentEl.textContent = 'Error: Navigate to QCC or Tianyancha first';
      resultEl.classList.add('visible');
      return;
    }

    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_DATA' });

    if (response && response.success) {
      lastExtractedData = response.data;
      const currentCount = response.data.currentAffiliations?.length || 0;
      const historicalCount = response.data.historicalAffiliations?.length || 0;

      // Show extraction complete
      extractBtn.textContent = 'Generating report...';
      resultContentEl.textContent = `Extracted: ${currentCount} current, ${historicalCount} historical affiliations\n\nSending to backend...`;
      resultEl.classList.add('visible');

      // Send to backend to generate Word report
      try {
        const reportResponse = await fetch('http://localhost:8080/api/dd/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(response.data)
        });
        const reportResult = await reportResponse.json();

        if (reportResult.success) {
          resultContentEl.textContent = `Complete!\n\n${currentCount} current, ${historicalCount} historical affiliations\n\nReport ready:`;

          // Show download link
          const linkEl = document.createElement('a');
          linkEl.href = `http://localhost:8080${reportResult.reportUrl}`;
          linkEl.textContent = reportResult.filename;
          linkEl.target = '_blank';
          linkEl.style.display = 'block';
          linkEl.style.marginTop = '8px';
          linkEl.style.color = '#007bff';
          resultContentEl.appendChild(linkEl);
        } else {
          resultContentEl.textContent = `Extracted ${currentCount} current, ${historicalCount} historical\n\nBackend error: ${reportResult.error}`;
        }
      } catch (fetchError) {
        resultContentEl.textContent = `Extracted ${currentCount} current, ${historicalCount} historical\n\nBackend offline - cannot generate report`;
      }

      // Show copy button for raw JSON
      copyBtn.style.display = 'block';
    } else {
      resultContentEl.textContent = 'Error: ' + (response?.error || 'Extraction failed');
      resultEl.classList.add('visible');
    }
  } catch (error) {
    resultContentEl.textContent = 'Error: ' + error.message + '\n\nTip: Try refreshing the page.';
    resultEl.classList.add('visible');
  } finally {
    extractBtn.disabled = false;
    extractBtn.textContent = 'Extract Data';
  }
});
```

**Step 2: Test manually**

1. Reload extension in chrome://extensions
2. Go to Tianyancha person profile
3. Click Extract Data
4. Should see progress → count → download link

**Step 3: Commit**

```bash
git add owl1-extension/popup/popup.js
git commit -m "feat: update popup to show progress and report download link"
```

---

### Task 5: Test End-to-End

**Step 1: Start backend**

```bash
cd /Users/home/Desktop/DD\ Owl/ddowl && npm run build && npm start
```

**Step 2: Test the flow**

1. Open Tianyancha person profile (任宝根 or similar)
2. Open DD Owl extension popup
3. Click "Extract Data"
4. Verify: Shows "Extracting..." → "Generating report..." → "Complete!"
5. Verify: Shows download link
6. Click link - downloads .docx file
7. Open .docx - verify two tables with correct columns

**Step 3: Verify report file**

```bash
ls -la /Users/home/Desktop/DD\ Owl/ddowl/public/reports/
```
Expected: Shows the generated .docx file

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Install docx npm package |
| 2 | Create word-report.ts generator |
| 3 | Add /api/dd/report endpoint |
| 4 | Update popup.js with progress states |
| 5 | End-to-end testing |
