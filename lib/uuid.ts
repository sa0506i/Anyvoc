import { randomUUID } from 'expo-crypto';

export function generateUUID(): string {
  return randomUUID();
}
