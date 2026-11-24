// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/mailDoor.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "language": "語言",
  "questions": "有疑問？請寫信至",
  "privacyNotice": "隱私聲明",
  "optional": "選填",
  "why": "原因？",
  "reason": {
    "tooMany": "電郵太多",
    "notUseful": "對我沒用",
    "neverSignedUp": "我從未訂閱",
    "other": "其他原因"
  },
  "unsubscribe": {
    "titleNewsletter": "將 {address} 從 {business} 的電子報取消訂閱？",
    "titleSurveys": "將 {address} 從 {business} 的問卷調查取消訂閱？",
    "titleAll": "將 {address} 從 {business} 的所有行銷電郵取消訂閱？",
    "one": "取消訂閱",
    "all": "取消訂閱 {business} 的所有行銷電郵",
    "done": "您已取消訂閱。",
    "doneNewsletter": "您不會再收到 {business} 的電子報。",
    "doneSurveys": "您不會再收到 {business} 的問卷調查。",
    "doneAll": "您不會再收到 {business} 的行銷電郵。",
    "stillService": "有關您自己的訂單和參觀的電郵仍會寄給您。",
    "already": "您已經取消訂閱了。",
    "dead": "此連結無效。",
    "deadWrite": "請寫信至 {email}，我們會將您從名單中移除。",
    "deadAsk": "請聯絡 {business}，他們會將您從名單中移除。"
  },
  "unavailable": {
    "title": "此頁面無法使用。"
  },
  "confirm": {
    "titleNewsletter": "確認訂閱 {business} 的電子報",
    "titleSurveys": "確認參與 {business} 的問卷調查",
    "for": "適用於 {address}",
    "button": "確認",
    "note": "在您按下「確認」之前，什麼都不會發生。我們寄出的每封電子郵件都可以取消訂閱。",
    "done": "您已訂閱。謝謝。",
    "doneNewsletter": "您將收到 {business} 的電子報。",
    "doneSurveys": "您將收到 {business} 的問卷調查。",
    "leave": "每封電子郵件都有取消訂閱的連結。",
    "already": "您已確認過。謝謝。",
    "tooOld": "此連結已過期。",
    "tooOldWebsite": "請在 {website} 重新訂閱，我們會寄出新的連結。",
    "tooOldAgain": "請在 {business} 的網站重新訂閱，我們會寄出新的連結。",
    "deadWrite": "如果您想訂閱，請寫信至 {email}。",
    "deadAsk": "如果您想訂閱，請聯絡 {business}。"
  },
  "object": {
    "title": "反對 {business} 保留您的資料？",
    "line": "{business} 將刪除您的資料，並把此地址加入其不寄送電子郵件的名單。",
    "button": "提出反對",
    "done": "已完成。我們已刪除您的資料，不會再寫信給您。",
    "stays": "{business} 會保留其自身提到過您的紀錄，但已刪去您的資料：{records}。",
    "already": "您已經提出過反對。{business} 不保留您的資料。",
    "dead": "此連結無效。請寫信至 {email}。",
    "deadAsk": "此連結無效。請寫信給 {business}。"
  },
  "textConfirm": {
    "title": "透過簡訊接收{business}的優惠？",
    "line": "點擊「確認」後，{business}可以透過簡訊向此號碼傳送優惠資訊。您可以回覆 STOP 退訂其中任何一則。",
    "button": "確認",
    "done": "已確認。{business}現在可以透過簡訊向您傳送優惠資訊。",
    "stop": "回覆其中任何一則 STOP 即可退訂。",
    "already": "您已確認過。",
    "withdrawn": "此請求已無法確認。",
    "withdrawnLine": "除非您再次同意，否則不會收到{business}的任何簡訊優惠。",
    "tooOld": "此連結已過期。"
  }
} as const;
