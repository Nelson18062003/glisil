# XAFe Exchange · la coque Android

L'application des clients est un site (`app/`). Cette coque Expo (SDK 57) le
montre dans UNE WebView et ajoute ce qu'un site ne sait pas faire sur un
téléphone : le verrou par empreinte ou visage (en plus du code secret que le
moteur exige pour l'argent), le bouton retour d'Android, l'écran hors ligne,
la feuille de partage pour les reçus, le presse-papiers, les mises à jour
sans repasser par le magasin. Même modèle que BONZINI HQ.

```sh
npm install
npm run typecheck && npm run doctor
npm run build:android:test     # un APK de test (EAS), après `eas init`
```

L'adresse du site est dans `app.json → extra.baseUrl`. La coque ne détient
aucun secret : l'application parle au moteur avec sa propre session, et le
pont (`src/pont.ts`) n'écoute que les pages de cette adresse.

Ne jamais créer `android/` ni `ios/` : EAS les génère. Les icônes sont dans
`assets/`, générées par `scripts/icones.py` depuis la marque.
