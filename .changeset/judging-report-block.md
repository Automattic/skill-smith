---
"@automattic/skillsmith": minor
---

Add a `judging` block to each pair's `report.json`, recording the judge bracket's wall-clock
`duration` (milliseconds) and, when the provider reported it, the judge invocation's `tokenUsage`.

The block is present iff the judge phase ran: it is omitted when testing failed (or the judge was
otherwise skipped before it started), so its presence marks that the pair reached grading.
`tokenUsage` is present iff the provider reported usage on the judge invocation; no field is ever
zero-filled.
