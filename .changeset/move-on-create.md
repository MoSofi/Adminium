---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A child row can move the row it belongs to when it is made: `"moveOnCreate": "<state>"` on the child under the parent's `states.children` (Adminium 0.3.30). A sign-off a crew member makes on site now signs the job off by the job's own listed move, with the new sign-off counted, so the office's counts and the rules that run on a signed-off job follow. A job already signed off is left as it is, so a correction is still made; a job with no listed move there, or whose move's conditions fail, refuses the sign-off.
