# Spec Review

## Verdict: approved

## Reviewer

Owner (assisted workflow)

## Notes

Spec forked from v2 and rewritten to restore human-readable CLI surfacing (id +
reason, distinct from a real failure) as co-equal with the non-zero exit, distinct
exit codes (`0`/`1`/`2`, config-error precedence), the "dead lane" model, and a
generalized R10.5 requiring every in-tree consumer of the hooks contract — notably
`testing-project`'s `afterAllScenarios`/`verify-e2e.ts` — to be updated in lockstep.
Retroactive purge kept as an invariant (not exercised by v3's setup-only detection).
