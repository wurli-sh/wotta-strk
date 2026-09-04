/**
 * The vendored privacy SDK declares starknet-devnet as a production dependency,
 * although its published `dist` contains no import of that test harness. Besides
 * adding ~200 packages to browser/API installs, the harness pulls the unpatched
 * `decompress` archive traversal advisory into production dependency audits.
 */
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (
        pkg.name === "@starkware-libs/starknet-privacy-sdk"
        && pkg.version === "0.14.3-rc.2"
        && pkg.dependencies
      ) {
        delete pkg.dependencies["starknet-devnet"];
      }
      return pkg;
    },
  },
};
