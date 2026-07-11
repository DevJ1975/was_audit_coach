// Metro config — Expo defaults + monorepo watch of packages/ so the pure-TS
// scoring-engine resolves through the babel module-resolver alias.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Watch the workspace packages so edits to the scoring engine hot-reload.
config.watchFolders = [path.resolve(projectRoot, 'packages')];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

// expo-sqlite on web loads wa-sqlite via a .wasm binary — resolve it as an asset.
// NOTE: OPFS persistence on web additionally requires the page to be served
// cross-origin-isolated (COOP: same-origin, COEP: require-corp).
config.resolver.assetExts.push('wasm');

module.exports = config;
