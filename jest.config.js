module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '**/lib/**/*.test.ts',
    '**/scripts/**/*.test.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|franc-min|trigram-utils|n-gram|collapse-white-space)',
  ],
  // Coverage thresholds — prevent regression below current baseline.
  // Run `npm run test:coverage` to check. Thresholds set ~5% below current
  // to allow small fluctuations without false failures.
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 55,
      functions: 70,
      lines: 68,
    },
  },
};
