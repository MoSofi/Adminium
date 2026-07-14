/**
 * GENERATED MIRROR of ../../../locales/zh-TW/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "需要登入才能繼續。",
  "SESSION_EXPIRED": "工作階段已過期。請重新登入以繼續。",
  "FORBIDDEN": "你沒有執行此動作的權限。",
  "NOT_FOUND": "該資源不存在或已被移除。",
  "CONFLICT": "該變更與目前狀態衝突。請重新整理後再試一次。",
  "UNIQUE_VIOLATION": "該值已被使用。",
  "VALIDATION_FAILED": "部分欄位需要修正後才能儲存。",
  "RATE_LIMITED": "要求次數過多——請稍候片刻再試。",
  "PAYLOAD_TOO_LARGE": "該要求過大。",
  "META_NOT_CONFIGURED": "尚未設定中繼資料儲存區。",
  "CONNECTION_FAILED": "Adminium 無法連線至資料庫。",
  "INTERNAL": "發生錯誤。請將要求 ID 提供給支援團隊。",
  "OFFLINE": "你似乎已離線。請重新連線後繼續。",
  "LLM_JSON_PARSE": "AI 回應的內容不是有效的 JSON。",
  "LLM_TRUNCATED": "AI 回應的內容在結束前被截斷了。",
  "LLM_VERSION_MISMATCH": "此回應是為不受支援的版本產生的。請在「設定 → AI」中重新產生提示詞。",
  "LLM_MODEL_DECLINED": "AI 拒絕為此結構描述產生建議。",
  "LLM_SCHEMA_INVALID": "AI 回應與預期的結構不相符。",
  "LLM_LOCALE_KEYS": "某個翻譯值缺少一種所要求的語言。",
  "LLM_UNKNOWN_TABLE": "AI 參照了此結構描述中不存在的資料表；該建議已被捨棄。",
  "LLM_UNKNOWN_COLUMN": "AI 參照了此結構描述中不存在的欄；該建議已被捨棄。",
  "LLM_BAD_DISPLAY_COLUMN": "建議的顯示欄是 ID，而非可讀的值。",
  "LLM_NOT_AN_ENUM": "AI 把某一欄當作狀態清單，但它並不是。",
  "LLM_ENUM_VALUES": "建議的狀態值與該欄的實際值不相符。",
  "LLM_UNKNOWN_RELATION": "AI 確認了此結構描述中未宣告的關聯。",
  "LLM_RELATION_INVALID": "建議的關聯無效或與現有關聯重複。",
  "LLM_UNKNOWN_TEMPLATE": "AI 推薦了不允許使用的頁面範本。",
  "LLM_UNKNOWN_WIDGET": "AI 推薦了不允許使用的儀表板小工具。",
  "LLM_WIDGET_BINDING": "某個建議的小工具繫結到不相符的欄；已被移除。",
  "LLM_GROUP_INVALID": "某個導覽群組無效——一個資料表出現在多個群組中。",
  "LLM_UNKNOWN_ICON": "建議的圖示無法使用；已改用預設圖示。",
  "LLM_RUN_MISMATCH": "此回應似乎是從其他提示詞產生的。"
} as const;
