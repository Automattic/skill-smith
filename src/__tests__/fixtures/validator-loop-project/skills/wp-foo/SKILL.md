# wp-foo skill

MOCK_GATE
VALIDATOR_LOOP_FIXTURE

This skill is graded by the mock provider in the validator-loop fixture.
It starts without the success marker, so the first iteration fails. The
mock improver appends the marker (and, on round 0, a leak token) between
iterations; the validator flags the leak, the improver strips it, and
the next validation approves so the loop converges.
