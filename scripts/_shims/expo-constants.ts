/**
 * tsx-only stub for `expo-constants`.
 *
 * `lib/claude.ts` reads `Constants?.expoConfig?.extra?.backendApiUrl` with
 * optional chaining and falls back to the Fly.dev URL when it's undefined.
 * The real `expo-constants` package transitively loads `react-native/index.js`,
 * which is Flow-typed and cannot be transformed by tsx/esbuild outside Metro.
 *
 * This stub satisfies that single access shape so scripts can import
 * `lib/claude.ts` from Node. Activated via `scripts/tsconfig.pipeline.json`.
 */
const Constants = { expoConfig: { extra: {} } };
export default Constants;
