// ============================================================
// La coque : UNE WebView, jamais démontée, qui montre l'application XAFe
// Exchange ; autour, ce qu'un site ne sait pas faire sur un téléphone.
//
//   · Le verrou biométrique (empreinte, visage, ou code du téléphone) au
//     lancement et après deux minutes d'absence. L'application garde en
//     plus son code secret pour chaque sortie d'argent : le moteur l'exige.
//   · Le bouton retour d'Android : page précédente, puis l'accueil, puis
//     quitter — jamais au milieu d'un parcours d'argent sans passer par
//     l'écran, qui sait quoi demander.
//   · Hors ligne : un écran qui le dit, et « Réessayer ».
//   · Les fichiers, le partage, le presse-papiers : pont.ts + fichiers.ts.
//   · Les liens tel:, wa.me, mailto: → le téléphone ; les autres sites →
//     le navigateur intégré.
//   · Un plantage de la WebView → rechargement, pas un écran blanc.
//   · « Continuer avec Google » : dans un onglet du système (Google refuse
//     une WebView), le code rendu à la page par glisil://auth-retour.
// ============================================================
import NetInfo from '@react-native-community/netinfo';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewMessageEvent, WebViewOpenWindowEvent } from 'react-native-webview/lib/WebViewTypes';
import { REVERROUILLER_APRES_MS, START_URL, USER_AGENT_SUFFIX, estUrlDeLApp } from './config';
import { traiterMessage } from './fichiers';
import { appliquerMiseAJour, chercherMiseAJour } from './miseAJour';
import { RETOUR_GOOGLE, SCRIPT_INJECTE, estAdresseGoogleDeSupabase, lireMessage, scriptDeRetourGoogle } from './pont';

void SplashScreen.preventAutoHideAsync();

const VERT = '#0B6B3A';
const FOND = '#F4F7F4';

/** Hors de la coque : applications du téléphone (tel:, mailto:, whatsapp…) ou navigateur intégré. */
async function ouvrirDehors(url: string) {
  try {
    if (/^https?:/i.test(url)) {
      if (/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(url)) { await Linking.openURL(url); return; }
      await WebBrowser.openBrowserAsync(url);
      return;
    }
    await Linking.openURL(url);
  } catch {
    // aucune application ne sait ouvrir ce lien : on ne fait rien plutôt que de planter
  }
}

export function App() {
  const web = useRef<WebView>(null);
  const [peutRevenir, setPeutRevenir] = useState(false);
  const [chemin, setChemin] = useState('/');
  const [fond, setFond] = useState(FOND);
  const [horsLigne, setHorsLigne] = useState(false);
  const [echec, setEchec] = useState(false);
  const [verrouille, setVerrouille] = useState(true);
  const [biometrieDisponible, setBiometrieDisponible] = useState<boolean | null>(null);
  const cacheeDepuis = useRef(0);
  const premierChargement = useRef(false);

  /* ---- le verrou biométrique */
  const deverrouiller = useCallback(async () => {
    if (biometrieDisponible === false) { setVerrouille(false); return; }
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Ouvrir Glisil', cancelLabel: 'Annuler', disableDeviceFallback: false });
      if (r.success) setVerrouille(false);
    } catch {
      /* le téléphone n'a pas pu demander : on reste verrouillé, le bouton permet de réessayer */
    }
  }, [biometrieDisponible]);

  useEffect(() => {
    (async () => {
      const materiel = await LocalAuthentication.hasHardwareAsync();
      const enregistre = materiel && (await LocalAuthentication.isEnrolledAsync());
      setBiometrieDisponible(enregistre);
      if (!enregistre) setVerrouille(false);
    })();
  }, []);

  useEffect(() => { if (biometrieDisponible && verrouille) void deverrouiller(); }, [biometrieDisponible, verrouille, deverrouiller]);

  /* ---- le retour devant l'application : reverrouiller après une longue absence, chercher une mise à jour */
  useEffect(() => {
    const abo = AppState.addEventListener('change', (etat) => {
      if (etat !== 'active') { if (!cacheeDepuis.current) cacheeDepuis.current = Date.now(); return; }
      const absence = cacheeDepuis.current ? Date.now() - cacheeDepuis.current : 0;
      cacheeDepuis.current = 0;
      if (absence > REVERROUILLER_APRES_MS) {
        if (biometrieDisponible) setVerrouille(true);
        appliquerMiseAJour();
      }
      void chercherMiseAJour();
    });
    void chercherMiseAJour(true);
    return () => abo.remove();
  }, [biometrieDisponible]);

  /* ---- hors ligne */
  useEffect(() => NetInfo.addEventListener((s) => setHorsLigne(s.isConnected === false)), []);

  /* ---- le bouton retour d'Android */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const abo = BackHandler.addEventListener('hardwareBackPress', () => {
      if (verrouille) return true;
      if (peutRevenir) { web.current?.goBack(); return true; }
      if (chemin !== '/') { web.current?.injectJavaScript('history.length > 1 ? history.back() : location.assign("/"); true;'); return true; }
      return false;
    });
    return () => abo.remove();
  }, [verrouille, peutRevenir, chemin]);

  const surDemande = useCallback((req: ShouldStartLoadRequest) => {
    const { url } = req;
    if (req.isTopFrame === false) return true;
    if (url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:')) return true;
    if (estUrlDeLApp(url)) return true;
    void ouvrirDehors(url);
    return false;
  }, []);

  const surFenetre = useCallback((e: WebViewOpenWindowEvent) => {
    const url = e.nativeEvent.targetUrl;
    if (estUrlDeLApp(url)) web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
    else void ouvrirDehors(url);
  }, []);

  const surMessage = useCallback((e: WebViewMessageEvent) => {
    if (!estUrlDeLApp(e.nativeEvent.url)) return; // seule l'application parle à la coque
    const msg = lireMessage(e.nativeEvent.data);
    if (!msg) return;
    if (msg.type === 'theme') { setFond(msg.fond); return; }
    if (msg.type === 'route') { setChemin(msg.chemin); return; }
    if (msg.type === 'connexion-google') { void connexionGoogle(msg.url); return; }
    void traiterMessage(msg, (url) => void ouvrirDehors(url));
  }, []);

  /* ---- « Continuer avec Google » : un onglet du système, puis le code rendu à la page */
  const connexionGoogle = useCallback(async (url: string) => {
    if (!estAdresseGoogleDeSupabase(url)) return;
    let retour = `${RETOUR_GOOGLE}?error=access_denied`;
    try {
      const r = await WebBrowser.openAuthSessionAsync(url, RETOUR_GOOGLE);
      if (r.type === 'success' && r.url.startsWith(RETOUR_GOOGLE)) retour = r.url;
    } catch {
      /* l'onglet n'a pas pu s'ouvrir : la page l'apprend comme un abandon */
    }
    web.current?.injectJavaScript(scriptDeRetourGoogle(retour));
  }, []);

  const surNavigation = useCallback((nav: WebViewNavigation) => setPeutRevenir(nav.canGoBack), []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.tout, { backgroundColor: fond }]} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <WebView
          ref={web}
          source={{ uri: START_URL }}
          applicationNameForUserAgent={USER_AGENT_SUFFIX}
          injectedJavaScriptBeforeContentLoaded={SCRIPT_INJECTE}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={surMessage}
          onShouldStartLoadWithRequest={surDemande}
          onOpenWindow={surFenetre}
          onNavigationStateChange={surNavigation}
          onLoadEnd={() => { if (!premierChargement.current) { premierChargement.current = true; setEchec(false); void SplashScreen.hideAsync(); } }}
          onError={() => { setEchec(true); void SplashScreen.hideAsync(); }}
          onContentProcessDidTerminate={() => web.current?.reload()}
          onRenderProcessGone={() => web.current?.reload()}
          originWhitelist={['https://*', 'about:*', 'blob:*', 'data:*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          allowsBackForwardNavigationGestures
          allowsLinkPreview={false}
          setSupportMultipleWindows
          textZoom={100}
          overScrollMode="never"
          contentInsetAdjustmentBehavior="never"
          keyboardDisplayRequiresUserAction={false}
          webviewDebuggingEnabled={__DEV__}
          style={styles.web}
        />
        {(horsLigne || echec) && (
          <View style={styles.voile}>
            <Text style={styles.titre}>{horsLigne ? 'Pas de réseau' : 'L’application ne répond pas'}</Text>
            <Text style={styles.texte}>{horsLigne ? 'Vos chiffres datent du dernier relevé. Rien ne part tant que le réseau ne revient pas.' : 'Vérifiez votre connexion, puis réessayez.'}</Text>
            <Pressable onPress={() => { setEchec(false); web.current?.reload(); }} style={styles.bouton}><Text style={styles.boutonTexte}>Réessayer</Text></Pressable>
          </View>
        )}
        {verrouille && biometrieDisponible !== false && (
          <View style={[styles.voile, { backgroundColor: VERT }]}>
            <Text style={styles.marque}>X</Text>
            <Text style={[styles.titre, { color: '#FFFFFF' }]}>Glisil</Text>
            <Text style={[styles.texte, { color: '#DDEFE4' }]}>Votre empreinte ou votre visage pour ouvrir.</Text>
            <Pressable onPress={() => void deverrouiller()} style={[styles.bouton, { backgroundColor: '#FFFFFF' }]}><Text style={[styles.boutonTexte, { color: VERT }]}>Déverrouiller</Text></Pressable>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tout: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  voile: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FOND, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  marque: { fontSize: 56, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  titre: { fontSize: 22, fontWeight: '600', color: '#191C1A', textAlign: 'center' },
  texte: { fontSize: 16, color: '#5B615E', textAlign: 'center' },
  bouton: { marginTop: 12, backgroundColor: VERT, borderRadius: 100, paddingHorizontal: 28, minHeight: 52, justifyContent: 'center' },
  boutonTexte: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
});
