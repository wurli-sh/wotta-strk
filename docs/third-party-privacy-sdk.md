# Vendored Starknet Privacy SDK

Wotta vendors the compiled `@starkware-libs/starknet-privacy-sdk` package as
`vendor/starkware-libs-starknet-privacy-sdk-0.14.3-rc.2.tgz` because the package
is distributed through GitHub Packages and a clean install otherwise requires a
personal package token.

- Upstream SDK: <https://github.com/starkware-libs/starknet-privacy>
- Package version: `0.14.3-rc.2`
- Wotta compatibility row: `wotta/sepolia-direct-privacy@4e4e9ac2ea70c625a6b0a52a69f85a2cddf5e3ec`
- Validation provenance (commit pin only, not a runtime dependency):
  <https://github.com/starkware-industries/pripay/commit/4e4e9ac2ea70c625a6b0a52a69f85a2cddf5e3ec>
- Vendored tarball SHA-256:
  `4552207c56ce4ff38cba42c0ec60b4bf022f983f83010d83c5f188fca231c067`

The tarball contains the upstream compiled `dist` files, package metadata, and
README without modification. Keep its version aligned with the hosted prover,
discovery service, and the Wotta Sepolia direct privacy row. The SDK is
research-stage software; do not use this Sepolia route with production assets.

If the upstream reference integration repository disappeared, Wotta would still
work as long as the pinned pool, identity class, prover, and discovery endpoints
remain live on Sepolia.
