import { Document, Paragraph, Table, TableRow, TableCell, HeadingLevel, Packer, WidthType, TextRun } from 'docx';
import fs from 'fs';
import path from 'path';
import db from './database.js';

const REPORTS_DIR = '/Users/home/Desktop/DD Owl/reports';

// Ensure reports directory exists
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

export async function generatePersonReport(personUrl: string): Promise<Buffer> {
  // Get person data from database
  const person = db.prepare('SELECT * FROM persons WHERE qcc_url = ?').get(personUrl) as any;
  if (!person) {
    throw new Error('Person not found in database');
  }

  const personData = JSON.parse(person.raw_json);

  // Get all affiliated companies with details
  const affiliations: any[] = [];
  for (const company of personData.companies || []) {
    const companyRecord = db.prepare('SELECT * FROM companies WHERE qcc_url = ?').get(company.profileUrl) as any;
    if (companyRecord) {
      const companyData = JSON.parse(companyRecord.raw_json);
      // Find this person in the company's directors
      const directorEntry = companyData.directors?.find((d: any) =>
        d.name === person.name || d.profileUrl === personUrl
      );
      affiliations.push({
        companyName: companyData.companyName || '',
        position: directorEntry?.position || company.position || 'Unknown',
        registeredCapital: companyData.registeredCapital || '',
        establishedDate: companyData.establishedDate || '',
        operatingStatus: companyData.operatingStatus || ''
      });
    } else {
      // Company not yet scraped, use basic info from person profile
      affiliations.push({
        companyName: company.companyName || '',
        position: company.position || 'Unknown',
        registeredCapital: '',
        establishedDate: '',
        operatingStatus: ''
      });
    }
  }

  // Sort by established date (newest first)
  affiliations.sort((a, b) => {
    if (!a.establishedDate) return 1;
    if (!b.establishedDate) return -1;
    return b.establishedDate.localeCompare(a.establishedDate);
  });

  // Create Word document
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Title
        new Paragraph({
          text: `Due Diligence Report`,
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          text: `Subject: ${person.name}`,
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({ text: '' }),

        // Metadata
        new Paragraph({
          text: `Generated: ${new Date().toISOString().split('T')[0]}`,
        }),
        new Paragraph({
          text: `Source: ${personUrl}`,
        }),
        new Paragraph({
          text: `Total Affiliations: ${affiliations.length}`,
        }),
        new Paragraph({ text: '' }),

        // Summary section
        new Paragraph({
          text: 'Executive Summary',
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({
          text: `${person.name} is associated with ${affiliations.length} companies based on QCC records. ` +
                `The following report details each company affiliation including position held, registered capital, and operational status.`,
        }),
        new Paragraph({ text: '' }),

        // Affiliations table
        new Paragraph({
          text: 'Company Affiliations',
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({ text: '' }),

        // Table
        createAffiliationsTable(affiliations),

        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),

        // Disclaimer
        new Paragraph({
          text: 'Disclaimer',
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({
          text: 'This report is generated automatically from publicly available data on QCC (企查查). ' +
                'Information should be independently verified before making business decisions. ' +
                'Data accuracy depends on the source platform and extraction timing.',
        }),
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

function createAffiliationsTable(affiliations: any[]): Table {
  const headerRow = new TableRow({
    children: [
      createHeaderCell('Company Name'),
      createHeaderCell('Position'),
      createHeaderCell('Registered Capital'),
      createHeaderCell('Established'),
      createHeaderCell('Status'),
    ],
  });

  const dataRows = affiliations.map(a => new TableRow({
    children: [
      createDataCell(a.companyName),
      createDataCell(a.position),
      createDataCell(a.registeredCapital),
      createDataCell(a.establishedDate),
      createDataCell(a.operatingStatus),
    ],
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

function createHeaderCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true })]
    })],
    shading: { fill: 'CCCCCC' },
  });
}

function createDataCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ text: text || '-' })],
  });
}

export async function generateCompanyReport(companyUrl: string): Promise<Buffer> {
  // Get company data from database
  const company = db.prepare('SELECT * FROM companies WHERE qcc_url = ?').get(companyUrl) as any;
  if (!company) {
    throw new Error('Company not found in database');
  }

  const companyData = JSON.parse(company.raw_json);

  // Create Word document
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Title
        new Paragraph({
          text: `Company Due Diligence Report`,
          heading: HeadingLevel.TITLE,
        }),
        new Paragraph({
          text: companyData.companyName || 'Unknown Company',
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({ text: '' }),

        // Basic info
        new Paragraph({
          text: 'Basic Information',
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({ text: `Legal Representative: ${companyData.legalRepresentative || '-'}` }),
        new Paragraph({ text: `Unified Social Credit Code: ${companyData.unifiedSocialCreditCode || '-'}` }),
        new Paragraph({ text: `Registered Capital: ${companyData.registeredCapital || '-'}` }),
        new Paragraph({ text: `Established: ${companyData.establishedDate || '-'}` }),
        new Paragraph({ text: `Status: ${companyData.operatingStatus || '-'}` }),
        new Paragraph({ text: `Company Type: ${companyData.companyType || '-'}` }),
        new Paragraph({ text: `Industry: ${companyData.industry || '-'}` }),
        new Paragraph({ text: '' }),

        // Shareholders
        new Paragraph({
          text: `Shareholders (${companyData.shareholders?.length || 0})`,
          heading: HeadingLevel.HEADING_2,
        }),
        ...(companyData.shareholders?.map((s: any) =>
          new Paragraph({ text: `- ${s.name}: ${s.percentage || 'N/A'}` })
        ) || [new Paragraph({ text: 'No shareholder data available' })]),
        new Paragraph({ text: '' }),

        // Directors
        new Paragraph({
          text: `Directors/Key Personnel (${companyData.directors?.length || 0})`,
          heading: HeadingLevel.HEADING_2,
        }),
        ...(companyData.directors?.map((d: any) =>
          new Paragraph({ text: `- ${d.name}: ${d.position || 'N/A'}` })
        ) || [new Paragraph({ text: 'No director data available' })]),
        new Paragraph({ text: '' }),

        // Risk indicators
        new Paragraph({
          text: 'Risk Indicators',
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({ text: `Legal Cases: ${companyData.legalCases || 0}` }),
        new Paragraph({ text: `Business Risks: ${companyData.businessRisks || 0}` }),
        new Paragraph({ text: '' }),

        // Source
        new Paragraph({ text: `Source: ${companyUrl}` }),
        new Paragraph({ text: `Generated: ${new Date().toISOString().split('T')[0]}` }),
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

export async function saveReport(buffer: Buffer, filename: string): Promise<string> {
  const outputPath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(outputPath, buffer);
  console.log('Report saved to:', outputPath);
  return outputPath;
}

export function getReportsDir(): string {
  return REPORTS_DIR;
}
