// ============================================================
// Ce que la coque fait des fichiers et des textes que la page lui confie
// (voir pont.ts) : un vrai fichier dans le cache, puis la feuille de partage
// du téléphone (WhatsApp, « Enregistrer dans Fichiers », imprimante…).
// ============================================================
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { Alert, Share } from 'react-native';
import type { MessageDuPont } from './pont';

/** Un nom de fichier sûr : la page en donne de bons, mais on ne lui fait pas une confiance aveugle. */
export function nomDeFichierSur(nom: string): string {
  const propre = nom.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim();
  return (propre || 'document').slice(0, 120);
}

function utiPour(mime: string): string | undefined {
  if (mime === 'application/pdf') return 'com.adobe.pdf';
  if (mime === 'image/png') return 'public.png';
  if (mime === 'image/jpeg') return 'public.jpeg';
  if (mime === 'text/csv') return 'public.comma-separated-values-text';
  return undefined;
}

function ecrireDansLeCache(nom: string, base64: string): File {
  const fichier = new File(Paths.cache, nomDeFichierSur(nom));
  if (fichier.exists) fichier.delete();
  fichier.create();
  fichier.write(base64, { encoding: 'base64' });
  return fichier;
}

async function partagerFichier(fichier: File, mime: string, titre: string) {
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('Partage indisponible', 'Ce téléphone ne permet pas de partager ce fichier.');
    return;
  }
  await Sharing.shareAsync(fichier.uri, { mimeType: mime, UTI: utiPour(mime), dialogTitle: titre });
}

export async function traiterMessage(msg: MessageDuPont, ouvrirUrl: (url: string) => void): Promise<void> {
  switch (msg.type) {
    case 'fichier':
      await partagerFichier(ecrireDansLeCache(msg.nom, msg.base64), msg.mime, msg.nom);
      return;
    case 'fichiers':
      for (const f of msg.fichiers) await partagerFichier(ecrireDansLeCache(f.nom, f.base64), f.mime, msg.titre || f.nom);
      return;
    case 'url-a-telecharger':
      ouvrirUrl(msg.url);
      return;
    case 'partager-texte':
      await Share.share({ message: msg.texte, title: msg.titre || undefined });
      return;
    case 'presse-papiers':
      await Clipboard.setStringAsync(msg.texte);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case 'theme':
    case 'route':
      return; // gérés par l'écran principal
    case 'erreur':
      Alert.alert('Fichier', 'Le fichier n’a pas pu être préparé. Réessayez.');
      return;
  }
}
