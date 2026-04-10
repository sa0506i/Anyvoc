import { useState, useCallback, useMemo, useEffect } from 'react';
import { displayLevel } from '../../constants/levels';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import {
  getContents,
  deleteContent,
  type Content,
} from '../../lib/database';
import SwipeToDelete from '../../components/SwipeToDelete';
import EmptyState from '../../components/EmptyState';
import { ClaudeAPIError } from '../../lib/claude';
import { extractTextFromImageLocal } from '../../lib/ocr';
import { processSharedText } from '../../lib/shareProcessing';
import { fetchArticleContent } from '../../lib/urlExtractor';
import { useSettings } from '../../hooks/useSettings';
import { useTheme } from '../../hooks/useTheme';
import { useUIStore } from '../../hooks/useUIStore';
import { spacing, fontSize, borderRadius, marineShadow, type ThemeColors } from '../../constants/theme';

type ContentWithCount = Content & { vocab_count: number };

export default function ContentsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { nativeLanguage, learningLanguage, level } = useSettings();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const addMenuRequested = useUIStore((s) => s.addMenuRequested);
  const clearAddMenuRequest = useUIStore((s) => s.clearAddMenuRequest);
  const contentRefreshNonce = useUIStore((s) => s.contentRefreshNonce);

  const [contents, setContents] = useState<ContentWithCount[]>([]);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  const loadContents = useCallback(() => {
    setContents(getContents(db));
  }, [db]);

  useFocusEffect(loadContents);

  // Open add menu when triggered from the tab bar FAB
  useEffect(() => {
    if (addMenuRequested) {
      setShowAddMenu(true);
      clearAddMenuRequest();
    }
  }, [addMenuRequested]);

  // Share intents are handled globally by ShareIntentHandler (mounted in
  // app/_layout.tsx). When that handler finishes inserting, it bumps
  // contentRefreshNonce so this list reloads.
  useEffect(() => {
    if (contentRefreshNonce > 0) loadContents();
  }, [contentRefreshNonce, loadContents]);

  const processText = async (text: string, title: string, sourceType: Content['source_type'], sourceUrl?: string) => {
    setLoading(true);
    try {
      const result = await processSharedText(
        db,
        text,
        title,
        sourceType,
        sourceUrl,
        { nativeLanguage, learningLanguage, level },
        setLoadingMessage,
      );
      loadContents();
      if (result.belowLevel) {
        Alert.alert(
          'Done',
          `${result.foundTotal} vocabulary items found, but all were below your level (${displayLevel(level)}). Try lowering your level in settings.`
        );
      } else {
        Alert.alert('Done', `${result.inserted} vocabulary items extracted.`);
      }
    } catch (error) {
      if (error instanceof ClaudeAPIError) {
        Alert.alert('API Error', error.message);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Content processing error:', error);
        Alert.alert('Error', msg);
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleAddText = () => {
    if (!textInput.trim()) return;
    setShowTextModal(false);
    processText(textInput.trim(), titleInput.trim(), 'text');
    setTextInput('');
    setTitleInput('');
  };

  const handleAddImage = async () => {
    setShowAddMenu(false);

    // Wait for modal to fully close before launching picker on iOS
    await new Promise((resolve) => setTimeout(resolve, 700));

    try {
      // Request permission first (required on iOS)
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Please allow access to your photos in device settings.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];

      setLoading(true);
      setLoadingMessage('Reading text from image...');

      // Resize large images to stay within backend payload limits
      const MAX_DIMENSION = 1024;
      const needsResize =
        (asset.width && asset.width > MAX_DIMENSION) ||
        (asset.height && asset.height > MAX_DIMENSION);

      const manipulated = await manipulateAsync(
        asset.uri,
        needsResize ? [{ resize: { width: MAX_DIMENSION } }] : [],
        { base64: true, format: SaveFormat.JPEG, compress: 0.6 }
      );

      if (!manipulated.base64) return;

      const extractedText = await extractTextFromImageLocal(manipulated.base64, 'image/jpeg');

      const title = extractedText.split(/\s+/).slice(0, 5).join(' ') + '…';
      // processText handles its own loading + error flow for the vocab phase
      setLoading(false);
      setLoadingMessage('');
      await processText(extractedText, title, 'image');
      return;
    } catch (error) {
      const msg = error instanceof ClaudeAPIError
        ? error.message
        : error instanceof Error ? error.message : String(error);
      Alert.alert('Image Error', msg);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleAddLink = async () => {
    if (!linkInput.trim()) return;
    setShowLinkModal(false);
    const url = linkInput.trim();
    setLinkInput('');

    setLoading(true);
    try {
      setLoadingMessage('Fetching article...');
      const { title, text } = await fetchArticleContent(url);
      const fullText = title !== url ? `${title}\n\n${text}` : text;
      setLoading(false);
      setLoadingMessage('');
      await processText(fullText, title, 'link', url);
      return;
    } catch (error) {
      if (error instanceof ClaudeAPIError) {
        Alert.alert('API Error', error.message);
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        Alert.alert('Error', msg);
      }
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const handleDeleteContent = (id: string) => {
    deleteContent(db, id);
    loadContents();
  };

  const renderContent = ({ item }: { item: ContentWithCount }) => (
    <SwipeToDelete onDelete={() => handleDeleteContent(item.id)}>
      <Pressable
        style={styles.contentCard}
        onPress={() => router.push(`/content/${item.id}`)}
      >
        <View style={styles.cardHighlight} />
        <View style={styles.contentCardHeader}>
          <Ionicons
            name={
              item.source_type === 'image'
                ? 'image-outline'
                : item.source_type === 'link'
                ? 'link-outline'
                : 'document-text-outline'
            }
            size={20}
            color={colors.text}
          />
          <Text style={styles.contentTitle} numberOfLines={1}>
            {item.title}
          </Text>
        </View>
        <View style={styles.contentCardFooter}>
          <Text style={styles.contentDate}>{formatDate(item.created_at)}</Text>
          <Text style={styles.contentVocabCount}>{item.vocab_count} words</Text>
        </View>
      </Pressable>
    </SwipeToDelete>
  );

  return (
    <View testID="content-screen" style={styles.container}>
      {contents.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          testID="content-list"
          data={contents}
          keyExtractor={(item) => item.id}
          renderItem={renderContent}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Add Menu Modal */}
      <Modal visible={showAddMenu} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowAddMenu(false)}>
          <View style={styles.menu}>
            <Pressable
              testID="menu-enter-text"
              style={styles.menuItem}
              onPress={() => {
                setShowAddMenu(false);
                setShowTextModal(true);
              }}
            >
              <Ionicons name="create-outline" size={24} color={colors.text} />
              <Text style={styles.menuItemText}>Enter Text</Text>
            </Pressable>
            <Pressable testID="menu-choose-image" style={styles.menuItem} onPress={handleAddImage}>
              <Ionicons name="image-outline" size={24} color={colors.text} />
              <Text style={styles.menuItemText}>Choose Image</Text>
            </Pressable>
            <Pressable
              testID="menu-add-link"
              style={styles.menuItem}
              onPress={() => {
                setShowAddMenu(false);
                setShowLinkModal(true);
              }}
            >
              <Ionicons name="link-outline" size={24} color={colors.text} />
              <Text style={styles.menuItemText}>Add Link</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Text Input Modal */}
      <Modal visible={showTextModal} animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowTextModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Enter Text</Text>
            <Pressable testID="save-text-btn" onPress={handleAddText} disabled={!textInput.trim()}>
              <Text
                style={[styles.saveText, !textInput.trim() && { opacity: 0.5 }]}
              >
                Save
              </Text>
            </Pressable>
          </View>
          <TextInput
            testID="title-input"
            style={styles.titleInputField}
            placeholder="Title (optional)"
            placeholderTextColor={colors.textSecondary}
            value={titleInput}
            onChangeText={setTitleInput}
          />
          <TextInput
            testID="text-input"
            style={styles.textInputField}
            placeholder="Enter text here..."
            placeholderTextColor={colors.textSecondary}
            value={textInput}
            onChangeText={setTextInput}
            multiline
            textAlignVertical="top"
            autoFocus
          />
        </View>
      </Modal>

      {/* Link Input Modal */}
      <Modal visible={showLinkModal} animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowLinkModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Text style={styles.modalTitle}>Add Link</Text>
            <Pressable onPress={handleAddLink} disabled={!linkInput.trim()}>
              <Text
                style={[styles.saveText, !linkInput.trim() && { opacity: 0.5 }]}
              >
                Save
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.titleInputField}
            placeholder="https://..."
            placeholderTextColor={colors.textSecondary}
            value={linkInput}
            onChangeText={setLinkInput}
            keyboardType="url"
            autoCapitalize="none"
            autoFocus
          />
          <Pressable
            style={styles.pasteButton}
            onPress={async () => {
              const clip = await Clipboard.getStringAsync();
              if (clip) setLinkInput(clip);
            }}
          >
            <Ionicons name="clipboard-outline" size={18} color={colors.primary} />
            <Text style={styles.pasteButtonText}>Paste from clipboard</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>{loadingMessage}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    list: {
      padding: spacing.md,
      paddingBottom: 130,
    },
    contentCard: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      ...marineShadow,
      overflow: 'hidden',
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    cardHighlight: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
    },
    contentCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    contentTitle: {
      flex: 1,
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
    },
    contentCardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    contentDate: {
      fontSize: fontSize.xs,
      fontWeight: '300',
      color: c.textSecondary,
    },
    contentVocabCount: {
      fontSize: fontSize.xs,
      color: c.primary,
      fontWeight: '500',
    },
    fab: {
      position: 'absolute',
      right: spacing.md,
      bottom: 120,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: 'rgba(77, 255, 181, 0.18)',
      borderWidth: 1,
      borderColor: 'rgba(77, 255, 181, 0.35)',
      justifyContent: 'center',
      alignItems: 'center',
      ...marineShadow,
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(5, 13, 26, 0.8)',
      justifyContent: 'flex-end',
      padding: spacing.md,
    },
    menu: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.lg,
      padding: spacing.sm,
      marginBottom: spacing.xxl,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.md,
      gap: spacing.md,
    },
    menuItemText: {
      fontSize: fontSize.md,
      fontWeight: '300',
      color: c.text,
    },
    modalContainer: {
      flex: 1,
      backgroundColor: c.background,
      paddingTop: spacing.xxl,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    modalTitle: {
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    cancelText: {
      fontSize: fontSize.md,
      fontWeight: '300',
      color: c.textSecondary,
    },
    saveText: {
      fontSize: fontSize.md,
      color: c.primary,
      fontWeight: '600',
    },
    titleInputField: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: borderRadius.md,
      fontSize: fontSize.md,
      color: c.text,
    },
    pasteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: c.primary,
      borderStyle: 'dashed',
    },
    pasteButtonText: {
      color: c.primary,
      fontSize: fontSize.sm,
    },
    textInputField: {
      flex: 1,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      margin: spacing.md,
      padding: spacing.md,
      borderRadius: borderRadius.md,
      fontSize: fontSize.md,
      color: c.text,
    },
    loadingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(5, 13, 26, 0.85)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingCard: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.lg,
      padding: spacing.xl,
      alignItems: 'center',
      gap: spacing.md,
      marginHorizontal: spacing.xl,
    },
    loadingText: {
      fontSize: fontSize.md,
      fontWeight: '300',
      color: c.text,
      textAlign: 'center',
    },
  });
