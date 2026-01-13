// QCC (Qichacha) Data Types for DD Owl

export interface QCCCompanyProfile {
  // Basic Information
  companyName: string;           // 企业名称
  companyNameChinese: string;    // 中文名称
  companyNameEnglish: string;    // 英文名称
  legalRepresentative: string;   // 法定代表人
  registeredCapital: string;     // 注册资本
  paidInCapital: string;         // 实缴资本
  establishedDate: string;       // 成立日期
  operatingStatus: string;       // 经营状态

  // Registration IDs
  unifiedSocialCreditCode: string; // 统一社会信用代码
  businessRegNumber: string;       // 商业登记号码 (HK)
  companyNumber: string;           // 公司编号 (HK)
  organizationCode: string;        // 组织机构代码
  taxpayerNumber: string;          // 纳税人识别号
  qccId: string;                   // 企查查编号

  // Company Details
  companyType: string;           // 企业类型
  industry: string;              // 所属行业
  approvalDate: string;          // 核准日期
  registrationAuthority: string; // 登记机关
  businessScope: string;         // 经营范围
  registeredAddress: string;     // 注册地址
  officeAddress: string;         // 办事处地址
  jurisdiction: string;          // 司法管辖区 (中国香港 etc.)

  // Shareholders
  shareholders: QCCShareholder[];

  // Key Personnel
  directors: QCCDirector[];
  executives: QCCExecutive[];

  // Beneficial Ownership
  beneficialOwners: QCCBeneficialOwner[];
  actualControllers: QCCActualController[];

  // Related Companies
  subsidiaries: QCCRelatedCompany[];
  investments: QCCRelatedCompany[];
  controlledCompanies: QCCRelatedCompany[];

  // Risk Information
  riskSummary: QCCRiskSummary;

  // Metadata
  sourceUrl: string;
  extractedAt: string;

  // Debug data
  _rawTables?: Array<{ tableIndex: number; data: Array<{ label: string; value: string }> }>;
  _linkedProfiles?: Array<{ name: string; url: string; type: 'individual' | 'company' }>;
}

export interface QCCShareholder {
  name: string;
  type: 'individual' | 'corporate';
  investmentAmount: string;
  percentage: string;
  subscriptionDate: string;
  profileUrl?: string;
}

export interface QCCDirector {
  name: string;
  position: string;
  appointmentDate?: string;
  profileUrl?: string;
}

export interface QCCExecutive {
  name: string;
  position: string;
  profileUrl?: string;
}

export interface QCCBeneficialOwner {
  name: string;
  percentage?: string;
  profileUrl?: string;
}

export interface QCCActualController {
  name: string;
  controlPath?: string;
  profileUrl?: string;
}

export interface QCCRelatedCompany {
  name: string;
  percentage?: string;
  profileUrl?: string;
  status?: string;
}

export interface QCCRiskSummary {
  legalCasesTotal: number;
  asDefendant: number;
  asPlaintiff: number;
  administrativePenalties: number;
  abnormalOperations: boolean;
  seriousViolations: boolean;
  taxArrears: number;
  businessRisks: number;
}

export interface QCCSearchResult {
  companyName: string;
  profileUrl: string;
  status: string;
  legalRep: string;
  registeredCapital: string;
  establishedDate: string;
}

export interface QCCSearchResponse {
  sourceUrl: string;
  extractedAt: string;
  pageType: 'search_results';
  resultCount: number;
  results: QCCSearchResult[];
}

// WebSocket message types for Extension <-> Backend communication
export type WSMessageType =
  | 'GET_STATUS'
  | 'STATUS_RESPONSE'
  | 'EXTRACTED_DATA'
  | 'EXTRACTION_ACK'
  | 'START_AUTO_MODE'
  | 'STOP_AUTO_MODE'
  | 'AUTO_MODE_STATUS'
  | 'AUTO_MODE_STARTED'
  | 'AUTO_MODE_STOPPED'
  | 'NAVIGATE_TO'
  | 'NAVIGATION_COMPLETE'
  | 'PUPPETEER_STATUS'
  | 'TAKE_OVER'
  | 'ERROR'
  // Research messages
  | 'START_PERSON_RESEARCH'
  | 'STOP_PERSON_RESEARCH'
  | 'GET_RESEARCH_STATUS'
  | 'RESEARCH_STATUS_RESPONSE'
  | 'GET_RESEARCH_RESULTS'
  | 'RESEARCH_RESULTS_RESPONSE'
  | 'CLEAR_RESEARCH_SESSION'
  | 'SESSION_CLEARED'
  | 'EXTENSION_RESPONSE'
  | 'RESEARCH_STARTED'
  | 'RESEARCH_COMPLETED'
  | 'RESEARCH_FAILED'
  | 'RESEARCH_STOPPED'
  | 'RESEARCH_PROGRESS'
  // AI Agent messages
  | 'START_AI_AGENT'
  | 'STOP_AI_AGENT'
  | 'AGENT_PROGRESS'
  | 'AGENT_COMPLETED'
  | 'AGENT_FAILED'
  | 'TOOL_EXECUTION';

export interface WSMessage {
  type: WSMessageType;
  data?: any;
  timestamp?: string;
}

export interface ExtractedDataMessage extends WSMessage {
  type: 'EXTRACTED_DATA';
  data: QCCCompanyProfile | QCCSearchResponse;
}

export interface PuppeteerStatusMessage extends WSMessage {
  type: 'PUPPETEER_STATUS';
  data: {
    running: boolean;
    currentUrl?: string;
    progress?: {
      current: number;
      total: number;
    };
    lastExtracted?: string[];
  };
}

export interface AutoModeConfig {
  startUrl: string;
  maxDepth: number;
  followShareholders: boolean;
  followDirectors: boolean;
  followInvestments: boolean;
}
