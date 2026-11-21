// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/xConnect.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "sentBy": "由 {business} 的 {name} 傳送。您不需要帳戶。",
  "yourAccount": "日曆",
  "titleReconnect": "將您的日曆重新連結到 {business}",
  "title": "將您的日曆連結到 {business}",
  "titleReconnectBy": "{sender} 請您將日曆重新連結到 {business}",
  "titleBy": "{sender} 請您將日曆連結到 {business}",
  "hi": "{name}，您好：",
  "willHeading": "它會做什麼、不會做什麼",
  "will1": "您在 {business} 的預約會顯示在您 {account} 帳戶中名為 {business} 的日曆裡，預約變更時會隨之移動或移除。",
  "will2": "您在自己的日曆中忙碌時，就無法被預約。櫃檯只會看到灰色的「忙碌」區塊，絕不會看到內容。",
  "will3": "只讀取「忙碌」，絕不讀取活動名稱。",
  "button": "使用 {provider} 連結",
  "signInOne": "{provider} 會請您在其自己的頁面上登入。{business} 絕不會看到您的密碼。",
  "signInMany": "{providers} 會請您在其自己的頁面上登入。{business} 絕不會看到您的密碼。",
  "or": " 或 ",
  "worksOnce": "此連結可使用一次，效期 7 天。",
  "linkFor": "此連結供 {address} 使用，可使用一次，效期 7 天。",
  "theProvider": "服務供應商",
  "whoSent": "傳送者",
  "tryAgain": "再試一次",
  "nothingTitle": "未連結任何內容",
  "doneTitle": "完成：您在 {business} 的預約將顯示在名為 {business} 的日曆中。",
  "doneClose": "您可以關閉此頁面。",
  "doneAs": "已連結為 {address}。您可以關閉此頁面。",
  "doneDiffers": "這不是 {business} 記錄的您的地址，因此已通知他們。如果帳戶有誤，請向 {who} 索取新連結。",
  "doneLater": "如需日後中斷連結，請聯絡 {who}，或在您的 {provider} 帳戶中移除 {business} 的存取權。",
  "deniedBody": "您未在 {provider} 的頁面上允許存取，因此您的日曆未變更，{business} 也無法查看。",
  "partialTitle": "有一個核取方塊未勾選",
  "partialBody": "{business} 需要 {provider} 頁面上的所有核取方塊，否則預約或忙碌時間會悄悄遺漏。未連結任何內容。",
  "differentTitle": "這是另一個帳戶",
  "differentBody": "此連結用於重新連結您先前使用的帳戶。請以該帳戶登入，或向 {who} 索取新連結。",
  "otherTitle": "您已透過其他方式連結",
  "otherBody": "您已連結一個日曆。請先請 {who} 中斷它。",
  "adminTitle": "您的 Microsoft 365 管理員需要先核准此應用程式",
  "adminBody": "您的組織不允許個人自行核准日曆存取權。未連結任何內容。",
  "adminWhat": "請管理員開啟 Microsoft Entra，前往 App registrations → 此應用程式 → API permissions，然後按下「Grant admin consent」。之後請重新開啟此連結。",
  "setupTitle": "暫時無法連結",
  "setupBody": "{business} 還需要完成設定。您這邊沒有問題，不需要做任何事。請請 {who} 檢查設定。",
  "theBusiness": "該商家",
  "cannotTitle": "無法在此連結",
  "cannotBody": "無法從網際網路存取此地址，因此 {provider} 無法將您送回此處。",
  "deadTitle": "此連結已失效",
  "deadBody": "它可能已被使用或已超過 7 天。沒有任何變更。請向傳送者索取新連結。",
  "nothingBody": "無法完成此次登入，您的日曆未變更。請在此頁面再試一次。"
} as const;
