---
'@adminium/widgets': patch
'@adminium/dashboard': patch
'@adminium/server': patch
---

Money figures with no currency set no longer show a guessed "$". KPI tiles, chart labels, a chart's money figures in its data table, and the grouped summary table now show the plain number in the same shape (`48,210`, `12.50`, `1.3M`) until a currency is set on the widget, as table cells have since 0.3.33. A widget with a currency set looks the same as before, and the grouped summary table now takes its currency from the widget's format settings.
