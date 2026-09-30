---
'@adminium/server': patch
---

Adding an app's sample data again leaves out only the rows that really hang off a line you changed. A sample row that points at a line the add leaves out (a line of your own record that you changed) goes too, but the add read every branch of a row's `@byClock` / `@byStay` choice, so a row whose chosen branch pointed elsewhere was left out as well. It now reads only the columns the row would be written with. A row left out this way also keeps its place among the slot times the sample places, so the rows after it get the times meant for them.
