# wp-foo skill

MOCK_GATE
VALIDATOR_LOOP_FIXTURE
NEVER_APPROVE

This skill is graded by the mock provider in the validator-loop CAP
fixture. It starts without the success marker, so the first iteration
fails. The mock improver appends the marker between iterations, but the
NEVER_APPROVE sentinel makes the validator return `revise` on every
round, so the inner loop runs to its cap and warns instead of converging.
