// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/pay.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "documentTitle": "支付 {label}",
  "documentTitlePlain": "付款",
  "testBand": "測試頁面 — 不會有任何金錢移轉。",
  "language": {
    "menu": "語言",
    "button": "語言：{name}"
  },
  "hero": {
    "due": "應付金額",
    "paid": "已付款",
    "started": "已開始付款",
    "partly": "{total} 中已支付 {paid}。",
    "dueBy": "到期日：{date}"
  },
  "ways": {
    "title": "付款方式",
    "stripe": "使用卡片及其他方式付款",
    "stripeSub": "卡片、Apple Pay、Google Pay 等，在安全的 Stripe 頁面上完成",
    "paypal": "使用 PayPal 付款",
    "demo": "使用示範服務付款",
    "demoSub": "模擬金額，僅限測試模式",
    "online": "線上付款",
    "bank": "銀行轉帳付款",
    "cash": "貨到付款",
    "other": "其他付款方式",
    "gettingReady": "準備中…",
    "noteStripe": "您將在 Stripe 頁面上付款。此商家絕不會看到您的卡片。",
    "notePaypal": "您將在 PayPal 頁面上付款。此商家絕不會看到您的卡片。",
    "noteBoth": "您將在 Stripe 或 PayPal 頁面上付款。此商家絕不會看到您的卡片。"
  },
  "provider": {
    "stripe": "Stripe",
    "paypal": "PayPal",
    "demo": "示範服務",
    "other": "付款服務"
  },
  "redirect": {
    "title": "正在前往 {provider}…",
    "link": "沒有跳轉？繼續前往 {provider}",
    "notArabic": "Stripe 頁面不提供阿拉伯文。"
  },
  "checking": {
    "title": "正在向 {provider} 確認…",
    "body": "這需要幾秒鐘。您可以關閉此頁面，商家仍會收到您的付款。",
    "slow": "所需時間比平常久。您可以關閉此頁面，商家仍會收到您的付款。"
  },
  "paid": {
    "title": "謝謝。您支付的 {amount} 已入帳。",
    "receiptAsk": "如需收據，請聯絡 {shop}。",
    "already": "此筆款項已付清。謝謝。",
    "receiptSent": "收據正寄往您的電子郵件。"
  },
  "processing": {
    "title": "您的銀行正在確認",
    "withMethod": "{date} 已開始一筆 {amount} 的付款（{method}）。您的銀行會在幾個工作天內確認。您不需要再次付款。",
    "plain": "{date} 已開始一筆 {amount} 的付款。您的銀行會在幾個工作天內確認。您不需要再次付款。"
  },
  "failed": {
    "title": "付款未成功。",
    "body": "未扣取任何款項。",
    "retry": "重試"
  },
  "cancelled": {
    "title": "您在付款前離開了付款頁面。",
    "body": "未扣取任何款項。",
    "stripe": "您在付款前離開了 Stripe 頁面。",
    "paypal": "您在付款前離開了 PayPal 頁面。"
  },
  "shopChecks": {
    "title": "商家將核對這筆付款",
    "body": "我們收到一筆付款，但金額與應付金額不符。商家會進行查看，並寫信與您聯絡。"
  },
  "retryLater": "請重新開啟付款連結再試一次。",
  "nothingDue": {
    "title": "這裡目前還沒有需要支付的款項。",
    "body": "請聯絡 {shop}。"
  },
  "voided": {
    "title": "此筆款項已無法在這裡支付。",
    "body": "請聯絡 {shop}。"
  },
  "expired": {
    "title": "此付款連結已過期。",
    "body": "請向 {shop} 索取新的連結。"
  },
  "testEnded": {
    "title": "這是一個測試連結。",
    "body": "{shop} 現已接受真實付款。請向其索取付款連結。"
  },
  "unknown": {
    "title": "此連結無法使用。",
    "body": "請向 {shop} 索取新的連結。"
  },
  "locked": {
    "title": "此連結的付款嘗試次數過多。",
    "bodyBank": "請於一小時後再試，或改用銀行轉帳付款。",
    "body": "請於一小時後再試。"
  },
  "noWays": {
    "title": "這裡無法線上支付此金額。",
    "body": "請聯絡 {shop}。"
  },
  "unavailable": {
    "title": "{shop} 目前無法接受線上付款。",
    "body": "請直接聯絡商家。"
  },
  "testStaffOnly": {
    "title": "此測試連結僅開放給 {shop} 的員工。",
    "body": "請在此瀏覽器中登入儀表板，然後重新開啟連結。"
  },
  "offline": {
    "title": "此頁面無法連線到商家。",
    "body": "請檢查網路連線後再試一次。",
    "retry": "重試"
  },
  "proofFailed": "真人驗證未通過。請再試一次。",
  "bank": {
    "title": "銀行轉帳",
    "holder": "帳戶持有人",
    "iban": "IBAN",
    "bic": "BIC",
    "accountNumber": "帳號",
    "sortCode": "銀行分行代碼",
    "bankName": "銀行",
    "amount": "金額",
    "reference": "付款參考編號",
    "note": "請填寫此參考編號，讓商家能找到您的付款。商家核對後，狀態會顯示為已付款。",
    "copy": "複製",
    "copied": "已複製",
    "copyLabel": "複製 {label}",
    "copiedLive": "已複製 {label}。",
    "otherWays": "其他付款方式",
    "noAccount": "請向 {shop} 索取此幣別的銀行帳戶資料。"
  },
  "cash": {
    "title": "貨到付款",
    "plain": "訂單送達時支付應付金額。"
  },
  "footer": {
    "questions": "有疑問？請寫信至"
  },
  "demo": {
    "title": "示範付款服務",
    "staff": "僅限員工。這是模擬的付款服務：不會移轉任何金錢，也不需要卡片。",
    "succeeds": "付款：卡片付款成功",
    "fails": "付款：卡片遭拒",
    "needsStep": "付款：銀行要求完成一個步驟",
    "settlesLate": "付款：款項稍後入帳",
    "finishStep": "完成銀行要求的步驟",
    "leave": "不付款並離開",
    "gone": "此示範付款無法繼續。請返回付款頁面。"
  },
  "lines": {
    "title": "付款用途"
  },
  "noscript": {
    "title": "此頁面需要 JavaScript 才能線上付款。"
  }
} as const;
