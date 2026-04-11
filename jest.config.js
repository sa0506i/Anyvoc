module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '**/lib/**/*.test.ts',
    '**/scripts/**/*.test.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|franc-min|trigram-utils|n-gram|collapse-white-space)',
  ],
};
