/**
 * Semantic equivalents mapping for dirty words.
 * Maps each dirty word to its variants (simplified <-> traditional, synonyms).
 * Used by programmatic eliminator Rule 4 to check if dirty words are present.
 */

export const DIRTY_WORD_EQUIVALENTS: Record<string, string[]> = {
  // === CRIME / CRIMINAL ===
  '贪污': ['貪污', '腐败', '腐敗', 'corruption', '贪腐', '貪腐'],
  '贿赂': ['賄賂', '受贿', '受賄', '行贿', '行賄', 'bribery', '索贿', '索賄'],
  '诈骗': ['詐騙', '欺诈', '欺詐', 'fraud', '骗局', '騙局'],
  '诈骗者': ['詐騙者', '骗子', '騙子'],
  '洗钱': ['洗錢', '洗黑钱', '洗黑錢', 'money laundering'],
  '谋杀': ['謀殺', 'murder', '杀人', '殺人'],
  '强奸': ['強姦', 'rape', '性侵'],
  '抢劫': ['搶劫', 'robbery', '打劫'],
  '盗窃': ['盜竊', '偷窃', '偷竊', 'theft', '窃取', '竊取'],
  '窃贼': ['竊賊', '小偷'],
  '逃犯': ['逃犯', 'fugitive'],

  // === LEGAL / COURT ===
  '被拘': ['被拘', '拘留', '拘捕', 'detained', 'arrested'],
  '被诉': ['被訴', '起诉', '起訴', 'prosecuted', 'sued'],
  '被起诉': ['被起訴', '遭起诉', '遭起訴'],
  '逮捕': ['逮捕', 'arrest', '抓捕'],
  '判决': ['判決', 'verdict', '宣判'],
  '审判': ['審判', 'trial', '庭审', '庭審'],
  '开庭': ['開庭', 'court hearing'],
  '监禁': ['監禁', 'imprisonment', '入狱', '入獄'],
  '收监': ['收監', 'incarcerated'],
  '假释': ['假釋', 'parole'],
  '定罪': ['定罪', 'convicted', '有罪'],
  '轻罪': ['輕罪', 'misdemeanor'],
  '重罪': ['重罪', 'felony'],
  '提审': ['提審', 'arraignment'],

  // === FINANCIAL CRIME ===
  '内幕交易': ['內幕交易', '内线交易', '內線交易', 'insider trading'],
  '操纵股价': ['操縱股價', '股价操纵', '股價操縱', 'stock manipulation'],
  '操纵市场': ['操縱市場', 'market manipulation'],
  '操纵证券': ['操縱證券', 'securities manipulation'],
  '非法交易': ['非法交易', 'illegal trading'],
  '内幕消息': ['內幕消息', 'insider information'],
  '内幕': ['內幕', 'insider'],

  // === REGULATORY ===
  '证监会': ['證監會', 'SFC', 'CSRC', '证期局', '證期局'],
  '处罚': ['處罰', 'penalty', '惩罚', '懲罰'],
  '罚款': ['罰款', 'fine', '被罚款', '被罰款'],
  '裁罚': ['裁罰', 'sanction'],
  '处分': ['處分', 'disciplinary action'],
  '警告': ['警告', 'warning'],
  '禁止': ['禁止', 'banned', '禁令'],
  '撤职': ['撤職', 'removed from position'],
  '停职': ['停職', 'suspended'],
  '制裁': ['制裁', 'sanction', '资产冻结', '資產凍結'],
  '反贪': ['反貪', 'anti-corruption'],
  '惩戒': ['懲戒', 'disciplinary'],

  // === CORPORATE ===
  '破产': ['破產', 'bankruptcy', '清算'],
  '违约': ['違約', 'default'],
  '纠纷': ['糾紛', 'dispute'],
  '诉讼': ['訴訟', 'lawsuit', '官司'],
  '案件': ['案件', 'case'],

  // === INVESTIGATION ===
  '调查': ['調查', 'investigation', '查处', '查處'],
  '双规': ['雙規', 'shuanggui'],
  '检察官': ['檢察官', 'prosecutor'],
  '监察': ['監察', 'supervision', '纪检', '紀檢'],
  '指控': ['指控', 'accusation', '控告'],

  // === MISC ADVERSE ===
  '违法': ['違法', 'illegal', '违纪', '違紀'],
  '舞弊': ['舞弊', 'malpractice', '造假'],
  '虚假': ['虛假', 'false', '假帐', '假帳'],
  '黑手党': ['黑手黨', 'mafia', '黑社会', '黑社會'],
  '敲诈勒索': ['敲詐勒索', 'extortion', '勒索'],
  '回扣': ['回扣', 'kickback'],
  '走私': ['走私', 'smuggling'],
  '违反': ['違反', 'violation'],
  '违犯': ['違犯', 'violate'],
  '非法': ['非法', 'illegal'],
  '黑箱': ['黑箱', 'black box'],
  '不端行为': ['不端行為', 'misconduct'],

  // === LABOR / HUMAN RIGHTS ===
  '强迫劳动': ['強迫勞動', 'forced labor', '强制劳动', '強制勞動'],
  '强迫劳工': ['強迫勞工', 'forced workers'],
  '童工': ['童工', 'child labor'],
  '奴隶': ['奴隸', 'slave', '仆人', '僕人', '仆役', '僕役'],
  '剥削': ['剝削', 'exploitation'],
  '被贩卖': ['被販賣', 'trafficked'],
  '被绑架': ['被綁架', 'kidnapped'],
  '被勒索': ['被勒索', 'extorted'],

  // === TERRORISM / EXTREMISM ===
  '恐怖主义': ['恐怖主義', 'terrorism'],
  '恐怖分子': ['恐怖分子', 'terrorist'],
  '极端主义': ['極端主義', 'extremism'],
  '极端主义者': ['極端主義者', 'extremist'],
  '政治敏感': ['政治敏感', 'politically sensitive'],

  // === DRUGS ===
  '毒贩': ['毒販', 'drug dealer'],
  '药物成瘾': ['藥物成癮', 'drug addiction'],
  '滥用药物': ['濫用藥物', 'drug abuse'],
  '麻药': ['麻藥', 'narcotics'],
  '吸毒者': ['吸毒者', 'drug user'],

  // === MISC ===
  '邪恶': ['邪惡', 'evil'],
  '耻辱': ['恥辱', 'disgrace'],
  '堕落': ['墮落', 'corrupt', '腐化'],
  '攻击': ['攻擊', 'attack'],
  '捕获': ['捕獲', 'captured'],
  '欺骗': ['欺騙', 'deceive', '受骗', '受騙'],
  '滥用': ['濫用', 'abuse'],
  '失格': ['失格', 'disqualified'],
  '冒犯': ['冒犯', 'offense'],
  '下套': ['下套', 'entrap'],
  '退回赃物': ['退回贓物', 'return stolen goods'],
  '违禁品': ['違禁品', 'contraband'],
  '色情': ['色情', 'pornography'],
  '从器件': ['從器件', 'accessories'],
  '诽谤': ['誹謗', 'defamation'],
  '丑闻': ['醜聞', 'scandal'],
  '争议': ['爭議', 'controversy'],
  '误导': ['誤導', 'misleading'],
  '操纵': ['操縱', 'manipulation'],
  '黑钱': ['黑錢', 'dirty money'],
  '避税': ['避稅', 'tax avoidance'],
  '逃税': ['逃稅', 'tax evasion'],
  '指责': ['指責', 'blame'],
  '投诉': ['投訴', 'complaint'],

  // === SINGLE CHARS (catch-all for short forms) ===
  '欺': ['欺', '欺骗', '欺騙', '欺诈', '欺詐'],
  '骗': ['騙', '诈骗', '詐騙', '骗局', '騙局'],
  '抢': ['搶', '抢劫', '搶劫'],
  '姦': ['姦', '强奸', '強姦'],
  '贿': ['賄', '贿赂', '賄賂', '受贿', '受賄'],
  '滥': ['濫', '滥用', '濫用'],
  '狱': ['獄', '监狱', '監獄', '入狱', '入獄'],
  '盗': ['盜', '盗窃', '盜竊'],
  '窃': ['竊', '窃取', '竊取', '窃贼', '竊賊'],
  '赌': ['賭', '赌博', '賭博'],
};

/**
 * Get all equivalent terms for a dirty word.
 * Returns the word itself plus all its equivalents.
 */
export function getEquivalents(word: string): string[] {
  const equivalents = DIRTY_WORD_EQUIVALENTS[word];
  if (equivalents) {
    return [word, ...equivalents];
  }
  // Check if this word is an equivalent of another
  for (const [key, values] of Object.entries(DIRTY_WORD_EQUIVALENTS)) {
    if (values.includes(word)) {
      return [key, ...values];
    }
  }
  return [word];
}

/**
 * Check if any dirty word (or its equivalents) appears in text.
 */
export function hasDirtyWordMatch(text: string, dirtyWords: string[]): boolean {
  const textLower = text.toLowerCase();
  for (const word of dirtyWords) {
    const equivalents = getEquivalents(word);
    for (const equiv of equivalents) {
      if (textLower.includes(equiv.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}
