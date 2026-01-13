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
