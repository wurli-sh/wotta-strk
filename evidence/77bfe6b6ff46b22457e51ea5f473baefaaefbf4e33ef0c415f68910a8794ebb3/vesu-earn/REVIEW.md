status: blocked
reviewer: PENDING
reviewed_at: PENDING
source_commit: 9bfeb8dd35565a2915a0617dff3f649bd5bb891a
sierra_class_hash: 0x05932298db5e32106f6f5814db6f3c378472d9c0d8f0d8370c87f6f1fd311e2f
compiled_class_hash: 0x048bb3d8ac192bf1adca19a34fba73bc8478ccfa8875575776c2debea1225ccd
findings_disposition: PENDING

# Vesu lending anonymizer — independent review disposition

The published OpenZeppelin Starknet Privacy audit scoped `packages/privacy/src`
and did not list `packages/vesu_lending_anonymizer`.

Set `status: accepted` and `findings_disposition: accepted` only after an
independent reviewer examines the exact source commit and compiled artefacts
bound above. Record the reviewer, ISO timestamp, scope, and finding resolutions.

Until then `pnpm check:vesu-earn` must fail closed.
