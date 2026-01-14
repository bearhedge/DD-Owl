// DD Owl - Dirty Word Search Strings
// Each template has {NAME} placeholder to be replaced with subject name
// Uses Google OR operator (|) to search multiple terms

export const SEARCH_TEMPLATES = [
  // Simplified Chinese - Set 1: Drug/Detention/Prosecution
  `"{NAME}" 药物成瘾 | 被拘 | 被诉 | 轻罪 | 邪恶 | 骗局`,

  // Simplified Chinese - Set 2: Securities/Fraud
  `"{NAME}" 集体诉讼 | 麻药 | 内线交易 | 操纵股价 | 操纵证券 | 股价操纵 | 操纵市场 | 受骗 | 堕落 | 极端主义者 | 欺骗 | 滥用药物 | 盗窃罪 | 禁止 | 耻辱`,

  // Simplified Chinese - Set 3: Violence/Extortion
  `"{NAME}" 抢劫 | 指控 | 捕获 | 攻击 | 敲诈勒索 | 极端主义 | 毒贩 | 清算 | 滥用 | 盗窃 | 窃取 | 窃贼 | 被罚款 | 资产冻结 | 违犯`,

  // Simplified Chinese - Set 4: Major Crimes
  `"{NAME}" 诈骗者 | 谋杀 | 贪污 | 贿赂 | 违禁品 | 退回赃物 | 逃犯 | 非法交易 | 黑手党 | 不端行为 | 假释 | 偷窃 | 内幕交易 | 强奸`,

  // Simplified Chinese - Set 5: Terrorism/Money Laundering
  `"{NAME}" 仆役 | 剥削 | 回扣 | 内幕消息 | 恐怖主义 | 恐怖分子 | 提审 | 收监 | 欺诈 | 洗钱 | 监禁 | 破产 | 被绑架 | 被贩卖 | 被起诉`,

  // Simplified Chinese - Set 6: Labor/Corruption
  `"{NAME}" 处罚 | 刑罚| 虚假 | 刑事 | 纠纷 | 腐败 | 撤职 | 停职 | 色情 | 奴隶 | 从器件 | 强迫劳动 | 强制劳动 | 强迫劳工 | 童工 | 仆人`,

  // Simplified Chinese - Set 7: Legal/Regulatory
  `"{NAME}" 裁罚 | 处分 | 舞弊 | 诉讼 | 指责 | 判决 | 投诉 | 审判 | 开庭 | 双规 | 检察官 | 监察 | 黑箱 | 违法 | 违纪`,

  // Traditional Chinese - Set 1
  `"{NAME}" 濫用藥物 | 盜竊罪 | 禁令 | 恥辱 | 藥物成癮 | 被訴 | 輕罪 | 邪惡 | 騙局 | 贿 | 滥 | 假帐 | 调查 | 官司 | 违反`,

  // Traditional Chinese - Set 2
  `"{NAME}" 內線交易 | 操縱股價 | 操縱證券 | 股價操縱 | 操縱市場 | 冒犯 | 制裁 | 受騙 | 吸毒者 | 墮落 | 失格 | 性 | 拘留 | 極端主義者 | 欺騙`,

  // Traditional Chinese - Set 3
  `"{NAME}" 政治敏感 | 敲詐勒索 | 有罪 | 極端主義 | 毒販 | 濫用 | 盜竊 | 竊取 | 竊賊 | 被罰款 | 資產凍結 | 走私 | 違犯 | 集體訴訟 | 麻藥`,

  // Traditional Chinese - Set 4
  `"{NAME}" 退回贓物 | 造假 | 重罪 | 非法 | 黑手黨 | 下套 | 不端行為 | 假釋 | 偷竊 | 內幕交易 | 強姦 | 搶劫 | 捕獲 | 控告 | 攻擊`,

  // Traditional Chinese - Set 5
  `"{NAME}" 收監 | 詐欺 | 洗錢 | 監禁 | 破產 | 腐化 | 被勒索 | 被綁架 | 被販賣 | 被起訴 | 詐騙者 | 謀殺 | 貪污 | 賄賂 | 違禁品`,

  // Traditional Chinese - Set 6
  `"{NAME}" 撤職 | 停職 | 奴隸 | 從器件 | 強迫勞動 | 強制勞動 | 強迫勞工 | 僕人 | 僕役 | 剝削 | 內幕消息 | 勒索 | 定罪 | 恐怖主義 | 提審`,

  // Traditional Chinese - Set 7
  `"{NAME}" 指責 | 判決 | 投訴 | 審判 | 開庭 | 雙規 | 檢察官 | 監察 | 違法 | 違紀 | 處罰 | 虛假 | 糾紛 | 案件 | 腐敗`,

  // Traditional Chinese - Set 8: Regulatory
  `"{NAME}" 欺 | 騙 | 搶 | 姦 | 證監會 | 警告 | 避稅 | 逃稅 | 內幕 | 證期局 | 反貪 | 懲戒 | 裁罰 | 處分 | 訴訟`,

  // Traditional Chinese - Set 9: Misc
  `"{NAME}" 賄 | 濫 | 假帳 | 調查 | 違反 | 誹謗 | 醜聞 | 爭議 | 獄 | 誤導 | 操縱 | 黑社會 | 黑錢 | 賭 | 盜 | 竊`,

  // Violence/Seizure/Fundraising (Simplified)
  `"{NAME}" 暴力 | 强占 | 霸占 | 非法集资 | 受贿 | 行贿 | 找换 | 外汇 | 崩盘 | 瓦解 | 跑路 | 卷款`,

  // Violence/Seizure/Fundraising (Traditional)
  `"{NAME}" 暴力 | 強佔 | 霸佔 | 非法集資 | 受賄 | 行賄 | 找換 | 外匯 | 崩盤 | 瓦解 | 跑路 | 捲款`,

  // Direct site searches for high-value sources (often missed by generic search)
  `site:hkexnews.hk "{NAME}"`,           // HKEX filings
  `site:sfc.hk "{NAME}"`,                // SFC Hong Kong regulatory
  `site:zhihu.com "{NAME}"`,             // Zhihu (Chinese Quora)
  `site:collection.news "{NAME}"`,       // Apple Daily archive
  `site:weibo.com "{NAME}"`,             // Weibo
  `site:caixin.com "{NAME}"`,            // Caixin financial news
];

// Category mapping for clearer reporting
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Criminal': ['谋杀', '强奸', '抢劫', '盗窃', '攻击', '強姦', '搶劫', '盜竊', '攻擊', '暴力', '强占', '霸占', '強佔', '霸佔'],
  'Financial Crime': ['洗钱', '内幕交易', '操纵股价', '贪污', '贿赂', '洗錢', '內幕交易', '操縱股價', '貪污', '賄賂', '非法集资', '非法集資', '找换', '找換', '外汇', '外匯', '崩盘', '崩盤', '跑路', '卷款', '捲款'],
  'Fraud': ['诈骗', '欺诈', '骗局', '造假', '詐騙', '詐欺', '騙局'],
  'Sanctions/Legal': ['制裁', '资产冻结', '禁令', '被起诉', '判决', '資產凍結', '被起訴', '判決'],
  'Terrorism': ['恐怖主义', '恐怖分子', '极端主义', '恐怖主義', '極端主義'],
  'Labor Issues': ['强迫劳动', '童工', '奴隶', '剥削', '強迫勞動', '奴隸', '剝削'],
  'Regulatory': ['证监会', '警告', '处罚', '裁罚', '證監會', '處罰', '裁罰'],
  'Corruption': ['腐败', '回扣', '舞弊', '腐敗', '受贿', '行贿', '受賄', '行賄'],
  'Drug Related': ['毒贩', '药物成瘾', '麻药', '毒販', '藥物成癮', '麻藥'],
};

export function buildSearchQuery(template: string, subjectName: string): string {
  return template.replace('{NAME}', subjectName);
}

export function detectCategory(text: string): string {
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return category;
      }
    }
  }
  return 'General';
}
