// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/invoices.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "add": {
    "allOn": "所有标准区块都已添加到这张发票上。",
    "custom": "自己搭建",
    "standard": "标准区块",
    "subtitle": "自己搭建，或启用某个标准区块。",
    "title": "添加区块"
  },
  "canvas": {
    "addSection": "添加区块",
    "approval": {
      "approved": "已批准",
      "pending": "待审批",
      "rejected": "已驳回",
      "title": "审批"
    },
    "attachments": "附件",
    "blocks": {
      "parties": "开票方与收票方",
      "paynotes": "付款与备注"
    },
    "brandName": "品牌名称",
    "brandingHint": "品牌信息 · 点击可编辑",
    "contact": "有疑问？请联系我们",
    "custom": {
      "addRow": "添加行",
      "body": "区块正文",
      "caption": "图注",
      "clearImage": "移除图片",
      "clearSlot": "移除",
      "clearSlotOf": "移除图片 {n}",
      "remove": "移除区块",
      "removeOf": "移除区块：{title}",
      "removeRow": "移除行",
      "removeRowOf": "移除第 {n} 行",
      "rowLabel": "第 {n} 行的标签",
      "rowValue": "第 {n} 行的值",
      "titleLabel": "区块标题",
      "upload": "点击上传图片",
      "uploadSlot": "上传图片 {n}"
    },
    "customerName": "客户名称",
    "dateSigned": "签署日期",
    "delivery": {
      "title": "配送进度"
    },
    "discount": {
      "title": "折扣码"
    },
    "due": "到期日",
    "from": "开票方",
    "insertAbove": "在{label}上方添加区块",
    "insertHere": "在此处添加区块",
    "invoiceTo": "收票方",
    "issued": "开具日期",
    "items": {
      "add": "添加明细项",
      "amount": "金额",
      "description": "描述",
      "descriptionOf": "第 {n} 行的描述",
      "qty": "数量",
      "qtyOf": "第 {n} 行的数量",
      "rate": "单价",
      "rateOf": "第 {n} 行的单价",
      "remove": "移除明细项：{name}",
      "reorder": "拖动可排序",
      "reorderOf": "拖动可排序：{name}",
      "row": "明细项 {n}"
    },
    "latefees": {
      "sentence": "逾期超过到期日 {days} 天仍未付清的款项，将按每月 {rate}% 收取滞纳金。",
      "title": "逾期滞纳金"
    },
    "legal": "法律条款",
    "lines": {
      "customer": "客户信息第 {n} 行",
      "from": "开票方第 {n} 行",
      "payment": "付款信息第 {n} 行",
      "ship": "收货信息第 {n} 行"
    },
    "loyalty": {
      "balance": "{balance} 分 · {level}",
      "title": "积分余额"
    },
    "multicurrency": {
      "note": "按参考汇率自 {total} 换算。",
      "title": "也可用以下货币支付"
    },
    "notes": "备注",
    "payhistory": {
      "title": "付款记录"
    },
    "payment": "付款",
    "poNumber": "采购订单号",
    "poTerms": "采购订单条款",
    "qr": {
      "due": "应付金额 · {total}",
      "title": "扫码付款"
    },
    "recurring": {
      "next": "下次：{next} · {count}",
      "title": "周期性 — {freq}"
    },
    "refund": "退款政策",
    "reorderSection": "拖动可调整区块顺序",
    "reorderSectionOf": "拖动可调整区块顺序：{label}",
    "select": "编辑{label}",
    "shipName": "收货人名称",
    "shipTo": "收货方",
    "sigName": "签署人姓名",
    "sigTitle": "签署人职务",
    "signature": "签名",
    "taxbreak": {
      "title": "税费明细"
    },
    "terms": "条款",
    "termsAccepted": "已接受条款",
    "termsLabel": "条款标签",
    "totals": {
      "discount": "折扣（{rate}）",
      "subtotal": "小计",
      "tax": "税额（{rate}）",
      "total": "总计"
    }
  },
  "card": {
    "delete": "删除",
    "duplicate": "复制",
    "edit": "编辑",
    "rename": "重命名",
    "renameLabel": "新名称",
    "total": "总计"
  },
  "custom": {
    "gallery": {
      "hint": "两到三张图片并排显示",
      "label": "图片行"
    },
    "image": {
      "hint": "上传照片、图纸或证书",
      "label": "图片区块"
    },
    "kv": {
      "hint": "标签与值成对显示",
      "label": "信息行"
    },
    "text": {
      "hint": "你自己的文字——备注、范围或条件",
      "label": "文本区块"
    }
  },
  "delete": {
    "body": {
      "invoice": "此操作无法撤销。该发票将被永久移除。",
      "template": "此操作无法撤销。该模板将被永久移除。"
    },
    "confirm": "删除",
    "title": "删除 {name}？"
  },
  "editor": {
    "delete": "删除",
    "discard": {
      "body": "你对 {name} 的修改将会丢失。",
      "confirm": "放弃",
      "keep": "继续编辑",
      "title": "放弃未保存的更改？"
    },
    "duplicate": "复制",
    "images": "图片",
    "kind": {
      "invoice": "发票",
      "template": "模板"
    },
    "loadFailed": "无法加载该文档",
    "nameLabel": "名称",
    "redo": "重做",
    "saveFailed": "保存失败",
    "saveInvoice": "保存发票",
    "saveState": {
      "dirty": "有未保存的更改",
      "error": "保存失败",
      "saved": "所有更改已保存",
      "saving": "保存中…"
    },
    "saveTemplate": "保存模板",
    "sendInvoice": "发送发票",
    "shortcutSave": "保存文档",
    "undo": "撤销"
  },
  "empty": {
    "invoices": {
      "body": "从模板或空白画布开始，创建你的第一张发票。",
      "title": "还没有发票"
    },
    "noMatch": {
      "body": "换个搜索词试试。",
      "invoices": "没有匹配的发票",
      "templates": "没有匹配的模板"
    },
    "templates": {
      "body": "创建一个可复用的发票模板，供团队在此基础上制作。",
      "title": "还没有模板"
    }
  },
  "inspector": {
    "addLine": "添加行",
    "approval": {
      "name": "审批人姓名",
      "status": {
        "approved": "已批准",
        "pending": "待审批",
        "rejected": "已驳回"
      },
      "statusLabel": "状态",
      "title": "角色 / 职务"
    },
    "attachments": {
      "add": "添加文件",
      "files": "文件",
      "name": "第 {n} 个文件的名称",
      "removeRow": "移除第 {n} 个文件",
      "seedName": "新文件.pdf",
      "size": "第 {n} 个文件的大小"
    },
    "branding": {
      "accentHintAfter": "区块下修改强调色。",
      "accentHintBefore": "可在",
      "accentHintBold": "标题",
      "brandName": "品牌名称",
      "logoImage": "标志图片",
      "logoMark": "标志图形",
      "logoNoteAfter": "中。",
      "logoNoteBefore": "上传标志后会替换上方的图形。所有固定图片都在工具栏的",
      "logoNoteBold": "图片",
      "removeLogo": "移除",
      "uploadLogo": "上传标志"
    },
    "contact": {
      "email": "邮箱",
      "name": "联系人姓名",
      "phone": "电话"
    },
    "custom": {
      "addRow": "添加行",
      "body": "正文",
      "caption": "图注",
      "galleryHint": "在发票上点击各个位置即可上传图片。",
      "height": "高度",
      "image": "图片",
      "remove": "移除区块",
      "title": "区块标题",
      "upload": "上传 / 替换"
    },
    "customer": {
      "addressContact": "地址与联系方式",
      "clientName": "客户名称"
    },
    "delivery": {
      "add": "添加步骤",
      "cycle": "步骤 {n} 状态：{status}",
      "label": "步骤 {n}",
      "note": "点击状态可在“待处理 → 进行中 → 已完成”之间切换。",
      "removeRow": "移除步骤 {n}",
      "seedLabel": "新步骤",
      "status": {
        "current": "进行中",
        "done": "已完成",
        "todo": "待处理"
      },
      "steps": "步骤"
    },
    "discount": {
      "add": "添加优惠码",
      "amount": "优惠码 {n} 的金额",
      "code": "优惠码 {n}",
      "codePlaceholder": "CODE",
      "codes": "折扣码",
      "label": "优惠码 {n} 的说明",
      "labelPlaceholder": "说明",
      "removeRow": "移除优惠码 {n}",
      "seedLabel": "新折扣"
    },
    "fallback": {
      "title": "编辑"
    },
    "from": {
      "companyDetails": "公司信息"
    },
    "images": {
      "addSection": "添加图片区块",
      "background": "背景",
      "backgroundHint": "衬在发票背后的水印",
      "intro": "随发票一同保存的固定图片。上传一次，基于该模板创建的每个文档都会保留它们。",
      "logo": "标志",
      "logoHint": "会替换标志图形",
      "qr": "二维码",
      "qrHint": "显示在扫码付款区块中",
      "remove": "移除",
      "replace": "替换",
      "signature": "签名",
      "signatureHint": "扫描的签名图片",
      "stamp": "印戳 / 印章",
      "stampHint": "“已付款”或审批印章",
      "upload": "上传",
      "uploadSlot": "上传{label}"
    },
    "items": {
      "add": "添加明细项",
      "count": "明细项",
      "hint": "可直接在发票上编辑任意单元格，或拖动手柄调整顺序。",
      "subtotal": "小计"
    },
    "latefees": {
      "grace": "宽限期",
      "graceUnit": "天",
      "rate": "滞纳金费率",
      "rateUnit": "%/月"
    },
    "legal": {
      "footer": "法律页脚"
    },
    "line": "{label} {n}",
    "loyalty": {
      "balance": "积分余额",
      "earned": "已获积分",
      "level": "等级"
    },
    "meta": {
      "due": "到期日",
      "issued": "开具日期",
      "number": "发票编号",
      "poNumber": "采购订单号",
      "terms": "付款条件"
    },
    "multicurrency": {
      "add": "添加货币",
      "code": "货币 {n} 的代码",
      "note": "汇率会与发票总计相乘。依次填写代码、符号和汇率。",
      "rate": "货币 {n} 的汇率",
      "rates": "货币与汇率",
      "removeRow": "移除货币 {n}",
      "symbol": "货币 {n} 的符号"
    },
    "notes": {
      "footerNotes": "页脚备注",
      "hint": "显示在发票底部——条款、致谢语或法律文本。"
    },
    "payhistory": {
      "add": "添加付款",
      "amount": "第 {n} 笔付款的金额",
      "amountPlaceholder": "金额",
      "date": "第 {n} 笔付款的日期",
      "datePlaceholder": "日期",
      "method": "第 {n} 笔付款的方式",
      "methodPlaceholder": "方式",
      "payments": "付款",
      "removeRow": "移除第 {n} 笔付款"
    },
    "payment": {
      "instructions": "付款说明"
    },
    "poterms": {
      "terms": "采购订单条款"
    },
    "qr": {
      "caption": "图注",
      "hint": "编码内容为“应付金额 · {total}”。显示的二维码就是你在“图片”中上传的那张图。"
    },
    "recurring": {
      "annually": "每年",
      "frequency": "频率",
      "monthly": "每月",
      "next": "下次开具日期",
      "note": "周期说明",
      "quarterly": "每季度",
      "weekly": "每周"
    },
    "refund": {
      "policy": "退款政策"
    },
    "removeLine": "移除{label} {n}",
    "removeSection": "移除区块",
    "shipto": {
      "addressLines": "地址行",
      "name": "收货人名称"
    },
    "signature": {
      "hint": "发票上会显示签名栏和日期栏，供手写签署。",
      "name": "签署人姓名",
      "title": "职务 / 角色"
    },
    "tax": {
      "discount": "折扣",
      "discountRow": "折扣",
      "subtotal": "小计",
      "tax": "税额",
      "taxRate": "税率",
      "total": "总计"
    },
    "taxbreak": {
      "add": "添加税费行",
      "components": "税费项",
      "label": "税费行 {n} 的标签",
      "note": "每个税率都按扣除折扣后的小计计算。",
      "rate": "税费行 {n} 的税率",
      "removeRow": "移除税费行 {n}",
      "seedLabel": "新税费"
    },
    "terms": {
      "checkboxLabel": "复选框标签",
      "preChecked": "默认勾选",
      "preCheckedHint": "显示时该复选框已勾选"
    },
    "theme": {
      "accentColour": "强调色",
      "backgroundHint": "在整张发票背后添加满版背景——很适合信头或水印。",
      "backgroundImage": "背景图片",
      "currency": "货币",
      "documentTitle": "文档标题",
      "language": "语言",
      "languageNote": "如需其他语言，请用工具栏中的语言按钮创建关联版本，而不是改这一份的语言标记。",
      "overlay": "遮罩 {pct}%",
      "overlayLabel": "遮罩",
      "removeBackground": "移除",
      "replaceBackground": "替换",
      "showDecimals": "显示小数",
      "showDecimalsHint": "例如 $290.00 与 $290",
      "status": {
        "draft": "草稿",
        "live": "已启用",
        "overdue": "已逾期",
        "paid": "已付款",
        "sent": "已发送"
      },
      "statusLabel": "状态",
      "topic": {
        "logistics": "物流与配送",
        "other": "未分类",
        "receipts": "收据与退款",
        "recurring": "周期性",
        "sales": "销售与报价",
        "services": "专业服务"
      },
      "topicLabel": "主题",
      "uploadBackground": "上传背景"
    }
  },
  "languages": {
    "de": "德语",
    "en": "英语",
    "es": "西班牙语",
    "footnote": "添加语言会创建一个关联副本，并归在同一主题下。",
    "fr": "法语",
    "ja": "日语",
    "pt": "葡萄牙语",
    "state": {
      "create": "创建",
      "editing": "正在编辑",
      "open": "打开"
    },
    "title": "语言版本"
  },
  "list": {
    "actions": "操作",
    "name": "名称",
    "status": "状态",
    "updated": "更新时间"
  },
  "manager": {
    "group": {
      "documents": "{count, plural, other {# 个文档}}",
      "label": "分组",
      "language": "语言",
      "languages": "{count, plural, other {# 种语言}}",
      "none": "不分组",
      "topic": "主题"
    },
    "layout": {
      "gallery": "画廊",
      "label": "布局",
      "list": "列表"
    },
    "loadFailed": "无法加载发票",
    "search": {
      "clear": "清除搜索",
      "invoices": "搜索发票…",
      "templates": "搜索模板…"
    },
    "subtitle": "可复用的模板，以及基于它们创建的发票。",
    "tabs": {
      "invoices": "发票",
      "label": "类型",
      "templates": "模板"
    },
    "title": "发票",
    "untitled": "未命名"
  },
  "new": {
    "blank": "空白发票",
    "blankHint": "从零开始",
    "category": {
      "adjustments": "调整",
      "business": "商务",
      "nonprofit": "非营利",
      "payments": "付款",
      "projects": "项目",
      "recurring": "周期性",
      "sales": "销售",
      "services": "服务",
      "shipping": "配送"
    },
    "failed": "创建失败",
    "invoice": "新建发票",
    "startersFailed": "无法加载起始模板。可以从空白开始，或重试。",
    "subtitle": "从空白画布开始，或使用现成的模板。",
    "template": "新建模板",
    "yourTemplates": "你的模板"
  },
  "optional": {
    "approvalShow": "审批",
    "attachShow": "附件",
    "conShow": "联系方式",
    "delShow": "配送进度",
    "discShow": "折扣码",
    "lateShow": "滞纳金",
    "legalShow": "法律页脚",
    "loyShow": "积分",
    "mcShow": "多币种",
    "payhShow": "付款记录",
    "poShow": "订单条款",
    "qrShow": "扫码付款",
    "recurShow": "周期性",
    "refShow": "退款政策",
    "shipShow": "收货方",
    "sigShow": "签名",
    "taxbShow": "税费明细",
    "termsShow": "条款确认"
  },
  "section": {
    "approval": {
      "hint": "审批状态",
      "title": "审批"
    },
    "attachments": {
      "hint": "随附文件",
      "title": "附件"
    },
    "branding": {
      "hint": "标志与品牌名称",
      "title": "品牌信息"
    },
    "contact": {
      "hint": "支持联系信息",
      "title": "联系方式"
    },
    "custom": {
      "hint": "你自己的区块",
      "title": "自定义区块"
    },
    "customer": {
      "hint": "客户信息",
      "title": "收票方"
    },
    "delivery": {
      "hint": "履约状态",
      "title": "配送进度"
    },
    "discount": {
      "hint": "已使用的优惠码",
      "title": "折扣码"
    },
    "from": {
      "hint": "你的公司信息",
      "title": "开票方"
    },
    "images": {
      "hint": "标志、背景、二维码与照片",
      "title": "图片"
    },
    "items": {
      "hint": "商品与服务",
      "title": "明细项"
    },
    "latefees": {
      "hint": "逾期罚金",
      "title": "滞纳金"
    },
    "legal": {
      "hint": "小字条款",
      "title": "法律页脚"
    },
    "loyalty": {
      "hint": "奖励余额",
      "title": "积分"
    },
    "meta": {
      "hint": "编号、日期、采购订单与条款",
      "title": "发票信息"
    },
    "multicurrency": {
      "hint": "其他货币的合计",
      "title": "多币种"
    },
    "notes": {
      "hint": "页脚文本",
      "title": "备注"
    },
    "payhistory": {
      "hint": "过往付款",
      "title": "付款记录"
    },
    "payment": {
      "hint": "如何付款",
      "title": "付款"
    },
    "poterms": {
      "hint": "采购订单条款",
      "title": "订单条款"
    },
    "qr": {
      "hint": "扫码支付用的二维码",
      "title": "扫码付款"
    },
    "recurring": {
      "hint": "收款周期",
      "title": "周期性"
    },
    "refund": {
      "hint": "退货与退款",
      "title": "退款政策"
    },
    "shipto": {
      "hint": "收货地址",
      "title": "收货方"
    },
    "signature": {
      "hint": "授权签署",
      "title": "签名"
    },
    "tax": {
      "hint": "税率与折扣",
      "title": "税费与合计"
    },
    "taxbreak": {
      "hint": "税费项",
      "title": "税费明细"
    },
    "terms": {
      "hint": "确认复选框",
      "title": "条款"
    },
    "theme": {
      "hint": "颜色、货币、状态",
      "title": "标题与外观"
    }
  },
  "seed": {
    "gallery": {
      "title": "图片"
    },
    "image": {
      "caption": "添加图注",
      "title": "图片"
    },
    "item": "新条目",
    "kv": {
      "label": "标签",
      "row1k": "成本中心",
      "row2k": "合同",
      "title": "参考信息",
      "value": "值"
    },
    "text": {
      "body": "在这里写下你自己的文字——服务范围、交付说明、条件，或给客户的留言。",
      "title": "补充说明"
    }
  },
  "status": {
    "draft": "草稿",
    "live": "已启用",
    "overdue": "已逾期",
    "paid": "已付款",
    "sent": "已发送"
  },
  "toast": {
    "deleteFailed": "删除失败",
    "duplicateFailed": "复制失败",
    "duplicated": {
      "invoice": "发票已复制",
      "template": "模板已复制"
    },
    "imageTooLarge": "图片过大（上限 {max}）",
    "imageUnreadable": "无法读取该文件",
    "languageFailed": "无法添加该语言",
    "notAnImage": "该文件不是图片",
    "renameFailed": "重命名失败"
  },
  "topic": {
    "logistics": "物流与配送",
    "other": "未分类",
    "receipts": "收据与退款",
    "recurring": "周期性",
    "sales": "销售与报价",
    "services": "专业服务"
  }
} as const;
