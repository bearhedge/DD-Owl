/**
 * DD Domain Tools
 *
 * Semantic tools for due diligence research on QCC (企查查).
 * These are the tools the AI agent can call to gather information.
 */

import {
  Tool,
  ToolResult,
  ToolContext,
  Affiliation,
  PersonInCompany,
  CompanyDetails,
} from './types.js';

/**
 * Get Person Affiliations
 *
 * Extracts all company affiliations for a person from their QCC profile.
 * This is typically the first tool called when researching a person.
 */
export const getPersonAffiliations: Tool = {
  name: 'get_person_affiliations',
  description: `Get all company affiliations for a person from QCC (企查查).
Returns a list of companies they are associated with, including their roles
(shareholder/director/supervisor), shareholding percentages, and company status.
Use this FIRST when researching a person to understand their business relationships.
Returns both current and historical affiliations.`,
  parameters: {
    type: 'object',
    properties: {
      person_url: {
        type: 'string',
        description: 'QCC person profile URL (e.g., https://www.qcc.com/pl/...)',
      },
      include_historical: {
        type: 'boolean',
        description: 'Whether to include historical (past) affiliations',
        default: true,
      },
    },
    required: ['person_url'],
  },
  execute: async (params, context): Promise<ToolResult> => {
    const { person_url, include_historical = true } = params;

    try {
      context.reportProgress('Navigating to person profile...');

      // Navigate to the person's profile
      await context.browserBridge.navigate(person_url);

      // Extract current affiliations
      context.reportProgress('Extracting current affiliations...');
      const currentResult = await context.browserBridge.sendToExtension('EXTRACT_AFFILIATIONS', {
        tab: 'current',
      });

      const affiliations: Affiliation[] = [];
      const personName = currentResult.personName || '';

      if (currentResult.affiliations) {
        for (const aff of currentResult.affiliations) {
          affiliations.push({ ...aff, isCurrent: true });
        }
      }

      // Extract historical affiliations if requested
      if (include_historical) {
        context.reportProgress('Switching to historical tab...');
        await context.browserBridge.sendToExtension('SWITCH_TAB', { tab: 'historical' });

        // Wait for tab to load
        await new Promise(r => setTimeout(r, 1500));

        context.reportProgress('Extracting historical affiliations...');
        const historicalResult = await context.browserBridge.sendToExtension('EXTRACT_AFFILIATIONS', {
          tab: 'historical',
        });

        if (historicalResult.affiliations) {
          for (const aff of historicalResult.affiliations) {
            affiliations.push({ ...aff, isCurrent: false });
          }
        }
      }

      // Update agent state
      context.agentState.subjectName = personName;
      context.agentState.subjectUrl = person_url;
      context.agentState.affiliations = affiliations;
      context.agentState.companiesTotal = affiliations.length;

      const currentCount = affiliations.filter(a => a.isCurrent).length;
      const historicalCount = affiliations.filter(a => !a.isCurrent).length;

      // Build observation for AI
      const companyList = affiliations
        .slice(0, 5)
        .map(a => `${a.companyName} (${a.role}${a.shareholdingPercent ? ` ${a.shareholdingPercent}` : ''})`)
        .join(', ');

      return {
        success: true,
        data: {
          personName,
          affiliations,
          counts: { current: currentCount, historical: historicalCount, total: affiliations.length },
        },
        observation: `Found ${affiliations.length} affiliations for ${personName}: ${currentCount} current, ${historicalCount} historical. Companies include: ${companyList}${affiliations.length > 5 ? '...' : ''}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        observation: `Failed to get affiliations: ${error.message}. Make sure you're on a valid QCC person profile page.`,
      };
    }
  },
};

/**
 * Get Company Details
 *
 * Extracts basic company information including registration number.
 */
export const getCompanyDetails: Tool = {
  name: 'get_company_details',
  description: `Get detailed information about a company from QCC including:
- Registration number (统一社会信用代码) - the official 18-character code
- Company status (active/cancelled/revoked)
- Established date
- Legal representative
Use this when you need the official registration number for a company.`,
  parameters: {
    type: 'object',
    properties: {
      company_url: {
        type: 'string',
        description: 'QCC company profile URL (e.g., https://www.qcc.com/firm/...)',
      },
    },
    required: ['company_url'],
  },
  execute: async (params, context): Promise<ToolResult> => {
    const { company_url } = params;

    try {
      context.reportProgress(`Navigating to company page...`);
      await context.browserBridge.navigate(company_url);

      context.reportProgress('Extracting company details...');
      const result = await context.browserBridge.sendToExtension('GET_COMPANY_BASIC');

      if (!result.success) {
        throw new Error(result.error || 'Failed to extract company details');
      }

      const details: CompanyDetails = {
        companyName: result.data.companyName || '',
        registrationNumber: result.data.registrationNumber || '',
        status: result.data.status || '',
        establishedDate: result.data.establishedDate,
        legalRepresentative: result.data.legalRepresentative,
      };

      // Store in agent state
      context.agentState.companyDetails.set(company_url, details);
      context.agentState.companiesVisited++;

      return {
        success: true,
        data: details,
        observation: `Company: ${details.companyName}, Registration: ${details.registrationNumber || 'not found'}, Status: ${details.status || 'unknown'}${details.establishedDate ? `, Established: ${details.establishedDate}` : ''}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        observation: `Failed to get company details: ${error.message}`,
      };
    }
  },
};

/**
 * Find Person Role in Company
 *
 * Finds a specific person within a company page and extracts their roles and dates.
 */
export const findPersonRoleInCompany: Tool = {
  name: 'find_person_role_in_company',
  description: `Find a specific person's role and appointment dates within a company page.
Returns their positions (shareholder/director/supervisor), shareholding percentage,
and when they were appointed or resigned.
Use this after navigating to a company page to get the appointment dates for your research subject.`,
  parameters: {
    type: 'object',
    properties: {
      company_url: {
        type: 'string',
        description: 'QCC company profile URL',
      },
      person_name: {
        type: 'string',
        description: 'Name of the person to find (Chinese name)',
      },
    },
    required: ['company_url', 'person_name'],
  },
  execute: async (params, context): Promise<ToolResult> => {
    const { company_url, person_name } = params;

    try {
      // Check if we need to navigate (might already be on the page)
      const currentUrl = await context.browserBridge.sendToExtension('GET_CURRENT_URL').catch(() => null);
      if (!currentUrl || currentUrl !== company_url) {
        context.reportProgress(`Navigating to company page...`);
        await context.browserBridge.navigate(company_url);
      }

      context.reportProgress(`Searching for ${person_name} in company records...`);
      const result = await context.browserBridge.sendToExtension('FIND_PERSON_IN_COMPANY', {
        personName: person_name,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to find person');
      }

      const personData: PersonInCompany = result.data;

      if (!personData.found) {
        return {
          success: true,
          data: personData,
          observation: `${person_name} was not found in the records for ${personData.companyName}. They may have been removed or the name doesn't match exactly.`,
        };
      }

      // Format roles for observation
      const rolesText = personData.roles
        .map(r => {
          let text = r.role;
          if (r.percentage) text += ` (${r.percentage})`;
          if (r.appointmentDate) text += ` since ${r.appointmentDate}`;
          if (r.resignationDate) text += ` until ${r.resignationDate}`;
          return text;
        })
        .join('; ');

      return {
        success: true,
        data: personData,
        observation: `Found ${person_name} in ${personData.companyName}. Roles: ${rolesText}. Registration: ${personData.registrationNumber || 'not found'}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        observation: `Failed to find person in company: ${error.message}`,
      };
    }
  },
};

/**
 * Translate to English
 *
 * Uses Kimi to translate Chinese text to English.
 */
export const translateToEnglish: Tool = {
  name: 'translate_to_english',
  description: `Translate Chinese text to English.
Use this to translate company names, addresses, or other Chinese text.
Provide context (e.g., 'company_name', 'address', 'person_name') for more accurate translation.`,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Chinese text to translate',
      },
      context: {
        type: 'string',
        description: "Context for translation: 'company_name', 'address', 'person_name', 'industry', etc.",
      },
    },
    required: ['text'],
  },
  execute: async (params, context): Promise<ToolResult> => {
    const { text, context: translationContext = 'general' } = params;

    try {
      context.reportProgress(`Translating: ${text.slice(0, 30)}...`);

      const prompt = `Translate the following Chinese ${translationContext} to English.
Return ONLY the English translation, nothing else.
If it's a company name, use standard business suffixes (Co., Ltd., Inc., etc.).

Chinese: ${text}

English:`;

      const translation = await context.callKimi(prompt);

      return {
        success: true,
        data: { original: text, translation: translation.trim(), context: translationContext },
        observation: `Translated "${text}" → "${translation.trim()}"`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        observation: `Failed to translate: ${error.message}`,
      };
    }
  },
};

/**
 * Format DD Report
 *
 * Generates a formatted due diligence report from collected data.
 */
export const formatDDReport: Tool = {
  name: 'format_dd_report',
  description: `Generate a formatted due diligence report from collected data.
Call this when you have gathered all the information needed (affiliations, registration numbers, appointment dates, translations).
The report will be formatted according to the specified format.`,
  parameters: {
    type: 'object',
    properties: {
      subject_name: {
        type: 'string',
        description: 'Name of the research subject',
      },
      subject_name_english: {
        type: 'string',
        description: 'English name/transliteration of the subject',
      },
      affiliations: {
        type: 'array',
        description: 'Array of affiliation objects with company details',
      },
      format: {
        type: 'string',
        description: 'Output format',
        enum: ['json', 'markdown', 'text'],
      },
    },
    required: ['subject_name', 'affiliations'],
  },
  execute: async (params, context): Promise<ToolResult> => {
    const { subject_name, subject_name_english, affiliations, format = 'markdown' } = params;

    try {
      context.reportProgress('Generating report...');

      const currentAffiliations = affiliations.filter((a: any) => a.isCurrent);
      const historicalAffiliations = affiliations.filter((a: any) => !a.isCurrent);

      if (format === 'json') {
        const report = {
          subject: { chinese: subject_name, english: subject_name_english },
          generatedAt: new Date().toISOString(),
          currentBusinessInterests: currentAffiliations,
          pastBusinessInterests: historicalAffiliations,
        };

        return {
          success: true,
          data: report,
          observation: `Generated JSON report for ${subject_name} with ${currentAffiliations.length} current and ${historicalAffiliations.length} historical affiliations.`,
        };
      }

      // Markdown format
      let markdown = `# Due Diligence Report\n\n`;
      markdown += `**Subject:** ${subject_name}`;
      if (subject_name_english) markdown += ` (${subject_name_english})`;
      markdown += `\n\n`;
      markdown += `**Generated:** ${new Date().toISOString()}\n\n`;

      markdown += `## Current Business Interests\n\n`;
      if (currentAffiliations.length === 0) {
        markdown += `No current affiliations found.\n\n`;
      } else {
        markdown += `| Company | Registration | Position | Dates |\n`;
        markdown += `|---------|--------------|----------|-------|\n`;
        for (const aff of currentAffiliations) {
          const position = `${aff.role || ''}${aff.shareholdingPercent ? ` ${aff.shareholdingPercent}` : ''}`;
          const dates = aff.appointmentDate || '-';
          const status = aff.status !== 'active' && aff.status !== '存续' ? ` (${aff.status})` : '';
          markdown += `| ${aff.companyName}${status} | ${aff.registrationNumber || '-'} | ${position} | ${dates} |\n`;
          if (aff.companyNameEnglish) {
            markdown += `| ${aff.companyNameEnglish} | | | |\n`;
          }
        }
        markdown += `\n`;
      }

      markdown += `## Past Business Interests\n\n`;
      if (historicalAffiliations.length === 0) {
        markdown += `No historical affiliations found.\n\n`;
      } else {
        markdown += `| Company | Registration | Position | Dates |\n`;
        markdown += `|---------|--------------|----------|-------|\n`;
        for (const aff of historicalAffiliations) {
          const position = `${aff.role || ''}${aff.shareholdingPercent ? ` ${aff.shareholdingPercent}` : ''}`;
          const dates = aff.appointmentDate
            ? `${aff.appointmentDate}${aff.resignationDate ? ` - ${aff.resignationDate}` : ''}`
            : '-';
          markdown += `| ${aff.companyName} (Dissolved) | ${aff.registrationNumber || '-'} | ${position} | ${dates} |\n`;
          if (aff.companyNameEnglish) {
            markdown += `| ${aff.companyNameEnglish} | | | |\n`;
          }
        }
      }

      return {
        success: true,
        data: { format: 'markdown', content: markdown },
        observation: `Generated markdown report for ${subject_name} with ${currentAffiliations.length} current and ${historicalAffiliations.length} historical affiliations.`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        observation: `Failed to generate report: ${error.message}`,
      };
    }
  },
};

// Export all DD tools as an array
export const DD_TOOLS: Tool[] = [
  getPersonAffiliations,
  getCompanyDetails,
  findPersonRoleInCompany,
  translateToEnglish,
  formatDDReport,
];
