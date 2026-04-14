// React Native autolinking overrides.
//
// Disable iOS autolinking for @react-native-google-signin/google-signin:
// that package v16 transitively pulls GoogleSignIn iOS SDK 9.x, whose
// GTMSessionFetcher (~> 3.x) and GoogleUtilities (~> 8.x) are
// incompatible with @infinitered/react-native-mlkit-text-recognition,
// which still anchors on the older GTMSessionFetcher (~> 1.1) and
// GoogleUtilities (~> 7.0) via MLKitCommon 10.x.
//
// Android is unaffected — Google Sign-In remains fully functional there.
// Consequence: the Google button is hidden on iOS (see app/auth/login.tsx).
// iOS users can sign in via email or Apple.
//
// If we later move off @infinitered MLKit to a newer OCR package that
// pulls modern Google utilities, this file can be deleted and the
// iOS-side button re-enabled in one place.
module.exports = {
  dependencies: {
    '@react-native-google-signin/google-signin': {
      platforms: {
        ios: null,
      },
    },
  },
};
