-- ============================================================
-- DD OWL SEED DATA
-- Reference data for due diligence knowledge base
-- ============================================================

-- ============================================================
-- JURISDICTIONS
-- ============================================================

INSERT INTO jurisdictions (code, name_en, name_zh, region) VALUES
-- Greater China
('CN', 'China (Mainland)', '中国大陆', 'Asia'),
('HK', 'Hong Kong SAR', '香港特别行政区', 'Asia'),
('MO', 'Macau SAR', '澳门特别行政区', 'Asia'),
('TW', 'Taiwan', '台湾', 'Asia'),
-- Asia Pacific
('SG', 'Singapore', '新加坡', 'Asia'),
('JP', 'Japan', '日本', 'Asia'),
('KR', 'South Korea', '韩国', 'Asia'),
('MY', 'Malaysia', '马来西亚', 'Asia'),
('TH', 'Thailand', '泰国', 'Asia'),
('ID', 'Indonesia', '印度尼西亚', 'Asia'),
('PH', 'Philippines', '菲律宾', 'Asia'),
('VN', 'Vietnam', '越南', 'Asia'),
('AU', 'Australia', '澳大利亚', 'Oceania'),
-- Americas
('US', 'United States', '美国', 'Americas'),
('CA', 'Canada', '加拿大', 'Americas'),
('BVI', 'British Virgin Islands', '英属维尔京群岛', 'Americas'),
('KY', 'Cayman Islands', '开曼群岛', 'Americas'),
-- Europe
('UK', 'United Kingdom', '英国', 'Europe'),
('DE', 'Germany', '德国', 'Europe'),
('FR', 'France', '法国', 'Europe'),
('CH', 'Switzerland', '瑞士', 'Europe'),
('LU', 'Luxembourg', '卢森堡', 'Europe'),
('NL', 'Netherlands', '荷兰', 'Europe'),
-- International
('INTL', 'International/Multinational', '国际/多边', 'International');

-- ============================================================
-- AUTHORITY TYPES
-- ============================================================

INSERT INTO authority_types (code, name_en, name_zh, description) VALUES
('regulatory_securities', 'Securities Regulator', '证券监管机构', 'Regulates securities markets, listed companies, investment funds'),
('regulatory_banking', 'Banking Regulator', '银行监管机构', 'Regulates banks and financial institutions'),
('regulatory_insurance', 'Insurance Regulator', '保险监管机构', 'Regulates insurance companies'),
('regulatory_forex', 'Foreign Exchange Regulator', '外汇监管机构', 'Regulates foreign exchange and cross-border transactions'),
('regulatory_market', 'Market Regulator', '市场监管机构', 'Regulates business registration, competition, consumer protection'),
('regulatory_tax', 'Tax Authority', '税务机关', 'Tax collection and enforcement'),
('regulatory_customs', 'Customs Authority', '海关', 'Import/export regulation and enforcement'),
('regulatory_environmental', 'Environmental Regulator', '环保机构', 'Environmental protection enforcement'),
('judicial_court', 'Court', '法院', 'Judicial court at various levels'),
('judicial_procuratorate', 'Procuratorate', '检察院', 'Public prosecution'),
('law_enforcement', 'Law Enforcement', '执法机关', 'Police and public security'),
('party_discipline', 'Party Discipline', '党纪机关', 'Communist Party discipline inspection'),
('anti_corruption', 'Anti-Corruption', '反腐机构', 'Anti-corruption investigation'),
('exchange', 'Stock Exchange', '证券交易所', 'Stock exchange'),
('sanctions_body', 'Sanctions Authority', '制裁机构', 'Issues and enforces sanctions'),
('international_org', 'International Organization', '国际组织', 'UN, FATF, etc.');

-- ============================================================
-- ISSUE TYPES (Categories of Adverse Findings)
-- ============================================================

-- Criminal categories
INSERT INTO issue_types (code, name_en, name_zh, severity_default, description) VALUES
('criminal_conviction', 'Criminal Conviction', '刑事定罪', 'RED', 'Convicted of criminal offense'),
('criminal_charges', 'Criminal Charges', '刑事指控', 'RED', 'Charged with criminal offense, not yet convicted'),
('criminal_investigation', 'Criminal Investigation', '刑事调查', 'AMBER', 'Under criminal investigation');

-- Financial crimes
INSERT INTO issue_types (code, name_en, name_zh, severity_default, description) VALUES
('insider_trading', 'Insider Trading', '内幕交易', 'RED', 'Trading on material non-public information'),
('market_manipulation', 'Market Manipulation', '市场操纵', 'RED', 'Manipulating securities prices'),
('securities_fraud', 'Securities Fraud', '证券欺诈', 'RED', 'Fraud related to securities'),
('accounting_fraud', 'Accounting Fraud', '财务造假', 'RED', 'Falsifying financial statements'),
('fraud_general', 'Fraud (General)', '欺诈', 'RED', 'General fraud'),
('embezzlement', 'Embezzlement', '挪用公款/侵占', 'RED', 'Misappropriation of funds'),
('money_laundering', 'Money Laundering', '洗钱', 'RED', 'Laundering proceeds of crime'),
('bribery', 'Bribery', '行贿', 'RED', 'Offering bribes'),
('corruption', 'Corruption', '贪污受贿', 'RED', 'Receiving bribes, corrupt practices'),
('tax_evasion', 'Tax Evasion', '逃税', 'RED', 'Criminal tax evasion');

-- Sanctions
INSERT INTO issue_types (code, name_en, name_zh, severity_default, description) VALUES
('sanctions_ofac', 'OFAC Sanctions', 'OFAC制裁', 'RED', 'US Treasury OFAC sanctions list'),
('sanctions_un', 'UN Sanctions', '联合国制裁', 'RED', 'United Nations sanctions'),
('sanctions_eu', 'EU Sanctions', '欧盟制裁', 'RED', 'European Union sanctions'),
('sanctions_uk', 'UK Sanctions', '英国制裁', 'RED', 'UK sanctions'),
('sanctions_other', 'Other Sanctions', '其他制裁', 'RED', 'Other national sanctions');

-- Regulatory
INSERT INTO issue_types (code, name_en, name_zh, severity_default, description) VALUES
('regulatory_fine', 'Regulatory Fine', '监管处罚', 'AMBER', 'Fined by regulatory authority'),
('regulatory_warning', 'Regulatory Warning', '监管警告', 'AMBER', 'Warning from regulatory authority'),
('regulatory_ban', 'Regulatory Ban', '市场禁入', 'RED', 'Banned from market/industry'),
('license_revoked', 'License Revoked', '吊销执照', 'RED', 'Business license revoked'),
('disclosure_violation', 'Disclosure Violation', '信息披露违规', 'AMBER', 'Failed to disclose required information');

-- Civil/Commercial
INSERT INTO issue_types (code, name_en, name_zh, severity_default, description) VALUES
('civil_litigation', 'Civil Litigation', '民事诉讼', 'AMBER', 'Party to civil lawsuit'),
('breach_of_contract', 'Breach of Contract', '违约', 'AMBER', 'Contract breach'),
('intellectual_property', 'IP Infringement', '知识产权侵权', 'AMBER', 'Patent, trademark, copyright infringement'),
('labor_dispute', 'Labor Dispute', '劳动争议', 'AMBER', 'Employment-related disputes'),
('debt_default', 'Debt Default', '债务违约', 'AMBER', 'Defaulted on debt obligations');

-- Corporate
INSERT INTO issue_types (code, name_en, name_zh, severity_default, description) VALUES
('bankruptcy', 'Bankruptcy', '破产', 'AMBER', 'Personal or corporate bankruptcy'),
('business_failure', 'Business Failure', '经营失败', 'AMBER', 'Significant business failure'),
('delisting', 'Delisting', '退市', 'AMBER', 'Stock delisted from exchange');

-- Other adverse
INSERT INTO issue_types (code, name_en, name_zh, severity_default, description) VALUES
('pep', 'Politically Exposed Person', '政治公众人物', 'AMBER', 'Government official or close associate'),
('negative_media', 'Negative Media', '负面媒体', 'AMBER', 'Significant negative media coverage'),
('environmental_violation', 'Environmental Violation', '环境违规', 'AMBER', 'Environmental law violations'),
('safety_violation', 'Safety Violation', '安全违规', 'AMBER', 'Workplace safety violations'),
('other_adverse', 'Other Adverse', '其他负面', 'AMBER', 'Other adverse information');

-- ============================================================
-- AUTHORITIES - CHINA NATIONAL LEVEL
-- ============================================================

-- Get jurisdiction ID for China
-- Note: Using subqueries since we just inserted the data

-- Securities & Financial Regulators
INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('中国证券监督管理委员会', 'China Securities Regulatory Commission', 'CSRC',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_securities'),
 'national'),

('中国银行保险监督管理委员会', 'China Banking and Insurance Regulatory Commission', 'CBIRC',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_banking'),
 'national'),

('中国人民银行', 'People''s Bank of China', 'PBOC',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_banking'),
 'national'),

('国家外汇管理局', 'State Administration of Foreign Exchange', 'SAFE',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_forex'),
 'national'),

('国家金融监督管理总局', 'National Financial Regulatory Administration', 'NFRA',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_banking'),
 'national');

-- Market & Business Regulators
INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('国家市场监督管理总局', 'State Administration for Market Regulation', 'SAMR',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_market'),
 'national'),

('国家税务总局', 'State Taxation Administration', 'STA',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_tax'),
 'national'),

('海关总署', 'General Administration of Customs', 'GACC',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_customs'),
 'national'),

('生态环境部', 'Ministry of Ecology and Environment', 'MEE',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_environmental'),
 'national');

-- Judicial - Courts
INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('最高人民法院', 'Supreme People''s Court', 'SPC',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'judicial_court'),
 'national');

-- Judicial - Procuratorate
INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('最高人民检察院', 'Supreme People''s Procuratorate', 'SPP',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'judicial_procuratorate'),
 'national');

-- Law Enforcement
INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('公安部', 'Ministry of Public Security', 'MPS',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'law_enforcement'),
 'national');

-- Anti-corruption & Party
INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('国家监察委员会', 'National Supervisory Commission', 'NSC',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'anti_corruption'),
 'national'),

('中央纪律检查委员会', 'Central Commission for Discipline Inspection', 'CCDI',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'party_discipline'),
 'national');

-- Stock Exchanges
INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('上海证券交易所', 'Shanghai Stock Exchange', 'SSE',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'exchange'),
 'national'),

('深圳证券交易所', 'Shenzhen Stock Exchange', 'SZSE',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'exchange'),
 'national'),

('北京证券交易所', 'Beijing Stock Exchange', 'BSE',
 (SELECT id FROM jurisdictions WHERE code = 'CN'),
 (SELECT id FROM authority_types WHERE code = 'exchange'),
 'national');

-- ============================================================
-- AUTHORITIES - HONG KONG
-- ============================================================

INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('香港证券及期货事务监察委员会', 'Securities and Futures Commission', 'SFC',
 (SELECT id FROM jurisdictions WHERE code = 'HK'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_securities'),
 'national'),

('香港金融管理局', 'Hong Kong Monetary Authority', 'HKMA',
 (SELECT id FROM jurisdictions WHERE code = 'HK'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_banking'),
 'national'),

('香港交易所', 'Hong Kong Exchanges and Clearing', 'HKEX',
 (SELECT id FROM jurisdictions WHERE code = 'HK'),
 (SELECT id FROM authority_types WHERE code = 'exchange'),
 'national'),

('廉政公署', 'Independent Commission Against Corruption', 'ICAC',
 (SELECT id FROM jurisdictions WHERE code = 'HK'),
 (SELECT id FROM authority_types WHERE code = 'anti_corruption'),
 'national');

-- ============================================================
-- AUTHORITIES - INTERNATIONAL
-- ============================================================

INSERT INTO authorities (name_zh, name_en, abbreviation, jurisdiction_id, authority_type_id, level) VALUES
('美国财政部海外资产控制办公室', 'Office of Foreign Assets Control', 'OFAC',
 (SELECT id FROM jurisdictions WHERE code = 'US'),
 (SELECT id FROM authority_types WHERE code = 'sanctions_body'),
 'national'),

('美国证券交易委员会', 'Securities and Exchange Commission', 'SEC',
 (SELECT id FROM jurisdictions WHERE code = 'US'),
 (SELECT id FROM authority_types WHERE code = 'regulatory_securities'),
 'national'),

('美国司法部', 'Department of Justice', 'DOJ',
 (SELECT id FROM jurisdictions WHERE code = 'US'),
 (SELECT id FROM authority_types WHERE code = 'law_enforcement'),
 'national'),

('联邦调查局', 'Federal Bureau of Investigation', 'FBI',
 (SELECT id FROM jurisdictions WHERE code = 'US'),
 (SELECT id FROM authority_types WHERE code = 'law_enforcement'),
 'national'),

('金融行动特别工作组', 'Financial Action Task Force', 'FATF',
 (SELECT id FROM jurisdictions WHERE code = 'INTL'),
 (SELECT id FROM authority_types WHERE code = 'international_org'),
 'national'),

('联合国安全理事会', 'United Nations Security Council', 'UNSC',
 (SELECT id FROM jurisdictions WHERE code = 'INTL'),
 (SELECT id FROM authority_types WHERE code = 'sanctions_body'),
 'national'),

('国际刑警组织', 'International Criminal Police Organization', 'INTERPOL',
 (SELECT id FROM jurisdictions WHERE code = 'INTL'),
 (SELECT id FROM authority_types WHERE code = 'law_enforcement'),
 'national');

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================

-- Show counts
SELECT 'jurisdictions' as table_name, COUNT(*) as count FROM jurisdictions
UNION ALL
SELECT 'authority_types', COUNT(*) FROM authority_types
UNION ALL
SELECT 'issue_types', COUNT(*) FROM issue_types
UNION ALL
SELECT 'authorities', COUNT(*) FROM authorities;
