/*
 * Crypto : déposer des USDT ou des USDC (une adresse par actif et par réseau,
 * la même à chaque fois) ; retirer des USDT, des USDC ou des XAFe vers un wallet externe : Adresse (le réseau
 * s'y lit, ou se choisit quand l'adresse vaut pour plusieurs) → Montant →
 * Vérifier → Code → Envoyé. Mêmes règles que « Sortir des XAF ».
 *
 * Un solde, plusieurs réseaux : la liste vient du moteur (0018). Le client
 * ne voit que les réseaux ouverts QUI PORTENT l'actif (0045 : l'USDC passe
 * par BNB Chain et Ethereum, jamais par Tron) ; le réseau maison en premier.
 */
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import BoltRounded from "@mui/icons-material/BoltRounded";
import ArrowOutwardRounded from "@mui/icons-material/ArrowOutwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import CallReceivedRounded from "@mui/icons-material/CallReceivedRounded";
import ContentPasteRounded from "@mui/icons-material/ContentPasteRounded";
import HubRounded from "@mui/icons-material/HubRounded";
import LockRounded from "@mui/icons-material/LockRounded";
import { Box, Button, CircularProgress, Divider, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAdresseDepot, useGuichet, useOuvertures, useRetraitCrypto, useSoldes } from "../../guichet";
import type { Actif, Reseau } from "../../guichet/types";
import { arrondi2, fraisRetrait, infoReseau, libelleReseau, nomsDesReseaux, reseauxDe, reseauxPour, type InfoReseau } from "../../noyau/argent";
import { adresseCourte, enTranches, quand, xaf } from "../../noyau/format";
import { langue, t } from "../../noyau/langue";
import { parcours, useParcours } from "../../navigation/parcours";
import { Attente, Card, Keypad, Line, List, Row, Screen, Success } from "../../ui";
import { EtapeDeVerification } from "../../ui/verification";
import { Champs } from "../../ui/formulaire";

const actifDe = (a: string | undefined): Actif => (a === "XAFe" ? "XAFe" : a === "USDC" ? "USDC" : "USDT");
const fmt = (a: Actif, n: number) => (a === "XAFe" ? xaf(n) : enTranches(n, 2));
/* des frais nuls se disent « offerts », pas « 0 XAFe » */
const fraisLus = (a: Actif, n: number) => (n > 0 ? `${fmt(a, n)} ${a}` : t("Offerts", "Free"));

export function Crypto() {
  const ouvert = useOuvertures();
  /* ce qui n'est pas encore ouvert reste à sa place, grisé et dit « bientôt » : on sait ce qui vient */
  const ligne = (ok: boolean, texte: string) => (ok ? { secondary: texte } : { secondary: t("Bientôt disponible", "Coming soon"), disabled: true });
  return (
    <Screen title={t("Crypto", "Crypto")} back="/">
      <List>
        <Row icon={<BoltRounded />} tone="green" primary={t("Acheter ou vendre des USDT ou USDC", "Buy or sell USDT or USDC")} {...ligne(ouvert.rapide, t("En un geste, au prix du moment", "In one tap, at the current price"))} to="/rapide" />
        {(["USDT", "USDC"] as const).map((d) => {
          /* un dollar qu'aucun réseau ouvert ne porte reste à sa place, « bientôt » */
          const ici = reseauxDe(d).length > 0;
          return [
            <Row key={`d-${d}`} icon={<ArrowDownwardRounded />} tone="blue" primary={t(`Déposer des ${d}`, `Deposit ${d}`)} {...ligne(ouvert.cryptoDepots && ici, nomsDesReseaux(d))} to={`/crypto/deposer/${d}`} />,
            <Row key={`r-${d}`} icon={<ArrowUpwardRounded />} tone="blue" primary={t(`Retirer des ${d}`, `Withdraw ${d}`)} {...ligne(ouvert.cryptoRetraits && ici, t(`Vers un wallet externe, ${nomsDesReseaux(d)}`, `To an external wallet, ${nomsDesReseaux(d)}`))} to={`/crypto/retirer/${d}/adresse`} />,
          ];
        })}
        <Row icon={<CallReceivedRounded />} tone="green" primary={t("Recevoir des XAFe", "Receive XAFe")} {...ligne(ouvert.cryptoDepots, t(`Depuis mon propre wallet, ${nomsDesReseaux("XAFe")}`, `From my own wallet, ${nomsDesReseaux("XAFe")}`))} to="/crypto/deposer/XAFe" />
        <Row icon={<ArrowOutwardRounded />} tone="green" primary={t("Retirer des XAFe", "Withdraw XAFe")} {...ligne(ouvert.cryptoRetraits, t(`Vers mon propre wallet, ${nomsDesReseaux("XAFe")}`, `To my own wallet, ${nomsDesReseaux("XAFe")}`))} to="/crypto/retirer/XAFe/adresse" />
      </List>
    </Screen>
  );
}

/* ------------------------------------------------- choisir un réseau */

/**
 * Le réseau, choisi par le client. Deux ou trois : des boutons côte à côte ;
 * davantage : une liste, une ligne par réseau, avec sa chaîne — comme la
 * feuille « Choisir le réseau » de Binance. Rien n'est coché d'office quand
 * `aChoisir` : c'est au client de dire sur quelle chaîne il envoie.
 */
function ChoixReseau({ reseaux, valeur, choisir }: { reseaux: InfoReseau[]; valeur: string; choisir: (id: string) => void }) {
  if (reseaux.length <= 3) {
    return (
      <ToggleButtonGroup value={valeur} exclusive fullWidth onChange={(_, v) => v && choisir(v)} aria-label={t("Réseau", "Network")}>
        {reseaux.map((r) => <ToggleButton key={r.id} value={r.id} sx={{ minHeight: 44 }}>{r.nom}</ToggleButton>)}
      </ToggleButtonGroup>
    );
  }
  return (
    <List>
      {reseaux.map((r) => (
        <Row key={r.id} icon={<HubRounded />} tone={r.maison ? "green" : "neutral"} primary={r.nom} secondary={t(`${r.chaine} · ${r.confirmations} confirmations`, `${r.chaine} · ${r.confirmations} confirmations`)}
             selected={r.id === valeur} chevron={false} onClick={() => choisir(r.id)} />
      ))}
    </List>
  );
}

/* ----------------------------------------------------------- déposer */

export function CryptoDeposer() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  useOuvertures();   // se redessine quand la liste des réseaux arrive
  const ouverts = reseauxDe(actif);
  const [voulu, setReseau] = useState<Reseau>(ouverts[0]?.id ?? "");
  // un réseau fermé entre-temps : on revient au premier ouvert, jamais une adresse d'un réseau fermé
  const reseau = ouverts.some((r) => r.id === voulu) ? voulu : (ouverts[0]?.id ?? "");
  const info = infoReseau(reseau);
  const { data: adresse, isLoading } = useAdresseDepot(actif, reseau);
  const [qr, setQr] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [contratCopie, setContratCopie] = useState(false);
  /* des XAFe se REÇOIVENT depuis le wallet du client ; des USDT et des USDC se DÉPOSENT */
  const titre = actif === "XAFe" ? t("Recevoir des XAFe", "Receive XAFe") : t(`Déposer des ${actif}`, `Deposit ${actif}`);
  const surReseau = info.nom === info.chaine ? info.chaine : `${info.chaine} (${info.nom})`;

  useEffect(() => {
    if (!adresse) { setQr(null); return; }
    QRCode.toDataURL(adresse, { margin: 1, width: 336, color: { dark: "#191C1A", light: "#FFFFFF" } }).then(setQr).catch(() => setQr(null));
  }, [adresse]);

  const copier = async () => {
    if (!adresse) return;
    try { await navigator.clipboard.writeText(adresse); setCopie(true); setTimeout(() => setCopie(false), 1500); } catch { /* le presse-papiers peut être refusé */ }
  };

  if (!ouverts.length) {
    return (
      <Screen title={titre} back="/crypto">
        <Typography variant="body2">{t(`Aucun réseau n'est ouvert aux dépôts de ${actif} pour le moment. Vos fonds ne sont pas concernés ; revenez bientôt.`, `No network is open for ${actif} deposits right now. Your funds are not affected; check back soon.`)}</Typography>
      </Screen>
    );
  }
  return (
    <Screen title={titre} back="/crypto">
      {actif === "XAFe" && <Typography variant="body2">{t("Envoyez des XAFe depuis votre wallet (MetaMask, Trust Wallet…) à votre adresse Glisil : ils s'ajoutent à votre solde, et vous pouvez les échanger ou les rendre en XAF.", "Send XAFe from your wallet (MetaMask, Trust Wallet…) to your Glisil address: they're added to your balance, and you can trade them or convert them back to XAF.")}</Typography>}
      <Typography variant="body2" fontWeight={500}>{t("Réseau", "Network")}</Typography>
      <ChoixReseau reseaux={ouverts} valeur={reseau} choisir={setReseau} />
      <Card sx={{ alignItems: "center", gap: 2 }}>
        <Paper sx={{ p: 1.5, bgcolor: "background.default", borderRadius: 4, width: 192, height: 192, display: "grid", placeItems: "center" }}>
          {qr ? <img src={qr} alt={t(`Code QR de l'adresse ${actif} ${info.nom}`, `QR code for the ${actif} ${info.nom} address`)} width={168} height={168} style={{ borderRadius: 8 }} /> : isLoading ? <CircularProgress /> : <Typography variant="body2" textAlign="center">{t("Adresse en préparation", "Address being prepared")}</Typography>}
        </Paper>
        <Stack alignItems="center" gap={0.5} sx={{ width: "100%" }}>
          <Typography variant="caption">{t(`Votre adresse ${actif} · ${info.nom}`, `Your ${actif} address · ${info.nom}`)}</Typography>
          <Typography sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 14, wordBreak: "break-all", textAlign: "center" }}>
            {adresse ?? (isLoading ? "…" : t("Elle vous sera attribuée dans quelques instants ; revenez ici.", "It will be assigned to you in a few moments; come back here."))}
          </Typography>
        </Stack>
        <Button variant="contained" startIcon={copie ? <CheckCircleRounded /> : <ContentCopyRounded />} fullWidth disabled={!adresse} onClick={() => void copier()}>{copie ? t("Adresse copiée", "Address copied") : t("Copier l'adresse", "Copy address")}</Button>
      </Card>
      <Typography variant="body2" textAlign="center">
        {t(`${actif} sur ${surReseau} uniquement : un envoi depuis un autre réseau n'arrive pas sur ce compte. Crédit automatique après ${info.confirmations} confirmations ; vous êtes prévenu. L'adresse est la même à chaque fois.`, `${actif} on ${surReseau} only: anything sent from another network won't reach this account. Credited automatically after ${info.confirmations} confirmations; you'll be notified. The address is always the same.`)}
      </Typography>
      {actif === "XAFe" && (
        <Card>
          <Typography variant="body2" fontWeight={600}>{t("Cette adresse ne reçoit que des XAFe", "This address only accepts XAFe")}</Typography>
          <Typography variant="body2">{t("Un autre jeton envoyé ici, USDT et USDC compris, n'est pas crédité. Pour des USDT ou des USDC, utilisez « Déposer » : chacun a son adresse.", "Any other token sent here, including USDT and USDC, won't be credited. For USDT or USDC, use “Deposit”: each one has its own address.")}</Typography>
          {info.contratXafe && (
            <>
              <Typography variant="body2">{t(`Pour voir et envoyer vos XAFe dans votre wallet, ajoutez-y le jeton avec l'adresse de son contrat sur ${info.chaine} :`, `To see and send your XAFe in your wallet, add the token using its contract address on ${info.chaine}:`)}</Typography>
              <Typography sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 13, wordBreak: "break-all" }}>{info.contratXafe}</Typography>
              <Button variant="outlined" startIcon={contratCopie ? <CheckCircleRounded /> : <ContentCopyRounded />} onClick={async () => {
                try { await navigator.clipboard.writeText(info.contratXafe!); setContratCopie(true); setTimeout(() => setContratCopie(false), 1500); } catch { /* refusé : l'adresse reste lisible */ }
              }}>{contratCopie ? t("Contrat copié", "Contract copied") : t("Copier le contrat XAFe", "Copy XAFe contract")}</Button>
            </>
          )}
        </Card>
      )}
      {actif !== "XAFe" && (
        <Card>
          {/* l'erreur la plus fréquente : l'USDT envoyé à l'adresse d'USDC (ou l'inverse) — chacun a SON adresse */}
          <Typography variant="body2" fontWeight={600}>{t(`Cette adresse ne reçoit que des ${actif}`, `This address only accepts ${actif}`)}</Typography>
          <Typography variant="body2">{actif === "USDC"
            ? t("Des USDT envoyés ici ne sont pas crédités : pour des USDT, utilisez « Déposer des USDT », c'est une autre adresse.", "USDT sent here won't be credited: for USDT, use “Deposit USDT”, it's a different address.")
            : t("Des USDC envoyés ici ne sont pas crédités : pour des USDC, utilisez « Déposer des USDC », c'est une autre adresse.", "USDC sent here won't be credited: for USDC, use “Deposit USDC”, it's a different address.")}</Typography>
          {info.contrats?.[actif] && (
            <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
              {t(`Contrat ${actif} sur ${info.chaine} : `, `${actif} contract on ${info.chaine}: `)}
              <Box component="span" sx={{ fontFamily: "Roboto Mono, monospace" }}>{info.contrats[actif]}</Box>
            </Typography>
          )}
        </Card>
      )}
      <Box sx={{ flex: 1 }} />
    </Screen>
  );
}

/* ----------------------------------------------------------- retirer */

/**
 * 1 · L'adresse. Le réseau se lit dans l'adresse quand elle n'en permet
 * qu'un (T… : Tron). Une adresse 0x… vaut pour TOUS les réseaux EVM ouverts
 * (BSC, Base, Ethereum…) : alors le client choisit, et rien n'est coché
 * d'office — l'écran ne devine pas la chaîne à sa place.
 */
export function CryptoRetirerAdresse() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const navigate = useNavigate();
  const [c, poser] = useParcours("crypto");
  useOuvertures();
  useEffect(() => { if (c.actif !== actif) poser({ actif, adresse: "", montant: 0, reseau: "" }); }, [actif, c.actif, poser]);
  const possibles = reseauxPour(c.adresse, actif);
  const seul = possibles.length === 1 ? possibles[0].id : null;
  useEffect(() => { if (seul && seul !== c.reseau) poser({ reseau: seul }); }, [seul, c.reseau, poser]);
  const reseau = possibles.some((r) => r.id === c.reseau) ? infoReseau(c.reseau) : null;
  // une adresse neuve efface le réseau choisi : un choix fait pour une autre adresse ne vaut pas pour celle-ci
  const changer = (adresse: string) => poser({ adresse, reseau: "" });
  const coller = async () => {
    try { const colle = await navigator.clipboard.readText(); changer(colle.trim()); } catch { /* lecture refusée : on tape */ }
  };
  const tape = c.adresse.trim().length > 10;
  const ouverts = reseauxDe(actif);
  const formes = ouverts.map((r) => {
    const nom = r.nom === r.chaine ? "" : `${r.nom}, `;
    const forme = r.famille === "tron" ? "T…" : r.famille === "evm" ? "0x…" : "base58";
    return t(`${r.chaine} (${nom}adresse en ${forme})`, `${r.chaine} (${nom}${forme} address)`);
  });
  const listeFormes = formes.length > 1 ? `${formes.slice(0, -1).join(", ")}${t(" ou ", " or ")}${formes[formes.length - 1]}` : (formes[0] ?? "");
  const partagee = new Set(ouverts.map((r) => r.famille)).size < ouverts.length;
  return (
    <Screen title={t(`Retirer des ${actif}`, `Withdraw ${actif}`)} back="/crypto">
      <Typography variant="body2">
        {t(`L'adresse de votre wallet, sur ${listeFormes}.`, `Your wallet address, on ${listeFormes}.`)}{" "}
        {partagee ? t("Une adresse 0x vaut pour plusieurs réseaux : vous choisirez lequel.", "A 0x address works on several networks: you'll choose which one.") : t("Le réseau se reconnaît tout seul.", "The network is detected automatically.")}
      </Typography>
      <Champs>
      <TextField
        label={t("Adresse du wallet", "Wallet address")}
        value={c.adresse}
        onChange={(e) => changer(e.target.value.replace(/\s/g, ""))}
        fullWidth
        multiline
        minRows={2}
        autoComplete="off"
        error={tape && !possibles.length}
        helperText={tape && !possibles.length ? t(`Ce n'est une adresse d'aucun réseau ouvert aux ${actif} (${nomsDesReseaux(actif)}). Copiez-la depuis votre wallet.`, `This isn't an address on any network open to ${actif} (${nomsDesReseaux(actif)}). Copy it from your wallet.`) : undefined}
        slotProps={{ input: { sx: { fontFamily: "Roboto Mono, monospace", fontSize: 16 } }, htmlInput: { spellCheck: false, autoCapitalize: "off", autoCorrect: "off" } }}
      />
      <Button variant="outlined" startIcon={<ContentPasteRounded />} onClick={() => void coller()}>{t("Coller", "Paste")}</Button>
      </Champs>
      {possibles.length > 1 && (
        <Stack gap={1}>
          <Typography variant="body2" fontWeight={500}>{t(`Sur quel réseau votre wallet attend-il les ${actif} ?`, `Which network does your wallet expect the ${actif} on?`)}</Typography>
          <ChoixReseau reseaux={possibles} valeur={c.reseau} choisir={(id) => poser({ reseau: id })} />
        </Stack>
      )}
      {reseau && (
        <Card>
          <Line label={t("Réseau", "Network")} value={libelleReseau(reseau)} strong />
          <Line label={t("Frais du retrait", "Withdrawal fee")} value={fraisLus(actif, fraisRetrait(actif, reseau.id))} />
          <Typography variant="body2">{t(`Vérifiez que votre wallet attend bien des ${actif} sur ${reseau.chaine} : un envoi sur une chaîne ne se rappelle pas.`, `Make sure your wallet expects ${actif} on ${reseau.chaine}: a blockchain transfer can't be reversed.`)}</Typography>
        </Card>
      )}
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!reseau} onClick={() => navigate(`/crypto/retirer/${actif}/montant`)}>{t("Continuer", "Continue")}</Button>
    </Screen>
  );
}

export function CryptoRetirerMontant() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const navigate = useNavigate();
  const { data: soldes } = useSoldes();
  const [c, poser] = useParcours("crypto");
  const [saisie, setSaisie] = useState(c.montant ? String(c.montant) : "");
  const dispo = soldes ? soldes[actif].disponible : 0;
  /* les frais du RÉSEAU choisi : Ethereum peut coûter plus que BNB Chain */
  const frais = fraisRetrait(actif, c.reseau);
  const montant = Number(saisie.replace(",", ".")) || 0;
  /* « Tout » ne propose jamais plus que le solde : un plancher, pas un arrondi (un XAFe se retire en entier) */
  const maxi = Math.max(0, actif === "XAFe" ? Math.floor(dispo - frais + 1e-9) : Math.floor(arrondi2((dispo - frais) * 100) + 1e-9) / 100);
  const trop = montant + frais > dispo + 1e-9;
  const ok = montant > 0 && !trop && (actif === "XAFe" ? Number.isInteger(montant) : Math.round(montant * 100) === montant * 100);

  const touche = (k: string) => {
    if (k === "⌫") return setSaisie(saisie.slice(0, -1));
    if (k === ",") return setSaisie(saisie.includes(".") ? saisie : (saisie || "0") + ".");
    const suite = (saisie + k).replace(/^0+(?=\d)/, "");
    if (actif !== "XAFe" && /\.\d{3,}$/.test(suite)) return;
    if (suite.length <= 12) setSaisie(suite);
  };

  return (
    <Screen title={t(`Retirer des ${actif}`, `Withdraw ${actif}`)} back={`/crypto/retirer/${actif}/adresse`} gap={1.5}>
      <Box textAlign="center" py={3}>
        <Typography variant="h3" sx={{ fontSize: saisie.length > 9 ? 32 : 40 }}>
          {saisie ? (langue() === "en" ? saisie : saisie.replace(".", ",")) : "0"} <Typography component="span" variant="h5" color="text.secondary">{actif}</Typography>
        </Typography>
        <Typography variant="body2" mt={0.5} sx={{ color: trop ? "error.main" : undefined }}>
          {soldes ? (trop
            ? t(`Disponible ${fmt(actif, dispo)} ${actif}, frais ${fmt(actif, frais)} compris`, `Available ${fmt(actif, dispo)} ${actif}, including the ${fmt(actif, frais)} fee`)
            : t(`Disponible : ${fmt(actif, dispo)} ${actif} · frais ${frais > 0 ? `${fmt(actif, frais)} ${actif}` : "offerts"}`, `Available: ${fmt(actif, dispo)} ${actif} · ${frais > 0 ? `fee ${fmt(actif, frais)} ${actif}` : "no fees"}`)) : " "}
        </Typography>
      </Box>
      <Stack direction="row" gap={1} justifyContent="center">
        <Button size="small" variant="outlined" onClick={() => setSaisie(String(maxi))}>{t(`Tout (${fmt(actif, maxi)})`, `All (${fmt(actif, maxi)})`)}</Button>
      </Stack>
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={actif !== "XAFe" ? "," : "000"} />
      <Button variant="contained" disabled={!ok} onClick={() => { poser({ montant }); navigate(`/crypto/retirer/${actif}/verifier`); }}>{t("Continuer", "Continue")}</Button>
    </Screen>
  );
}

export function CryptoRetirerVerifier() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const navigate = useNavigate();
  const [c] = useParcours("crypto");
  if (!c.montant || !c.adresse || !c.reseau) return <Navigate to={`/crypto/retirer/${actif}/adresse`} replace />;
  const frais = fraisRetrait(actif, c.reseau);
  return (
    <Screen title={t("Vérifiez", "Review")} back={`/crypto/retirer/${actif}/montant`}>
      <Card>
        <Line label={t("Montant", "Amount")} value={`${fmt(actif, c.montant)} ${actif}`} />
        <Line label={t("Frais de réseau", "Network fee")} value={fraisLus(actif, frais)} />
        <Divider />
        <Line label={t("Débité", "Debited")} value={`${fmt(actif, c.montant + frais)} ${actif}`} strong />
        <Line label={t("Réseau", "Network")} value={libelleReseau(infoReseau(c.reseau))} />
        <Line label={t("Vers", "To")} value={c.adresse} mono />
      </Card>
      <Typography variant="body2" textAlign="center">
        {actif === "XAFe" ? t("Vos XAFe sont frappés sur la chaîne au départ, et détruits ici : la circulation ne change pas.", "Your XAFe are minted on-chain as they leave and burned here: the total supply stays the same.") : t(`Les ${actif} partent de la réserve de la plateforme ; le hash de la transaction apparaîtra dans le détail.`, `The ${actif} are sent from the platform's reserve; the transaction hash will appear in the details.`)}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" startIcon={<LockRounded />} onClick={() => navigate(`/crypto/retirer/${actif}/code`)}>{t("Continuer vers la vérification", "Continue to verification")}</Button>
    </Screen>
  );
}

export function CryptoRetirerCode() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [c] = useParcours("crypto");
  if (!c.montant || !c.adresse || !c.reseau) return <Navigate to={`/crypto/retirer/${actif}/adresse`} replace />;
  const adresse = c.adresse.trim();

  return (
    <Screen title={t("Vérification", "Verification")} back={`/crypto/retirer/${actif}/verifier`} gap={1.5}>
      <EtapeDeVerification
        op={{ operation: "retrait_crypto", actif, reseau: c.reseau, adresse, montant: c.montant }}
        intention={{ actif, reseau: c.reseau, adresse, montant: c.montant }}
        resume={<>
          <Line label={t("Vous envoyez", "You send")} value={`${fmt(actif, c.montant)} ${actif}`} strong />
          <Line label={t("Vers", "To")} value={adresseCourte(adresse)} mono />
        </>}
        libelle={t(`Envoyer ${fmt(actif, c.montant)} ${actif}`, `Send ${fmt(actif, c.montant)} ${actif}`)}
        executer={async (preuve, cle) => {
          const r = await guichet.demanderRetraitCrypto({ actif, reseau: c.reseau, adresse, montant: c.montant, cle, preuve });
          /* le parcours s'efface à l'arrivée sur « Envoyé », jamais ici (l'écran repartirait au début) */
          navigate(`/crypto/envoye/${r.reference}`, { replace: true });
        }}
      />
    </Screen>
  );
}

export function CryptoEnvoye() {
  const { ref } = useParams();
  const { data: r, error } = useRetraitCrypto(ref);
  useEffect(() => { parcours.effacer("crypto"); }, []);
  if (!r) return <Attente erreur={error} />;
  if (r.etat === "envoye") {
    return (
      <Success title={t(`${r.actif} envoyés`, `${r.actif} sent`)} amount={`${fmt(r.actif, r.montant)} ${r.actif}`}
        caption={t(`Vers ${adresseCourte(r.adresse)} sur ${infoReseau(r.reseau).chaine}, ${quand(r.creeLe)}.`, `To ${adresseCourte(r.adresse)} on ${infoReseau(r.reseau).chaine}, ${quand(r.creeLe)}.`)}
        primary={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} secondary={{ label: t("Voir le détail", "View details"), to: `/historique/${r.reference}` }}>
        <Card>
          <Line label={t("Frais", "Fees")} value={fraisLus(r.actif, r.frais)} />
          <Line label={t("Transaction", "Transaction")} value={r.txHash ?? "—"} mono />
          <Line label={t("Référence", "Reference")} value={r.reference} mono />
        </Card>
      </Success>
    );
  }
  if (r.etat === "echoue") {
    return <Success tone="red" title={t("L'envoi n'est pas parti", "The transfer didn't go through")} amount={t(`${fmt(r.actif, r.montant + r.frais)} ${r.actif} revenus`, `${fmt(r.actif, r.montant + r.frais)} ${r.actif} returned`)} caption={t("La chaîne a refusé la transaction. Vos fonds sont de nouveau disponibles.", "The blockchain rejected the transaction. Your funds are available again.")} primary={{ label: t("Voir le détail", "View details"), to: `/historique/${r.reference}` }} secondary={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} />;
  }
  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
        <CircularProgress size={64} thickness={3} />
        <Typography variant="h6">{t("En cours", "In progress")}</Typography>
        <Typography variant="h4" color="primary.main">{fmt(r.actif, r.montant)} {r.actif}</Typography>
        <Typography variant="body2">{t(`La transaction part sur ${infoReseau(r.reseau).chaine}. Cet écran bascule tout seul ; vous êtes prévenu quand c'est confirmé.`, `The transaction is being sent on ${infoReseau(r.reseau).chaine}. This screen updates automatically; you'll be notified once it's confirmed.`)}</Typography>
      </Box>
      <Button variant="text" component={Link} to="/" replace>{t("Retour à l'accueil", "Back to home")}</Button>
    </Screen>
  );
}
