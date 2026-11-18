/* =============================================================================
 * 00-data-knowledge.js — 内置规则知识库
 *   · 法规条款库（只收录确有原文的条款，条款号不确定的标注「以正式文本为准」）
 *   · 定性红线清单（命中即判重大）
 *   · 根因标签库与匹配规则（用于根因合并）
 *   · 内部制度占位条款（用户可粘贴真实条款替换）
 *   · checklist 判定词库（设计有效性 4 项 + 运行有效性 3 项）
 * 全部为纯数据/纯函数，不含副作用，保证规则引擎输入输出确定。
 * ========================================================================== */
(function (global) {
  'use strict';
  var IC = global.IC;

  /* ==========================================================================
   * 一、法规条款库
   * 说明：label 为条款编号；text 为条文原文（确有原文的条款）；
   *       uncertain=true 表示条款号无法确证，展示为「相关条款（以正式文本为准）」。
   * ====================================================================== */
  IC.KB = {};

  IC.KB.regulations = [
    {
      id: 'REG-EVAL-17',
      law: '《企业内部控制评价指引》',
      label: '第十七条',
      text: '企业应当根据年度内部控制评价结果，结合内部控制评价工作底稿和内部控制缺陷汇总表等资料，编制内部控制评价报告。评价报告应当披露评价范围、评价程序和方法、内部控制缺陷及其认定情况、内部控制缺陷的整改情况及重大缺陷拟采取的整改措施、内部控制有效性的结论等内容。',
      topics: ['评价报告', '缺陷认定', '整改情况', '有效性结论', '总体'],
      uncertain: false
    },
    {
      id: 'REG-EVAL-DEFECT',
      law: '《企业内部控制评价指引》',
      label: '相关条款（以正式文本为准）',
      text: '内部控制缺陷包括设计缺陷和运行缺陷；按影响程度分为重大缺陷、重要缺陷和一般缺陷，并应结合企业规模、业务性质、风险管理要求等因素确定缺陷的认定标准。',
      topics: ['缺陷分类', '设计缺陷', '运行缺陷', '认定标准', '总体'],
      uncertain: true
    },
    {
      id: 'REG-BASIC-3',
      law: '《企业内部控制基本规范》',
      label: '第三条',
      text: '本规范所称内部控制，是由企业董事会、监事会、经理层和全体员工实施的、旨在实现控制目标的过程。内部控制的目标是合理保证企业经营管理合法合规、资产安全、财务报告及相关信息真实完整，提高经营效率和效果，促进企业实现发展战略。',
      topics: ['控制环境', '控制目标', '总体'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-12',
      law: '《企业内部控制基本规范》',
      label: '第十二条',
      text: '董事会负责内部控制的建立健全和有效实施。监事会对董事会建立与实施内部控制进行监督。经理层负责组织领导企业内部控制的日常运行。企业应当成立专门机构或者指定适当的机构具体负责组织协调内部控制的建立实施及日常工作。',
      topics: ['治理结构', '控制环境', '审计委员会', '管理层凌驾', '总体'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-13',
      law: '《企业内部控制基本规范》',
      label: '第十三条',
      text: '企业应当在董事会下设立审计委员会。审计委员会负责审查企业内部控制，监督内部控制的有效实施和内部控制自我评价情况，协调内部控制审计及其他相关事宜等。',
      topics: ['审计委员会', '内部审计', '治理结构', '控制环境'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-14',
      law: '《企业内部控制基本规范》',
      label: '第十四条',
      text: '企业应当结合业务特点和内部控制要求设置内部机构，明确职责权限，将权利与责任落实到各责任单位。企业应当通过编制内部管理手册，使全体员工掌握内部机构设置、岗位职责、业务流程等情况，明确权责分配，正确行使职权。',
      topics: ['权责分配', '组织架构', '控制环境', '职责不清'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-17',
      law: '《企业内部控制基本规范》',
      label: '第十七条',
      text: '企业应当将内部控制应用于内部环境、风险评估、控制活动、信息与沟通、内部监督等要素，并涵盖各项业务和事项。',
      topics: ['控制环境', '风险评估', '控制活动', '内部监督', '总体'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-28',
      law: '《企业内部控制基本规范》',
      label: '第二十八条',
      text: '企业应当结合风险评估结果，通过手工控制与自动控制、预防性控制与发现性控制相结合的方法，运用相应的控制措施，将风险控制在可承受度之内。控制措施一般包括：不相容职务分离控制、授权审批控制、会计系统控制、财产保护控制、预算控制、运营分析控制和绩效考评控制等。',
      topics: ['控制措施', '控制活动', '授权审批', '不相容职务', '财产保护', '系统控制'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-29',
      law: '《企业内部控制基本规范》',
      label: '第二十九条',
      text: '不相容职务分离控制要求企业全面系统地分析、梳理业务流程中所涉及的不相容职务，实施相应的分离措施，形成各司其职、各负其责、相互制约的工作机制。',
      topics: ['不相容职务', '授权审批', '系统控制', '控制活动'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-30',
      law: '《企业内部控制基本规范》',
      label: '第三十条',
      text: '授权审批控制要求企业根据常规授权和特别授权的规定，明确各岗位办理业务和事项的权限范围、审批程序和相应责任。企业应当编制常规授权的权限指引，规范特别授权的范围、权限、程序和责任，严格控制特别授权。',
      topics: ['授权审批', '权限管理', '系统控制', '控制活动'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-25',
      law: '《企业内部控制基本规范》',
      label: '第二十五条',
      text: '企业应当根据设定的控制目标，结合风险应对策略，对业务流程进行梳理、整合和优化，确定关键控制点，编制内部控制流程手册。',
      topics: ['关键控制点', '控制设计', '设计缺陷'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-32',
      law: '《企业内部控制基本规范》',
      label: '第三十二条',
      text: '企业应当建立财产日常管理制度和定期清查制度，采取财产记录、实物保管、定期盘点、账实核对等措施，确保财产安全。',
      topics: ['资产管理', '实物保管', '对账盘点', '财产保护'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-41',
      law: '《企业内部控制基本规范》',
      label: '第四十一条',
      text: '企业应当加强对信息系统开发与维护、访问与变更、数据输入与输出、文件储存与保管、网络安全等方面的控制，保证信息系统安全稳定运行。',
      topics: ['系统控制', '信息安全', '权限管理', '系统缺陷'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-44',
      law: '《企业内部控制基本规范》',
      label: '第四十四条',
      text: '企业应当根据企业内部控制规范体系的要求，结合企业实际，定期对内部控制的有效性进行自我评价，并出具自我评价报告。',
      topics: ['自我评价', '总体'],
      uncertain: false
    },
    {
      id: 'REG-BASIC-ES',
      law: '《企业内部控制基本规范》',
      label: '相关条款（以正式文本为准）',
      text: '经理层对内部控制的实施及内部控制自我评价结果的真实性负责，不得授意、指使、强令、默许会计机构、会计人员及相关人员从事违反法律法规和公司内部制度的行为。',
      topics: ['管理层凌驾', '高层基调', '控制环境', '治理结构'],
      uncertain: true
    },
    {
      id: 'REG-BASIC-FRAUD',
      law: '《企业内部控制基本规范》',
      label: '相关条款（以正式文本为准）',
      text: '企业应当建立健全内部控制的反舞弊机制，坚持惩防并举、注重预防，形成事前防范、事中控制、事后监督与纠正的动态过程和机制。',
      topics: ['舞弊', '内部监督', '控制环境'],
      uncertain: true
    },
    {
      id: 'REG-BASIC-INFO',
      law: '《企业内部控制基本规范》',
      label: '相关条款（以正式文本为准）',
      text: '企业应当建立信息与沟通制度，明确信息收集、处理与传递程序，确保信息在企业内部以及企业与外部之间进行有效沟通。',
      topics: ['信息沟通', '披露', '系统控制'],
      uncertain: true
    },
    {
      id: 'REG-BASIC-MONITOR',
      law: '《企业内部控制基本规范》',
      label: '相关条款（以正式文本为准）',
      text: '企业应当结合内部监督情况，定期对内部控制的有效性进行自我评价，出具自我评价报告；对发现的内部控制缺陷，应当分析缺陷的性质和产生的原因，提出整改方案，采取适当形式及时向董事会、监事会或者经理层报告。',
      topics: ['内部监督', '内部审计', '整改', '缺陷认定'],
      uncertain: true
    }
  ];

  /* ==========================================================================
   * 二、定性红线清单（命中任意一条直接判「重大」，与金额无关）
   * keys：用于在自评表 / 缺陷记录中识别的关键词；neg：需要同时排除的词
   * ====================================================================== */
  IC.KB.redlines = [
    {
      id: 'RL-1',
      name: '不相容职务未分离',
      desc: '授权审批与业务执行、业务执行与监督检查、财产保管与会计记录等不相容职务由同一人（或同一岗位）承担，缺乏相互制约。',
      keys: ['不相容', '兼任', '同一人', '一人经办', '一身兼', '未分离', '集于一身', '既是', '又管', '兼任记账', '兼任出纳'],
      cite: ['REG-BASIC-29', 'REG-BASIC-28']
    },
    {
      id: 'RL-2',
      name: '高管/董事舞弊',
      desc: '董事、监事、高级管理人员或其他员工存在贪污、受贿、挪用、侵占、伪造、串通舞弊，或授意、指使、强令相关人员违反制度。',
      keys: ['舞弊', '挪用', '侵占', '贪污', '受贿', '造假', '伪造', '串通', '授意', '指使', '强令'],
      cite: ['REG-BASIC-ES', 'REG-BASIC-FRAUD', 'REG-BASIC-12']
    },
    {
      id: 'RL-3',
      name: '管理层凌驾于控制之上',
      desc: '管理层超越授权审批权限、绕过既定控制程序，或对内部控制采取凌驾、变通、规避态度。',
      keys: ['凌驾', '越过', '超越权限', '绕过', '绕开', '特批', '打招呼', '个人决定', '一言堂'],
      cite: ['REG-BASIC-12', 'REG-BASIC-ES', 'REG-BASIC-30']
    },
    {
      id: 'RL-4',
      name: '审计委员会或内审机构失效',
      desc: '审计委员会、内部审计机构未按制度运行（未履职、形同虚设、被架空、人员不足），内部监督职能无法发挥。',
      keys: ['审计委员会', '内审', '内部审计', '内部监督', '监事会'],
      require: ['未', '失效', '形同虚设', '空转', '架空', '不作为', '未履职', '停止', '缺失', '不足', '无'],
      cite: ['REG-BASIC-13', 'REG-BASIC-MONITOR', 'REG-BASIC-12']
    },
    {
      id: 'RL-5',
      name: '财务报告被出具非标内控审计意见',
      desc: '外部审计机构对内部控制有效性出具否定意见、无法表示意见，或因内控缺陷导致财务报表被出具非无保留意见。',
      keys: ['否定意见', '无法表示意见', '非标', '保留意见', '内控审计意见'],
      cite: ['REG-EVAL-DEFECT', 'REG-BASIC-3']
    },
    {
      id: 'RL-6',
      name: '重大信息未披露',
      desc: '重大交易、重大风险、重大缺陷等应披露信息未按规定披露，或披露内容存在虚假记载、重大遗漏。',
      keys: ['未披', '未公告', '瞒报', '隐瞒', '迟报', '漏披露', '虚假记载'],
      cite: ['REG-BASIC-INFO', 'REG-EVAL-17']
    },
    {
      id: 'RL-7',
      name: '已造成实际损失且无法追回',
      desc: '缺陷已造成资产损失、资金流失、赔偿或处罚，且损失无法追回或挽回。',
      keys: ['无法追回', '无法挽回', '已造成损失', '资金流失', '被骗', '坏账损失', '罚款', '处罚决定', '赔偿'],
      cite: ['REG-BASIC-32', 'REG-BASIC-17']
    },
    {
      id: 'RL-8',
      name: '同一缺陷连续两年未整改',
      desc: '上年度内控评价或内控审计已指出的同一缺陷，本年度仍未整改到位，整改闭环失效。',
      keys: ['连续两年', '连续2年', '历年未整改', '上年度未整改', '屡查屡犯', '重复发生未整改', '两年未整改'],
      cite: ['REG-EVAL-17', 'REG-BASIC-MONITOR']
    }
  ];

  /* ==========================================================================
   * 三、根因标签库（根因合并：根因标签 + 责任部门 + 流程）
   * detect：在控制点名称/自评内容中匹配的关键词（用于规则归因，保证口径统一）
   * ====================================================================== */
  IC.KB.rootCauses = [
    {
      code: 'RC01',
      tag: '制度与流程缺失',
      desc: '缺少制度规定或业务流程未覆盖关键控制环节，控制要求无据可依。',
      detect: ['无制度', '未建立', '没有制度', '制度缺失', '无流程', '未规定', '无规定', '无标准', '未定义', '无权限表', '权限表缺失', '无台账'],
      advice: '修订/建立相应管理制度与业务流程，明确控制目标、关键控制点、责任人、控制频率与留痕要求，并组织宣贯培训。'
    },
    {
      code: 'RC02',
      tag: '岗位职责不清与不相容职务未分离',
      desc: '岗位职责边界不清，或不相容职务由同一人承担，缺乏相互制衡。',
      detect: ['不相容', '兼任', '职责不清', '一人', '既是', '岗位不明', '分工不明', '未分离', '同一人', '兼管'],
      advice: '重新梳理岗位职责与授权体系，落实不相容职务分离，必要时调整岗组或由上级代行复核；对已发生事项开展专项核查。'
    },
    {
      code: 'RC03',
      tag: '授权审批流于形式',
      desc: '授权审批权限不明或未按要求履行审批程序，存在先执行后审批、越权审批、代签补签。',
      detect: ['先付后批', '先支后批', '未审批', '审批流于形式', '越权', '超权限', '补签', '代签', '未经审批', '先执行'],
      advice: '在系统中固化审批权限矩阵与前置校验规则（未审批不得进入下一环节），并建立月度抽查复核机制。'
    },
    {
      code: 'RC04',
      tag: '系统权限与控制未设硬性约束',
      desc: '信息系统权限未按岗设置、未定期复核，关键控制点缺少系统校验等硬控制。',
      detect: ['权限', '未复核', '系统', '账号', '授权清单', '后门', '未设控制', '系统控制', '未校验', '越权取数'],
      advice: '按最小必要原则配置系统权限，建立季度权限复核与人员异动自动回收机制，关键控制点增加系统强制校验。'
    },
    {
      code: 'RC05',
      tag: '复核校验缺失或流于形式',
      desc: '复核、稽核、对账等检查性控制未执行或仅形式签字，未能发现并纠正偏差。',
      detect: ['未复核', '复核流于形式', '未对账', '未抽查', '只签字', '形式', '未核对', '未稽核', '未审核'],
      advice: '明确复核要素与责任痕迹（复核记录留档），对复核质量开展二次抽查，复核失职纳入考核。'
    },
    {
      code: 'RC06',
      tag: '执行偏差与整改不到位',
      desc: '已识别的偏差未在规定期限整改到位，或整改措施未形成闭环。',
      detect: ['未整改', '整改不到位', '逾期', '屡查', '重复发生', '尚未整改', '整改中', '未闭环'],
      advice: '建立缺陷整改台账，明确责任人、整改措施与完成时限，按月度跟踪并验收闭环。'
    },
    {
      code: 'RC07',
      tag: '职责与流程执行不到位',
      desc: '制度与流程已建立，但日常执行走样，操作与规程不一致。',
      detect: ['执行不到位', '未执行', '未按', '不按', '漏做', '未落实', '执行率'],
      advice: '强化岗位操作培训与执行情况考核，将控制执行情况纳入部门月度绩效考核。'
    },
    {
      code: 'RC08',
      tag: '记录留痕与证据缺失',
      desc: '控制执行未留存可核查痕迹（审批单、复核记录、系统日志），无法验证控制是否执行。',
      detect: ['无留痕', '无痕迹', '未留档', '无记录', '证据缺失', '无归档', '没有记录'],
      advice: '统一留痕要求与归档规范，关键控制点由系统自动生成操作日志，杜绝事后补记。'
    },
    {
      code: 'RC09',
      tag: '人员能力与意识不足',
      desc: '岗位人员专业能力或内控意识不足，导致控制执行偏差。',
      detect: ['能力不足', '意识淡薄', '未培训', '培训不足', '不熟悉', '人员不足', '经验不足'],
      advice: '补充岗位人员并开展针对性培训与考核，关键岗位实行持证/轮岗管理。'
    }
  ];

  /* ==========================================================================
   * 四、内部制度占位条款（用户可在「内部制度补充」中粘贴真实条款替换）
   * 说明：未内嵌集团正式文本，条款号仅作占位，引用时标注「以集团正式文本为准，请核对」。
   * ====================================================================== */
  IC.KB.internalPolicies = [
    { id: 'IP-1', name: '集团《内部控制管理办法》', clause: '第 X 条', text: '不相容职务应当分离，授权审批与业务执行、业务执行与监督检查不得由同一人承担。', topics: ['不相容职务', '职责不清', 'RC02'] },
    { id: 'IP-2', name: '集团《资金支付审批规定》', clause: '第 X 条', text: '所有付款必须履行审批程序后办理，不得先支付后补办审批手续。', topics: ['授权审批', '先付后批', 'RC03', '资金'] },
    { id: 'IP-3', name: '集团《岗位职责与授权管理办法》', clause: '第 X 条', text: '各岗位应明确职责权限，超出授权范围的事项应报上级审批，不得越权办理。', topics: ['权责分配', '越权', 'RC01'] },
    { id: 'IP-4', name: '集团《信息系统权限管理规定》', clause: '第 X 条', text: '信息系统用户权限应按岗位设置并至少每季度复核一次，离岗人员权限应及时收回。', topics: ['系统权限', 'RC04'] },
    { id: 'IP-5', name: '集团《内部控制评价管理办法》', clause: '第 X 条', text: '每年至少开展一次内部控制自我评价，评价发现的缺陷应认定等级、明确整改责任与时限。', topics: ['自我评价', '缺陷认定', '总体'] },
    { id: 'IP-6', name: '集团《资产管理规定》', clause: '第 X 条', text: '存货、固定资产应定期盘点，账实差异应及时查明原因并报批处理。', topics: ['资产管理', '盘点', '存货'] },
    { id: 'IP-7', name: '集团《费用报销管理办法》', clause: '第 X 条', text: '费用报销须附合法合规原始凭证并经部门负责人与财务复核后方可支付。', topics: ['费用', '报销', 'RC05'] },
    { id: 'IP-8', name: '集团《内部审计工作规定》', clause: '第 X 条', text: '内部审计机构独立履行监督职责，每年对内控执行情况实施审计并跟踪整改。', topics: ['内部审计', '内部监督', '整改'] }
  ];

  /* ==========================================================================
   * 五、checklist 判定词库
   * ====================================================================== */

  /** 设计有效性 4 项检查（命中任一关键词即视为该检查项通过） */
  IC.KB.designChecks = [
    {
      key: 'measure',
      name: '有明确控制措施',
      hit: ['审批', '核准', '复核', '审核', '核对', '对账', '盘点', '分离', '权限', '授权', '校验', '双人', '轮岗',
        '比价', '招标', '投标', '合同', '台账', '分级', '评审', '验收', '抽查', '检查', '分析', '考核',
        '评价', '评估', '测评', '计提', '核销', '归集', '报批', '备案', '控制', '退回', '索赔', '调拨', '签收',
        '预算', '审批流', '审批权限', '事前审批', '监测', '监控', '预警', '巡视', '审计', '测试',
        '备份', '演练', '密码', '复杂度', '定期更换', '停用', '实名', '登录', '加密', '维护', '保养', '监视'],
      hint: '控制点名称/控制描述中包含明确的控制动作（审批、复核、对账、分离、权限等）'
    },
    {
      key: 'owner',
      name: '有责任人和频率',
      hit: ['责任人', '由', '负责', '部门', '岗', '每月', '每季', '每季度', '每周', '每日', '每年', '每笔', '按笔',
        '定期', '逐笔', '按月', '按季', '按年', '按期', '专人', '经办', '主管', '经理', '负责人', '出纳', '仓管'],
      hint: '控制措施明确了执行责任人、责任岗位或控制频率'
    },
    {
      key: 'coverage',
      name: '覆盖关键风险点',
      hit: ['覆盖', '全部', '所有', '关键', '逐笔', '逐户', '逐级', '逐项', '逐人', '每笔', '每期', '全流程', '全方位', '事前', '事中', '全量', '全员',
        '均需', '一律', '必须', '须', '不得', '禁止', '应', '需', '不低于', '至少', '按', '分级', '双人',
        '分人', '分离', '到岗', '到人'],
      hint: '控制措施覆盖了该流程的关键风险点，未留控制真空'
    },
    {
      key: 'trace',
      name: '留有可核查痕迹',
      hit: ['留痕', '痕迹', '审批单', '记录', '日志', '凭证', '签批', '签章', '签字', '签名', '归档', '留档',
        '留存', '单据', '底稿', '台账', '系统记录', '登记', '回执', '报告', '会议纪要', '备查', '双签', '清单'],
      hint: '控制执行留有可核查的书面或系统痕迹'
    }
  ];

  /** 运行有效性 3 项检查 */
  IC.KB.operatingChecks = [
    {
      key: 'ontime',
      name: '按期执行',
      hit: ['按期', '按时', '按频率', '按期执行', '已执行', '已开展', '已实施', '执行率', '均按', '全部按'],
      neg: ['未按期', '未按时', '未执行', '逾期', '未开展', '未按'],
      hint: '自评表显示控制按设定频率执行'
    },
    {
      key: 'evidence',
      name: '有执行证据',
      hit: ['审批单', '复核记录', '对账单', '盘点表', '系统日志', '签批', '归档', '留痕', '留档', '凭证', '台账', '截图', '底稿', '清单', '报告'],
      neg: ['无证据', '没有证据', '未留', '缺失', '无留痕', '无记录', '无归档', '未附'],
      hint: '自评表提供了可验证的执行证据说明'
    },
    {
      key: 'deviation',
      name: '偏差未出现或已整改',
      hit: ['无偏差', '无异常', '已整改', '整改完成', '已闭环', '未见异常', '已纠正', '均已整改'],
      hint: '未发现偏差，或发现的偏差已完成整改闭环'
    }
  ];

  /** 自评结论词 */
  IC.KB.selfEvalWords = {
    valid: ['有效', '已执行', '合规', '无偏差', '正常', '符合'],
    invalid: ['无效', '失效', '未执行', '偏差', '不符合', '存在缺陷', '未落实'],
    insufficient: ['证据不足', '无法判定', '待补', '未提供', '待补材料', '资料不全']
  };

  /**
   * 法规检索：按缺陷定性/根因/流程关键词匹配条款
   * 返回按命中权重排序的条款引用（取前 n 条）
   */
  IC.KB.findRegulations = function (text, opts) {
    var o = opts || {};
    var n = o.limit || 3;
    var t = String(text || '');
    var scored = [];
    IC.KB.regulations.forEach(function (r) {
      var s = 0;
      r.topics.forEach(function (tp) {
        if (tp === '总体') return;
        if (t.indexOf(tp) >= 0) s += 2;
      });
      if (r.uncertain) s -= 0.5; // 条款号不确定的降权
      if (s > 0) scored.push({ reg: r, score: s });
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.reg.id.localeCompare(b.reg.id);
    });
    var out = scored.slice(0, n).map(function (x) { return x.reg; });
    if (!out.length) out = [IC.KB.regulations[0]];
    return out;
  };

  IC.KB.getReg = function (id) {
    for (var i = 0; i < IC.KB.regulations.length; i++) {
      if (IC.KB.regulations[i].id === id) return IC.KB.regulations[i];
    }
    return null;
  };

  /** 条款引用文本（带不确定标注） */
  IC.KB.cite = function (reg) {
    if (!reg) return '';
    var body = reg.text;
    if (body.length > 78) body = body.slice(0, 78) + '…';
    return reg.law + ' ' + reg.label + '：' + body;
  };

  /** 定性红线识别：返回命中的红线对象数组（按版本固定顺序） */
  IC.KB.matchRedlines = function (text) {
    var t = String(text || '');
    var out = [];
    IC.KB.redlines.forEach(function (rl) {
      var hit = U_hasAny(t, rl.keys);
      if (!hit && rl.hitAll) {
        hit = rl.hitAll.length > 0 && rl.hitAll.every(function (k) { return t.indexOf(k) >= 0; });
      }
      if (hit) {
        if (rl.require && !U_hasAny(t, rl.require)) return;
        out.push(rl);
      }
    });
    return out;

    function U_hasAny(s, arr) {
      for (var i = 0; i < arr.length; i++) { if (s.indexOf(arr[i]) >= 0) return arr[i]; }
      return '';
    }
  };

  /** 根据文本识别根因标签（返回 rootCauses 数组，可能多个或空） */
  IC.KB.matchRootCauses = function (text) {
    var t = String(text || '');
    var hits = [];
    IC.KB.rootCauses.forEach(function (rc) {
      var n = 0;
      rc.detect.forEach(function (k) { if (t.indexOf(k) >= 0) n++; });
      if (n > 0) hits.push({ rc: rc, n: n });
    });
    hits.sort(function (a, b) {
      if (b.n !== a.n) return b.n - a.n;
      return a.rc.code.localeCompare(b.rc.code);
    });
    return hits;
  };

  /**
   * 归因（口径固定、可复现）：
   *   ① 缺陷证据（自评证据 + 偏差情况 + 缺陷描述）命中根因关键词 → 取命中最多者；
   *   ② 否则按控制点名称/流程做主题归类（如「信息系统权限管理」→ 系统权限类）；
   *   ③ 仍无法归类 → 兜底「职责与流程执行不到位」（RC07）。
   *   注意：不把「控制描述（应然状态）」纳入归因，避免制度里写得好好的控制点被归成「制度缺失」。
   */
  IC.KB.classifyRootCause = function (evidenceText, topicText, hint) {
    var hits = IC.KB.matchRootCauses(evidenceText);
    if (hits.length) {
      var top = hits[0];
      var code = top.rc.code;
      // ① 显式标识类红线（不相容职务 / 舞弊 / 凌驾）优先于「执行偏差」等通用归因
      if (top.n >= 2) {
        var n = function (cd) {
          for (var i = 0; i < hits.length; i++) { if (hits[i].rc.code === cd) return hits[i].n; }
          return 0;
        };
        if (n('RC02') >= 2) code = 'RC02';
        else if (n('RC02') > 0 && (n('RC03') + n('RC05') + n('RC04') + n('RC06') + n('RC07') + n('RC01') + n('RC08')) === 0) code = 'RC02';
      }
      // ② 缺陷记录表显式给出的根因标签（如「授权审批流于形式」）优先于从自由文本推断的归因，
      //    保证用户登记的口径不被通用词（如「尚未整改」）覆盖
      if (hint) {
        var ht = String(hint);
        for (var i = 0; i < IC.KB.rootCauses.length; i++) {
          var rc = IC.KB.rootCauses[i];
          if (rc.code === ht || rc.tag === ht || (ht && rc.tag.indexOf(ht) >= 0)) return rc;
        }
      }
      return IC.KB.getRootCause(code);
    }
    if (hint) {
      var ht2 = String(hint);
      for (var j = 0; j < IC.KB.rootCauses.length; j++) {
        var rc2 = IC.KB.rootCauses[j];
        if (rc2.code === ht2 || rc2.tag === ht2 || (ht2 && rc2.tag.indexOf(ht2) >= 0)) return rc2;
      }
    }
    var t = String(topicText || '');
    var order = ['RC04', 'RC02', 'RC03', 'RC05', 'RC08', 'RC06', 'RC01'];
    for (var k = 0; k < order.length; k++) {
      var rk = IC.KB.getRootCause(order[k]);
      for (var m = 0; m < rk.detect.length; m++) {
        if (t.indexOf(rk.detect[m]) >= 0) return rk;
      }
    }
    return IC.KB.rootCauses[6]; // RC07 职责与流程执行不到位
  };

  /** 取一个根因标签（优先最高命中；都没有则归入「职责与流程执行不到位」） */
  IC.KB.primaryRootCause = function (text) {
    var hits = IC.KB.matchRootCauses(text);
    if (hits.length) return hits[0].rc;
    return IC.KB.rootCauses[6]; // RC07 职责与流程执行不到位（通用兜底，规则固定）
  };

  IC.KB.getRootCause = function (code) {
    for (var i = 0; i < IC.KB.rootCauses.length; i++) {
      if (IC.KB.rootCauses[i].code === code) return IC.KB.rootCauses[i];
    }
    return IC.KB.rootCauses[6];
  };

  /** 内部制度条款检索（按 topics 命中数排序，取前 n） */
  IC.KB.findInternal = function (text, policies, limit) {
    var t = String(text || '');
    var list = policies || IC.KB.internalPolicies;
    var scored = [];
    list.forEach(function (p) {
      var s = 0;
      (p.topics || []).forEach(function (tp) { if (tp && t.indexOf(tp) >= 0) s += 2; });
      if (t.indexOf(p.name.replace(/《|》/g, '')) >= 0) s += 5;
      if (s > 0) scored.push({ p: p, s: s });
    });
    scored.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return String(a.p.id).localeCompare(String(b.p.id));
    });
    var out = scored.slice(0, limit || 2).map(function (x) { return x.p; });
    if (!out.length) out = [list[0]];
    return out;
  };

  /**
   * 解析用户粘贴的内部条款（每行：名称|条款号|条文），返回制度数组
   * 支持竖线、制表符、多个空格分隔
   */
  IC.KB.parseInternal = function (raw) {
    if (!raw || !String(raw).trim()) return [];
    var lines = String(raw).replace(/\r/g, '').split('\n');
    var out = [];
    lines.forEach(function (line, idx) {
      var s = String(line).replace(/\u00a0/g, ' ').trim();
      if (!s) return;
      var parts = s.split(/\s*[|｜\t]\s*/);
      if (parts.length < 2) parts = s.split(/\s{2,}/);
      var name = (parts[0] || '').trim();
      var clause = (parts[1] || '相关条款').trim();
      var text = (parts.slice(2).join(' ') || parts[1] || '').trim();
      if (parts.length === 2) { clause = '相关条款'; text = parts[1].trim(); }
      if (!name) return;
      out.push({
        id: 'IPC-' + (idx + 1),
        name: /《/.test(name) ? name : '《' + name + '》',
        clause: /条|款|项/.test(clause) ? clause : '第 ' + clause + ' 条',
        text: text,
        topics: [],
        fromUser: true
      });
    });
    return out;
  };

})(typeof window !== 'undefined' ? window : this);
