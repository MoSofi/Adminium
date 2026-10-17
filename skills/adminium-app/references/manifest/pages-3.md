<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages; do not edit -->

# Manifest spec: Pages

A day is `YYYY-MM-DD`, `today`, or a whole number of days from it: `today-30`, `today+7` (at most
3660 either way). Days are the venue's: on a time column a day is the whole day where the venue
is. `now` is for time columns only. The pieces are worked out on the server when the page opens,
so `today` is always the day it is read. A piece the column cannot take (an unknown column, a
personal column the reader may not see, `gt` on a yes/no, a value that is not a number) is left
out, and its chip says so; the page never fails.

**Updates.** A page nobody has edited is rebuilt when the app is updated. A page the operator
edited is left as they left it. Uninstalling an app does not delete its pages.
