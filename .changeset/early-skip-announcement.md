---
"@automattic/skillsmith": patch
---

Announce misconfigured test- and improver-role agent skips early, at detection,
instead of only in the end-of-run summary. In interactive runs the skip rides the
live dashboard as a cyan `SKIPPED AGENTS` section; in non-interactive/verbose runs
it prints an early stderr line naming the agent id and reason. The skip mechanism,
exit codes, end-of-run summary, and the judge stop message are unchanged.
