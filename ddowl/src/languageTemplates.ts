// DD Owl - Multi-Language Search Templates
// Each template has {NAME} placeholder to be replaced with subject name
// Uses Google pipe (|) operator for OR within a single query
// Dirty words extracted from reference doc + generated for missing languages

// ============================================================
// ARABIC (ar) — from reference doc
// ============================================================
export const ARABIC_TEMPLATES = [
  // AQ1: Criminal, Violence & Corruption
  `"{NAME}" تعسف|ادعاء|اعتقال|اتهام|اعتدى|رشوة|مرتشي|ارتشاء|أسير|فساد|فسد|مزور|خدع|خداع|احتيال|مذنب|مجرم|حبيس|مسجون|سجن|معتقل|اختلاس|ابتزاز`,

  // AQ2: Legal, Financial & Fraud
  `"{NAME}" تهريب|تزوير|تزييف|إدانة|ادانة|محكمة|مخدرات|فضيحة|فضائح|غرامة|تغريم|عقوبة|حظر|محظور|محاكمة|اغتصاب|سارق|إرهاب|ارهاب|قتل|قاتل|مافيا|تلاعب|انتهاك`,

  // AQ3: Sanctions, Misconduct & Human Rights
  `"{NAME}" تجميد|مفلس|افلاس|خرق|مخالفة|هارب|طريد|نصب|جنسي|مهرب|تسلل|اغتصاب|سرق|خلسة|تصفية|التقاضي|جنحة|منظمة|حكم|عقاب|ردع|ممنوع|محاكمة|وثائق|بنما`,
];

export const ARABIC_SITE_TEMPLATES = [
  `site:interpol.int OR site:un.org OR site:treasury.gov "{NAME}"`,
];

// ============================================================
// DUTCH (nl) — from reference doc
// ============================================================
export const DUTCH_TEMPLATES = [
  // NQ1: Criminal & Violence
  `"{NAME}" mishandeling|schending|aanranding|aanval|overval|arrestatie|gearresteerd|aanhouding|veroordeling|crimineel|misdaad|gevangenis|moord|doodslag|geweld|brandstichting|huurmoord|liquidatie|dader|gangster|verkrachting|incest|ontucht|wapen`,

  // NQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" fraude|oplichting|bedrog|witwassen|verduistering|malversatie|belastingfraude|belastingontduiking|faillissement|bankroet|omkoping|steekpenning|corruptie|zwendel|hypotheekfraude|verzekeringsfraude|vastgoedfraude|kredietfraude|bankfraude|surseance|insolvent`,

  // NQ3: Legal, Regulatory & Misconduct
  `"{NAME}" rechtbank|justitie|veroordelen|dagvaarding|aanklacht|strafproces|vonnis|uitspraak|sanctie|boete|geldboete|verbod|schorsing|diskwalificatie|kartel|mensensmokkel|mensenhandel|drugsdeal|drugshandel|heling|diefstal|terrorisme|extremisme|embargo|confiscatie`,
];

export const DUTCH_SITE_TEMPLATES = [
  `site:rechtspraak.nl OR site:om.nl OR site:fiod.nl OR site:afm.nl "{NAME}"`,
];

// ============================================================
// FRENCH (fr) — from reference doc
// ============================================================
export const FRENCH_TEMPLATES = [
  // FQ1: Criminal & Violence
  `"{NAME}" criminel|meurtre|agression|arrestation|emprisonnement|incarcération|kidnapping|extorsion|viol|terrorisme|extrémisme|mafia|fugitif|homicide|violence|délit|infraction`,

  // FQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" fraude|escroquerie|"blanchiment d'argent"|corruption|"délit d'initié"|faillite|"détournement de fonds"|contrefaçon|chantage|"pot de vin"|soudoyer|banqueroute|contrebande|falsification`,

  // FQ3: Legal, Regulatory & Misconduct
  `"{NAME}" procès|condamnation|sanction|amende|"poursuite judiciaire"|"recours collectif"|"mise en examen"|inculpation|injunction|prohibition|scandale|"faute professionnelle"|"informations privilégiées"|liquidation|litige|verdict|plainte|inconduite`,
];

export const FRENCH_SITE_TEMPLATES = [
  `site:legifrance.gouv.fr OR site:justice.gouv.fr OR site:amf-france.org "{NAME}"`,
];

// ============================================================
// GERMAN (de) — from reference doc
// ============================================================
export const GERMAN_TEMPLATES = [
  // GQ1: Criminal & Violence
  `"{NAME}" Mord|Totschlag|Körperverletzung|Vergewaltigung|Entführung|Kidnapping|Erpressung|Gewalt|Terrorismus|Raubmord|Brandstichting|Geiselnahme|Freiheitsberaubung|Festnahme|Verhaftung|Gefängnis|Verbrechen|Verbrecher|Straftat|Gangster`,

  // GQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" Betrug|Geldwäsche|Korruption|Bestechung|Insiderhandel|Steuerhinterziehung|Unterschlagung|Fälschung|Falschgeld|Bankrott|Insolvenz|Hochstapler|Veruntreuung|Wucher|Schmuggel|Schwarzgeld|Drogenhandel|Rauschgifthandel|Schattenwirtschaft|Zollbetrug`,

  // GQ3: Legal, Regulatory & Misconduct
  `"{NAME}" Strafprozess|Verurteilung|Sanktion|Bußgeld|Anklage|Beschuldigung|Schuldspruch|Kartellverstoß|Amtsmissbrauch|Skandal|Bewährungsstrafe|Strafverfolgung|Disziplinarverfahren|Handelsboykott|Wirtschaftssanktion|Diskqualifikation|Menschenhandel|Sklaverei|Zwangsprostitution|Extremismus`,
];

export const GERMAN_SITE_TEMPLATES = [
  `site:bafin.de OR site:bundesanzeiger.de OR site:justiz.de OR site:bka.de "{NAME}"`,
];

// ============================================================
// ITALIAN (it) — from reference doc
// ============================================================
export const ITALIAN_TEMPLATES = [
  // IQ1: Criminal & Violence
  `"{NAME}" omicidio|aggressione|rapimento|sequestro|arresto|estorsione|stupro|violenza|terrorista|mafia|criminale|detenzione|incriminato|prigione|carcere|bancarotta|contrabbando|corruzione`,

  // IQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" frode|truffa|raggiro|"riciclaggio di denaro"|falsificazione|contraffatto|malversazione|tangente|bustarella|corrotto|evasione|bancarotta|inganno|falsificato|manipolazione|speculazione`,

  // IQ3: Legal, Regulatory & Misconduct
  `"{NAME}" condanna|sanzione|processo|sentenza|indagine|verdetto|scandalo|"cattiva condotta"|reato|infrazione|violazione|interdizione|"causa collettiva"|"class action"|"citare in giudizio"|confisca|liquidazione|sequestro|ricatto|proibito`,
];

export const ITALIAN_SITE_TEMPLATES = [
  `site:giustizia.it OR site:consob.it OR site:bancaditalia.it "{NAME}"`,
];

// ============================================================
// JAPANESE (ja) — from reference doc
// ============================================================
export const JAPANESE_TEMPLATES = [
  // JQ1: Criminal & Violence
  `"{NAME}" 逮捕|殺人|殺害|暴行|傷害|強姦|強制性交|強制わいせつ|誘拐|監禁|虐待|強盗|恐喝|脅迫|暴力団|反社|テロ|テロリスト|テロ行為|人身売買`,

  // JQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" 詐欺|横領|着服|使い込み|背任罪|マネーロンダリング|マネロン|資金洗浄|偽造|模倣|贈収賄|賄賂|腐敗|インサイダー取引|株価操作|株価操縦|脱税|不正|違法|倒産|破産|清算`,

  // JQ3: Legal, Regulatory & Misconduct
  `"{NAME}" 起訴|有罪判決|有罪|罰金|制裁|資産凍結|告訴|提訴|訴訟|裁判|実刑判決|拘束|拘禁|拘留|勾留|スキャンダル|不祥事|仮釈放|執行猶予|集団訴訟|禁止|違反|不履行|更迭|免職|解雇|犯罪`,
];

export const JAPANESE_SITE_TEMPLATES = [
  `site:fsa.go.jp OR site:npa.go.jp OR site:courts.go.jp OR site:moj.go.jp "{NAME}"`,
];

// ============================================================
// MALAY (ms) — from reference doc
// ============================================================
export const MALAY_TEMPLATES = [
  // MQ1: Criminal & Violence
  `"{NAME}" tangkap|serang|bunuh|rogol|culik|rompak|rasuah|tawan|banduan|penjenayah|pengganas|kurung|penjara|dipenjara|ditahan|saman`,

  // MQ2: Fraud & Financial Crime
  `"{NAME}" penipuan|tipu|korup|menyuap|palsu|"penggelapan wang"|"melaburkan wang haram"|seludup|sogok|larseni|curi|mencuri|pencurian|muflis|ugut|peras`,

  // MQ3: Legal & Regulatory
  `"{NAME}" dakwa|tuduh|"salah guna"|"salah laku"|langgar|haram|"tanpa kebenaran"|terlarang|"hilang kelayakan"|"tindakan berkumpulan"|mafia|narkotik|"pembebasan bersyarat"|pelampau|"niaga haram"|"dagang haram"|buru|sekat`,
];

export const MALAY_SITE_TEMPLATES = [
  `site:ssm.com.my OR site:sc.com.my OR site:sprm.gov.my "{NAME}"`,
];

// ============================================================
// POLISH (pl) — from reference doc
// ============================================================
export const POLISH_TEMPLATES = [
  // PQ1: Criminal & Violence
  `"{NAME}" przestępstwo|zbrodnia|morderstwo|napad|porwanie|gwałt|terroryzm|aresztowanie|areszt|zatrzymanie|więzienie|skazanie|wyrok|zabójstwo|przemoc|gangster|mafija`,

  // PQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" oszustwo|defraudacja|pranie|korupcja|skorumpowany|łapówka|fałszerstwo|podrobiony|przemyt|bankructwo|upadłość|malwersacja|wyłudzenie|wymuszenie|narkotyk|narkotyki`,

  // PQ3: Legal & Regulatory
  `"{NAME}" oskarżenie|zarzut|proces|sąd|prokuratura|sankcja|zakaz|mandat|grzywna|kara|skandal|nielegalne|wykroczenie|naruszenie|"zwolnienie warunkowe"|konflikt|skarga|manipulacja|wstyd|hanba`,
];

export const POLISH_SITE_TEMPLATES = [
  `site:knf.gov.pl OR site:gov.pl OR site:prokuratura.gov.pl "{NAME}"`,
];

// ============================================================
// PORTUGUESE (pt) — from reference doc
// ============================================================
export const PORTUGUESE_TEMPLATES = [
  // PTQ1: Criminal & Violence
  `"{NAME}" crime|criminal|assassinato|homicídio|assalto|agressão|sequestro|rapto|estupro|violência|terrorismo|roubo|furto|arrombamento|prisão|cadeia|cárcere|detido|preso|encarcerado`,

  // PTQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" fraude|corrupção|suborno|lavagem|defraudar|falsificação|falso|estelionato|contrabando|extorsão|evasão|fuga|ilegal|ilícito|falência|falido|desfalque|peculato|tráfico|narcótico`,

  // PTQ3: Legal & Regulatory
  `"{NAME}" acusação|condenação|sentença|sanção|multa|punição|julgamento|tribunal|processo|litígio|escândalo|investigação|denúncia|injunção|proibição|"ação de classe"|confisco|liquidação|"mau comportamento"|nefasto`,
];

export const PORTUGUESE_SITE_TEMPLATES = [
  `site:cmvm.pt OR site:tribunais.org.pt OR site:cvm.gov.br OR site:mpf.mp.br "{NAME}"`,
];

// ============================================================
// RUSSIAN (ru) — from reference doc
// ============================================================
export const RUSSIAN_TEMPLATES = [
  // RQ1: Criminal & Violence
  `"{NAME}" убийство|убийца|арест|арестовать|преступление|преступник|насильник|похищение|похитить|терроризм|террорист|бандит|мафия|грабеж|грабитель|тюрьма|заключение|нападение|шантаж|экстремизм`,

  // RQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" мошенник|обман|обмануть|взятка|взяточник|коррупция|отмывание|кража|подделка|подделать|присвоение|присвоить|рэкетир|контрабанда|контрабандист|банкрот|банкротство|санкция|штраф|вымогательство`,

  // RQ3: Legal & Regulatory
  `"{NAME}" осуждение|осудить|"предъявить обвинения"|наказание|дисквалификация|"замораживание активов"|"коллективный иск"|"торговля людьми"|"лишить свободы"|виновный|незаконный|нелегальный|инкриминировать|нарушение|оскорбление|"досрочное освобождение"|скандал|обвинение`,
];

export const RUSSIAN_SITE_TEMPLATES = [
  `site:cbr.ru OR site:courts.gov.ru OR site:genproc.gov.ru "{NAME}"`,
];

// ============================================================
// SPANISH (es) — from reference doc
// ============================================================
export const SPANISH_TEMPLATES = [
  // SQ1: Criminal & Violence
  `"{NAME}" asesinato|homicidio|asalto|secuestro|violación|terrorismo|crimen|criminal|cárcel|prisión|encarcelamiento|arresto|convicto|detenido|arma|violencia|pandilla|mafia|extorsión|rapto`,

  // SQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" fraude|estafa|"blanqueo de dinero"|corrupción|soborno|"congelación de activos"|bancarrota|contrabando|falsificación|evasión|narcotráfico|estupefaciente|"dinero negro"|malversación|desfalco|chantaje|felonía|tráfico`,

  // SQ3: Legal & Regulatory
  `"{NAME}" acusación|condena|sentencia|sanción|multa|juicio|tribunal|juzgado|demanda|litigio|escándalo|investigación|procesado|prohibición|"libertad condicional"|veredicto|imputado|incriminado|insolvencia|liquidación|perjurio`,
];

export const SPANISH_SITE_TEMPLATES = [
  `site:cnmv.es OR site:poderjudicial.es OR site:boe.es "{NAME}"`,
];

// ============================================================
// SWEDISH (sv) — from reference doc
// ============================================================
export const SWEDISH_TEMPLATES = [
  // SVQ1: Criminal & Violence
  `"{NAME}" mord|dråp|misshandel|överfall|kidnappning|våldtäkt|terrorism|brott|brottsling|kriminell|fängelse|fånge|arresterad|gripen|anhållen|vapen|våld|människohandel|människosmuggling`,

  // SVQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" bedrägeri|bedragare|penningtvätt|korrupt|korruption|muta|bestickning|insiderhandel|förskingring|förfalskning|konkurs|bankrutt|smuggling|narkotika|extremism|svindel|skatteflykt|skattebrott`,

  // SVQ3: Legal & Regulatory
  `"{NAME}" åtal|dom|fällande|sanktion|böter|straff|rättegång|domstol|anklagelse|skandal|diskvalificering|förbud|utpressning|grupptalan|"kollektiv talan"|likvider|tvist|manipulation|skam|förseelse`,
];

export const SWEDISH_SITE_TEMPLATES = [
  `site:fi.se OR site:domstol.se OR site:ekobrottsmyndigheten.se "{NAME}"`,
];

// ============================================================
// TURKISH (tr) — from reference doc
// ============================================================
export const TURKISH_TEMPLATES = [
  // TRQ1: Criminal & Violence
  `"{NAME}" cinayet|suç|suçlu|tutuklama|tutuklu|gözaltı|saldırı|tecavüz|kaçırma|"adam kaçırma"|hapis|hapishane|terör|terörist|mafya|şiddet|silahlı|gasp|hırsızlık|soygun`,

  // TRQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" dolandırıcılık|sahtecilik|rüşvet|yolsuzluk|zimmet|"kara para aklama"|iflas|kaçakçılık|narkotik|uyuşturucu|"varlık dondurma"|manipülasyon|vergi kaçırma|sahte|hırsız|çalıntı`,

  // TRQ3: Legal & Regulatory
  `"{NAME}" dava|mahkeme|kovuşturma|yaptırım|ceza|yasaklama|suçlama|skandal|ihlal|"kötüye kullanma"|kabahat|mahkumiyet|"şartlı tahliye"|diskalifiye|"siyasi nüfuz"|taciz|cinsel|rezalet|hüküm|tasfiye`,
];

export const TURKISH_SITE_TEMPLATES = [
  `site:spk.gov.tr OR site:bddk.org.tr OR site:adalet.gov.tr "{NAME}"`,
];

// ============================================================
// KOREAN (ko) — generated from English templates
// ============================================================
export const KOREAN_TEMPLATES = [
  // KQ1: Criminal & Violence
  `"{NAME}" 범죄|살인|강도|폭행|납치|유괴|강간|성폭행|방화|테러|테러리스트|체포|투옥|구금|수감|감옥|징역|폭력|조직폭력|마약|마피아|갱단`,

  // KQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" 사기|횡령|배임|뇌물|부패|위조|변조|자금세탁|내부자거래|주가조작|시세조종|탈세|파산|부도|밀수|마약거래|공갈|갈취|착취|도박`,

  // KQ3: Legal, Regulatory & Misconduct
  `"{NAME}" 기소|유죄|판결|제재|벌금|재판|법원|검찰|소송|고발|고소|스캔들|비위|징계|자격정지|자산동결|집단소송|금지|위반|불법|수배|인신매매|강제노동|아동노동`,
];

export const KOREAN_SITE_TEMPLATES = [
  `site:fss.or.kr OR site:scourt.go.kr OR site:spo.go.kr "{NAME}"`,
];

// ============================================================
// THAI (th) — generated from English templates
// ============================================================
export const THAI_TEMPLATES = [
  // THQ1: Criminal & Violence
  `"{NAME}" อาชญากรรม|ฆาตกรรม|ปล้น|ทำร้ายร่างกาย|ลักพาตัว|ข่มขืน|วางเพลิง|ก่อการร้าย|จับกุม|คุมขัง|จำคุก|ติดคุก|ความรุนแรง|มาเฟีย|แก๊ง|ยาเสพติด|ค้ายา`,

  // THQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" ฉ้อโกง|หลอกลวง|ทุจริต|คอร์รัปชัน|สินบน|ปลอมแปลง|ฟอกเงิน|ยักยอก|เลี่ยงภาษี|ล้มละลาย|ลักลอบ|ค้าของเถื่อน|ปั่นหุ้น|อินไซเดอร์|กรรโชก|ขู่กรรโชก`,

  // THQ3: Legal & Regulatory
  `"{NAME}" ฟ้องร้อง|คดี|ศาล|พิพากษา|ลงโทษ|ปรับ|คว่ำบาตร|อายัดทรัพย์|สอบสวน|เอาผิด|สแกนดัล|ข้อหา|ละเมิด|ผิดกฎหมาย|คุกคาม|ทารุณ|ค้ามนุษย์|แรงงานบังคับ|แรงงานเด็ก`,
];

export const THAI_SITE_TEMPLATES = [
  `site:sec.or.th OR site:bot.or.th OR site:nacc.go.th "{NAME}"`,
];

// ============================================================
// VIETNAMESE (vi) — generated from English templates
// ============================================================
export const VIETNAMESE_TEMPLATES = [
  // VQ1: Criminal & Violence
  `"{NAME}" tội phạm|giết người|cướp|hành hung|bắt cóc|hiếp dâm|đốt phá|khủng bố|bắt giữ|giam giữ|tù|nhà tù|bạo lực|mafia|băng đảng|ma túy|buôn ma túy`,

  // VQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" lừa đảo|gian lận|tham nhũng|hối lộ|giả mạo|rửa tiền|biển thủ|trốn thuế|phá sản|buôn lậu|thao túng|giao dịch nội gián|tống tiền|cưỡng đoạt|đánh bạc`,

  // VQ3: Legal & Regulatory
  `"{NAME}" truy tố|kết án|phạt|xử phạt|trừng phạt|tòa án|xét xử|kiện|khởi kiện|scandal|bê bối|vi phạm|bất hợp pháp|cấm|đình chỉ|buôn người|lao động cưỡng bức|lao động trẻ em|phong tỏa tài sản`,
];

export const VIETNAMESE_SITE_TEMPLATES = [
  `site:ssc.gov.vn OR site:sbv.gov.vn OR site:toaan.gov.vn "{NAME}"`,
];

// ============================================================
// INDONESIAN (id) — generated from English templates
// ============================================================
export const INDONESIAN_TEMPLATES = [
  // IDQ1: Criminal & Violence
  `"{NAME}" kejahatan|pembunuhan|perampokan|penyerangan|penculikan|pemerkosaan|pembakaran|terorisme|teroris|penangkapan|ditangkap|penjara|dipenjara|kekerasan|mafia|narkoba|narkotika|geng`,

  // IDQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" penipuan|korupsi|suap|penyuapan|pemalsuan|pencucian uang|penggelapan|penghindaran pajak|kepailitan|penyelundupan|manipulasi|perdagangan orang dalam|pemerasan|perjudian`,

  // IDQ3: Legal & Regulatory
  `"{NAME}" dakwaan|tuntutan|vonis|sanksi|denda|pengadilan|sidang|gugatan|skandal|pelanggaran|ilegal|larangan|diskualifikasi|pembekuan aset|perdagangan manusia|kerja paksa|pekerja anak|investigasi`,
];

export const INDONESIAN_SITE_TEMPLATES = [
  `site:ojk.go.id OR site:kpk.go.id OR site:mahkamahagung.go.id "{NAME}"`,
];

// ============================================================
// KHMER (km) — generated from English templates
// ============================================================
export const KHMER_TEMPLATES = [
  // KMQ1: Criminal & Violence
  `"{NAME}" ឧក្រិដ្ឋកម្ម|ឃាតកម្ម|ប្លន់|វាយប្រហារ|ចាប់ពន្ធនាគារ|រំលោភ|ភេរវកម្ម|ចាប់ខ្លួន|ឃុំខ្លួន|ពន្ធនាគារ|ជាប់ពន្ធនាគារ|អំពើហិង្សា|មាហ្វា|គ្រឿងញៀន`,

  // KMQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" បោកប្រាស់|ក្លែងបន្លំ|អំពើពុករលួយ|សំណូក|ការលាងប្រាក់|ការប្រេះប្រាស់|គេចពន្ធ|ក្ស័យធន|ដឹកជញ្ជូនខុសច្បាប់|រៀបចំតម្លៃ|ជំរិតទារប្រាក់`,

  // KMQ3: Legal & Regulatory
  `"{NAME}" ចោទប្រកាន់|កាត់ទោស|ផាកពិន័យ|ទណ្ឌកម្ម|តុលាការ|វិនិច្ឆ័យ|បណ្ដឹង|រឿងអាស្រូវ|ការរំលោភ|ខុសច្បាប់|ហាមឃាត់|ការកេងប្រវ័ញ្ច|ពលកម្មបង្ខំ|ពលកម្មកុមារ`,
];

export const KHMER_SITE_TEMPLATES = [
  `site:secc.gov.kh OR site:nbc.org.kh "{NAME}"`,
];

// ============================================================
// BURMESE (my) — generated from English templates
// ============================================================
export const BURMESE_TEMPLATES = [
  // MYQ1: Criminal & Violence
  `"{NAME}" ရာဇဝတ်မှု|လူသတ်|ဓားပြ|တိုက်ခိုက်|ပြည်သူ့ရန်သူ|မုဒိမ်း|အကြမ်းဖက်|ဖမ်းဆီး|ထောင်ချ|ထောင်ဒဏ်|အကျဉ်းထောင်|အကြမ်းဖက်သမား|မူးယစ်ဆေးဝါး`,

  // MYQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" လိမ်လည်|အလိမ်အညာ|လာဘ်စားမှု|အဂတိလိုက်စားမှု|ငွေခဝါချမှု|အတုပြုလုပ်|ခိုးယူ|ချေးငြီးမဆပ်|ဒေဝါလီခံ|မူးယစ်ရောင်းဝယ်|ခြိမ်းခြောက်|ညှစ်စား`,

  // MYQ3: Legal & Regulatory
  `"{NAME}" တရားစွဲ|ပြစ်ဒဏ်|ဒဏ်ရိုက်|ဒဏ်ငွေ|တရားရုံး|စီရင်ချက်|တားမြစ်|ပိတ်ပင်|နာမည်ပျက်|ဥပဒေချိုးဖောက်|တရားမဝင်|လူကုန်ကူး|အတင်းအကျပ်ခိုင်းစေ|ကလေးအလုပ်သမား`,
];

export const BURMESE_SITE_TEMPLATES = [
  `site:cbm.gov.mm OR site:secm.gov.mm "{NAME}"`,
];

// ============================================================
// TAGALOG (tl) — generated from English templates
// ============================================================
export const TAGALOG_TEMPLATES = [
  // TLQ1: Criminal & Violence
  `"{NAME}" krimen|pagpatay|holdap|pananakit|pagdukot|panggagahasa|terorismo|terorista|pag-aresto|naaresto|bilangguan|kulungan|karahasan|mafia|droga|sindikato`,

  // TLQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" pandaraya|panloloko|katiwalian|suhol|lagay|palsipikasyon|money laundering|pagnanakaw|pagkalugi|bangkarota|pagpupuslit|iligal|manipulasyon|pangingikil|pangongotong`,

  // TLQ3: Legal & Regulatory
  `"{NAME}" demanda|kaso|hukuman|multahan|parusa|korte|hatol|paglilitis|iskandalo|paglabag|ipinagbabawal|diskwalipikasyon|trafficking|sapilitang paggawa|child labor|imbestigasyon|pag-usig|paghahabol`,
];

export const TAGALOG_SITE_TEMPLATES = [
  `site:sec.gov.ph OR site:bsp.gov.ph OR site:ombudsman.gov.ph "{NAME}"`,
];

// ============================================================
// LAO (lo) — generated from English templates
// ============================================================
export const LAO_TEMPLATES = [
  // LOQ1: Criminal & Violence
  `"{NAME}" ອາຊະຍາກຳ|ຄາດຕະກຳ|ປຸ້ນ|ທຳຮ້າຍ|ລັກພາຕົວ|ຂົ່ມຂືນ|ກໍ່ການຮ້າຍ|ຈັບກຸມ|ຄຸມຂັງ|ຕິດຄຸກ|ຄວາມຮຸນແຮງ|ຢາເສບຕິດ|ມາເຟຍ`,

  // LOQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" ຫຼອກລວງ|ສໍ້ໂກງ|ທຸດຈະລິດ|ສິນບົນ|ປອມແປງ|ຟອກເງິນ|ຍັກຍອກ|ຫຼີກເວັ້ນພາສີ|ລົ້ມລະລາຍ|ລັກລອບ|ກົດໜ່ວງ|ຂູດຮີດ`,

  // LOQ3: Legal & Regulatory
  `"{NAME}" ຟ້ອງຮ້ອງ|ຕັດສິນ|ລົງໂທດ|ປັບໃໝ|ສານ|ພິພາກສາ|ຄະດີ|ເລື່ອງອື້ສາວ|ລະເມີດ|ຜິດກົດໝາຍ|ຫ້າມ|ຄ້າມະນຸດ|ແຮງງານບັງຄັບ|ແຮງງານເດັກ`,
];

export const LAO_SITE_TEMPLATES = [
  `site:bol.gov.la OR site:lsc.gov.la "{NAME}"`,
];

// ============================================================
// HINDI (hi) — generated from English templates
// ============================================================
export const HINDI_TEMPLATES = [
  // HIQ1: Criminal & Violence
  `"{NAME}" अपराध|हत्या|डकैती|लूट|हमला|अपहरण|बलात्कार|आगजनी|आतंकवाद|आतंकवादी|गिरफ्तार|कैद|जेल|कारावास|हिंसा|माफिया|गिरोह|नशीली दवाएं`,

  // HIQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" धोखाधड़ी|ठगी|भ्रष्टाचार|रिश्वत|जालसाजी|मनी लॉन्ड्रिंग|गबन|कर चोरी|दिवालिया|तस्करी|स्टॉक हेरफेर|इनसाइडर ट्रेडिंग|जबरन वसूली|ब्लैकमेल|जुआ`,

  // HIQ3: Legal & Regulatory
  `"{NAME}" मुकदमा|अभियोग|दोषी|सजा|जुर्माना|प्रतिबंध|अदालत|न्यायालय|फैसला|घोटाला|कांड|उल्लंघन|अवैध|गैरकानूनी|प्रतिबंधित|संपत्ति फ्रीज|मानव तस्करी|बंधुआ मजदूरी|बाल श्रम|जांच`,
];

export const HINDI_SITE_TEMPLATES = [
  `site:sebi.gov.in OR site:rbi.org.in OR site:cbi.gov.in "{NAME}"`,
];

// ============================================================
// TAMIL (ta) — generated from English templates
// ============================================================
export const TAMIL_TEMPLATES = [
  // TAQ1: Criminal & Violence
  `"{NAME}" குற்றம்|கொலை|கொள்ளை|தாக்குதல்|கடத்தல்|பலாத்காரம்|தீவிரவாதம்|தீவிரவாதி|கைது|சிறை|சிறைத்தண்டனை|வன்முறை|மாஃபியா|போதைப்பொருள்`,

  // TAQ2: Fraud, Financial Crime & Corruption
  `"{NAME}" மோசடி|ஊழல்|லஞ்சம்|கள்ளநோட்டு|பணமோசடி|கையாடல்|வரிஏய்ப்பு|திவால்|கடத்தல்|பங்குசந்தை|கறுப்புப்பணம்|மிரட்டி பணம்|சூதாட்டம்`,

  // TAQ3: Legal & Regulatory
  `"{NAME}" வழக்கு|குற்றச்சாட்டு|தண்டனை|அபராதம்|தடை|நீதிமன்றம்|தீர்ப்பு|ஊடறுவல்|சர்ச்சை|மீறல்|சட்டவிரோதம்|தடைசெய்யப்பட்ட|மனிதக்கடத்தல்|கட்டாயத்தொழிலாளர்|குழந்தைத்தொழிலாளர்|விசாரணை`,
];

export const TAMIL_SITE_TEMPLATES = [
  `site:sebi.gov.in OR site:rbi.org.in OR site:nia.gov.in "{NAME}"`,
];
