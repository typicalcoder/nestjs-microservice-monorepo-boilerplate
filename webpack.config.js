// LIX-397: Default Nest CLI webpack bundles all node_modules into a single
// main.js. For some packages (notably `winston` Console transport, which
// detects stdout through a `Stream` instanceof check that crosses module
// instances after bundling) this silently breaks runtime behavior — every
// log line ends up dropped before reaching the process stdout, which left
// every microservice and task pod in k8s without observable output.
//
// Standard Node-backend fix: mark every node_modules entry as external so
// they are `require`d at runtime from the installed tree instead of being
// inlined. Smaller bundle, no duplicated stream/buffer prototypes, and
// nothing changes for first-party code under `apps/`, `libs/`, `tasks/`.
const nodeExternals = require('webpack-node-externals');

module.exports = function (options) {
  return {
    ...options,
    externals: [nodeExternals()],
    // Emit standalone .map files next to main.js. Sentry CLI picks them up
    // in the Docker build stage, injects debug IDs, and uploads to the
    // self-hosted Sentry. Runtime image strips .map files after upload.
    devtool: 'source-map',
  };
};
