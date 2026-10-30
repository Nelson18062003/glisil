/*
 * Le Compte : mes informations, mes numéros MoMo, mes paliers, la sécurité,
 * l'accès API, l'aide, les conditions — et, au bout de « Mes informations »,
 * fermer son compte.
 */
import AddRounded from "@mui/icons-material/AddRounded";
import BadgeOutlined from "@mui/icons-material/BadgeOutlined";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import DescriptionOutlined from "@mui/icons-material/DescriptionOutlined";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import PrivacyTipOutlined from "@mui/icons-material/PrivacyTipOutlined";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import KeyRounded from "@mui/icons-material/KeyRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import SendRounded from "@mui/icons-material/SendRounded";
import TranslateRounded from "@mui/icons-material/TranslateRounded";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import UploadFileRounded from "@mui/icons-material/UploadFileRounded";
import VerifiedRounded from "@mui/icons-material/VerifiedRounded";
import WhatsApp from "@mui/icons-material/WhatsApp";
import { Accordion, AccordionDetails, AccordionSummary, Avatar, Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCompte, useDepotsEnAttente, useGuichet, useMesOrdres, useNumeros, useRafraichir, useSoldes } from "../../guichet";
import { CONDITIONS, CONFIDENTIALITE, lienWhatsapp, VERSION_CONDITIONS, type Document } from "../../noyau/conditions";
import { Contact, FeuilleLegale } from "../legal";
import type { IdOperateur, PreuveDeVerification } from "../../guichet/types";
import { CODE_SMS_DEMO } from "../../guichet/demo";
import { BETA, delaiDuNumero, FRAIS, NUMEROS, OPERATEURS, PALIERS, operateur as opDe } from "../../noyau/argent";
import { initiales, jourRelatif, numeroEnTranches, numeroSaisi, numeroValide, operateurDuNumero, pourcent, xaf } from "../../noyau/format";
import { ageAu, paysDe, telephoneLisible } from "../../noyau/identite";
import { langue, t } from "../../noyau/langue";
import { parcours } from "../../navigation/parcours";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { Card, Cases, ChoixDeLangue, Feuille, FeuilleErreur, Icon, Keypad, Line, List, Row, Screen, Squelette } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";
import { EtapeDeVerification } from "../../ui/verification";
import { Actions, Champs, EnTete, Groupes } from "../../ui/formulaire";

/* Le support vient de l'équipe (paramètre « support ») ou de la configuration :
   un numéro écrit en dur ici était un bouche-trou, et les messages des clients
   partaient chez un inconnu. Voir noyau/conditions.ts. */

/** « MTN, Orange · 2 vérifiés » : les opérateurs, puis le nombre */
function resumeNumeros(numeros: { operateur: string; verifieLe: string | null }[]): string {
  const verifies = numeros.filter((n) => n.verifieLe);
  const ops = [...new Set(verifies.map((n) => (n.operateur === "om" ? "Orange" : "MTN")))].join(", ");
  return verifies.length === 0 ? t("Aucun vérifié", "None verified") : t(`${ops} · ${verifies.length} vérifié${verifies.length > 1 ? "s" : ""}`, `${ops} · ${verifies.length} verified`);
}

export function Compte() {
  const session = useSession();
  const { data: compte } = useCompte();
  const { data: numeros } = useNumeros();
  const [lu, setLu] = useState<Document | null>(null);
  const palier = compte ? PALIERS[compte.palier] : null;
  return (
    <Screen tab="compte" title={t("Compte", "Account")}>
      <Stack alignItems="center" gap={1} py={2}>
        <Avatar sx={{ width: 88, height: 88, bgcolor: "primary.main", fontSize: 32, fontWeight: 600 }}>{initiales(compte?.nom)}</Avatar>
        <Typography variant="h6">{compte?.nom ?? "…"}</Typography>
        <Typography variant="body2">{compte?.entreprise ?? telephoneLisible(compte?.telephone ?? "")}</Typography>
        {compte?.email && <Typography variant="body2" sx={{ overflowWrap: "anywhere", textAlign: "center" }}>{compte.email}</Typography>}
        {palier && <Chip icon={<VerifiedRounded />} label={palier.nom} sx={{ bgcolor: tones.green.bg, color: tones.green.fg, "& .MuiChip-icon": { color: tones.green.fg } }} />}
      </Stack>
      <List>
        <Stack direction="row" alignItems="center" gap={1.75} flexWrap="wrap" sx={{ px: 1.5, py: 1.25 }}>
          <Icon tone="blue"><TranslateRounded /></Icon>
          <Typography fontWeight={500} sx={{ flex: 1, minWidth: 0 }}>{t("Langue", "Language")}</Typography>
          <ChoixDeLangue />
        </Stack>
      </List>
      <List>
        <Row icon={<BadgeOutlined />} tone="neutral" primary={t("Mes informations", "My details")} secondary={t("Identité, adresse e-mail, résidence", "Identity, email address, residence")} to="/compte/informations" />
        <Row icon={<PhoneAndroidRounded />} tone="green" primary={t("Mes numéros MoMo", "My MoMo numbers")} secondary={numeros ? resumeNumeros(numeros) : " "} to="/compte/numeros" />
        <Row icon={<VerifiedRounded />} tone="amber" primary={t("Paliers et limites", "Tiers and limits")} secondary={palier && compte ? t(`Palier ${compte.palier} · ${palier.entreeJour === null ? "sans plafond plateforme" : `${xaf(palier.entreeJour)} XAF par jour`}`, `Tier ${compte.palier} · ${palier.entreeJour === null ? "no platform limit" : `${xaf(palier.entreeJour)} XAF per day`}`) : " "} to="/compte/paliers" />
        <Row icon={<ShieldOutlined />} tone="blue" primary={t("Sécurité", "Security")} secondary={t("Mot de passe, application d'authentification, appareils", "Password, authenticator app, devices")} to="/compte/securite" />
        <Row icon={<KeyRounded />} tone="neutral" primary={t("Accès API", "API access")} secondary={t("Pour les desks", "For trading desks")} to="/compte/api" />
        <Row icon={<HelpOutlineRounded />} tone="neutral" primary={t("Aide et support", "Help & support")} secondary={t("Questions fréquentes, nous écrire", "FAQ, contact us")} to="/compte/aide" />
      </List>
      <List>
        <Row icon={<DescriptionOutlined />} tone="neutral" primary={t("Conditions d'utilisation", "Terms of use")} onClick={() => setLu(CONDITIONS)} />
        <Row icon={<PrivacyTipOutlined />} tone="neutral" primary={t("Politique de confidentialité", "Privacy policy")} onClick={() => setLu(CONFIDENTIALITE)} />
      </List>
      <Button variant="text" color="error" startIcon={<LogoutRounded />} onClick={() => void session.deconnecter()}>{t("Se déconnecter", "Sign out")}</Button>
      <FeuilleLegale doc={lu} onFermer={() => setLu(null)} />
      <Typography variant="caption" textAlign="center">Glisil · {import.meta.env.MODE === "production" ? "" : t("mode ", "")}{useGuichet().mode === "demo" ? t("démonstration", "demo mode") : ""}{/* langue-ok : « Glisil » est la marque */}</Typography>
    </Screen>
  );
}

/* ------------------------------------------------------------ numéros */

export function CompteNumeros() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { data: numeros } = useNumeros();
  const [aRetirer, setARetirer] = useState<string | null>(null);
  const cible = numeros?.find((n) => n.id === aRetirer);

  return (
    <Screen title={t("Mes numéros MoMo", "My MoMo numbers")} back="/compte">
      <Typography variant="body2">{t("Les numéros vers lesquels vous pouvez sortir des XAF. Un numéro ajouté devient actif 24 h après sa vérification.", "The numbers you can withdraw XAF to. A newly added number becomes active 24 hours after it is verified.")}</Typography>
      {!numeros ? <Squelette hauteur={160} /> : (
        <List>
          {numeros.map((n) => {
            const actif = Boolean(n.verifieLe) && new Date(n.actifDes).getTime() <= Date.now();
            return <Row key={n.id} badge={n.operateur} primary={numeroEnTranches(n.numero)} secondary={!n.verifieLe ? t(`${opDe(n.operateur).nom} · à vérifier`, `${opDe(n.operateur).nom} · to verify`) : actif ? t(`${opDe(n.operateur).nom} · vérifié`, `${opDe(n.operateur).nom} · verified`) : t(`${opDe(n.operateur).nom} · actif ${jourRelatif(n.actifDes).toLowerCase()}`, `${opDe(n.operateur).nom} · active ${jourRelatif(n.actifDes).toLowerCase()}`)} onClick={() => numeros.length > 1 ? setARetirer(n.id) : undefined} chevron={numeros.length > 1} />;
          })}
          <Row icon={<AddRounded />} tone="green" primary={t("Ajouter un numéro", "Add a number")} to="/compte/numeros/ajouter" />
        </List>
      )}
      <Feuille ouverte={Boolean(aRetirer)} onFermer={() => setARetirer(null)} titre={cible ? t(`Retirer le ${numeroEnTranches(cible.numero)} ?`, `Remove ${numeroEnTranches(cible.numero)}?`) : ""}>
        {aRetirer && (
          <Stack gap={1}>
            <Typography variant="body2">{t("Ce numéro ne pourra plus recevoir de sortie. Confirmez avec vos trois vérifications.", "This number will no longer be able to receive withdrawals. Confirm with your three checks.")}</Typography>
            <EtapeDeVerification
              op={{ operation: "retirer_numero", numeroId: aRetirer }}
              intention={{ retirer: aRetirer }}
              libelle={t("Retirer ce numéro", "Remove this number")}
              executer={async (preuve) => {
                await guichet.retirerNumero({ id: aRetirer, preuve });
                setARetirer(null);
                await rafraichir();
              }}
            />
          </Stack>
        )}
      </Feuille>
    </Screen>
  );
}

export function CompteNumerosAjouter() {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const rafraichir = useRafraichir();
  const [etape, setEtape] = useState<"numero" | "code" | "fait">("numero");
  const [numero, setNumero] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [renvoye, setRenvoye] = useState(false);
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  /* l'opérateur, c'est le numéro qui le dit : un 677 n'est pas un numéro Orange, et le moteur le refuserait */
  const op: IdOperateur | null = operateurDuNumero(numero);
  const retour = parcours.lire().retour ?? "/compte/numeros";

  const ajouter = () =>
    lancer(async () => {
      const n = await guichet.ajouterNumero({ operateur: op!, numero: numeroSaisi(numero) });
      setId(n.id);
      /* sans code SMS (0020), le moteur rend le numéro déjà retenu : pas d'écran de code */
      if (n.verifieLe) { await rafraichir(); setEtape("fait"); } else setEtape("code");
    });
  const confirmer = (c: string) =>
    lancer(async () => {
      try { await guichet.confirmerNumero({ id: id!, code: c }); await rafraichir(); setEtape("fait"); }
      catch (e) {
        setCode("");
        /* Un code faux se dit sous les cases, et c'est tout : relancé, il restait en erreur « en attente »,
           et la touche suivante (qui efface « faux ») faisait surgir sa feuille par-dessus le pavé.
           Un code expiré, ou un numéro pris entre-temps, se dit en feuille, tel quel. */
        if (e instanceof Error && e.message.toLowerCase().startsWith("code sms incorrect")) { setFaux(true); return; }
        throw e;
      }
    });
  const renvoyer = () =>
    lancer(async () => {
      await guichet.renvoyerCodeNumero(id!);
      setFaux(false); setCode(""); setRenvoye(true);
      window.setTimeout(() => setRenvoye(false), 60_000);
    });
  const touche = (k: string) => {
    setFaux(false);
    const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 6);
    setCode(suite);
    if (suite.length === 6) void confirmer(suite);
  };

  if (etape === "fait") {
    return (
      <Screen title={t("Numéro ajouté", "Number added")} back={retour}>
        <Card>
          <Line label={t("Numéro", "Number")} value={numeroEnTranches(numero)} />
          <Line label={t("Opérateur", "Operator")} value={op ? opDe(op).nom : ""} />
          <Line label={t("Actif", "Active")} value={delaiDuNumero()} strong />
        </Card>
        {NUMEROS.delaiHeures > 0 && <Typography variant="body2" textAlign="center">{t("Ce délai protège votre argent : un numéro ajouté par quelqu'un d'autre ne peut pas recevoir une sortie tout de suite.", "This delay protects your money: a number added by someone else cannot receive a withdrawal right away.")}</Typography>}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => { parcours.poserRetour(null); navigate(retour, { replace: true }); }}>{t("Compris", "Got it")}</Button>
      </Screen>
    );
  }

  if (etape === "code") {
    return (
      <Screen title={t("Code reçu sur ce numéro", "Code sent to this number")} onBack={() => setEtape("numero")} gap={1.5}>
        <Typography variant="body2">{t(`Un SMS a été envoyé au ${numeroEnTranches(numero)} : c'est la preuve que ce numéro est à vous.`, `An SMS was sent to ${numeroEnTranches(numero)}: it proves this number is yours.`)}{guichet.mode === "demo" ? t(` Démonstration : ${CODE_SMS_DEMO}.`, ` Demo: ${CODE_SMS_DEMO}.`) : ""}</Typography>
        <Cases longueur={6} valeur={code} erreur={faux} />
        {faux && <Typography variant="body2" color="error" textAlign="center">{t("Ce code n'est pas le bon.", "This code is incorrect.")}</Typography>}
        <Button variant="text" disabled={renvoye || enCours} onClick={() => void renvoyer()} sx={{ alignSelf: "center" }}>
          {renvoye ? t("Nouveau code envoyé", "New code sent") : t("Renvoyer le code", "Resend the code")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Keypad onKey={touche} triple={null} />
        <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
      </Screen>
    );
  }

  return (
    <Screen title={t("Ajouter un numéro", "Add a number")} back={retour}>
      <TextField label={t("Numéro MoMo", "MoMo number")} value={numeroEnTranches(numero)} onChange={(e) => setNumero(numeroSaisi(e.target.value))} type="tel" inputMode="numeric" fullWidth autoFocus
        slotProps={{ input: { startAdornment: <Typography sx={{ mr: 1, color: "text.secondary" }}>+237</Typography>, sx: { fontSize: 22, fontVariantNumeric: "tabular-nums" } } }} />
      <Typography variant="body2">{t("Opérateur", "Operator")}</Typography>
      <List>
        {OPERATEURS.map((o) => <Row key={o.id} badge={o.id} primary={o.nom} secondary={op === o.id ? t("d'après le numéro", "based on the number") : undefined} selected={op === o.id} chevron={false} />)}
      </List>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!numeroValide(numero) || !op || enCours} onClick={() => void ajouter()}>{NUMEROS.verificationSms ? (enCours ? t("Envoi du SMS…", "Sending SMS…") : t("Recevoir le code", "Get the code")) : (enCours ? "…" : t("Ajouter ce numéro", "Add this number"))}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/* ------------------------------------------------------------ paliers */

export function ComptePaliers() {
  const { data: compte } = useCompte();
  const navigate = useNavigate();
  if (!compte) return <Screen title={t("Paliers et limites", "Tiers and limits")} back="/compte"><Squelette hauteur={260} /></Screen>;
  return (
    <Screen title={t("Paliers et limites", "Tiers and limits")} back="/compte">
      <Typography variant="body2">{t("Vous êtes au ", "You are on ")}<b>{t(`palier ${compte.palier}`, `tier ${compte.palier}`)}</b>{t(". Chaque palier ouvre des plafonds plus larges ; au-delà du palier 2, la plateforme n'en pose plus.", ". Each tier unlocks higher limits; beyond tier 2, the platform sets none.")}</Typography>
      <List>
        {[0, 1, 2].map((p) => {
          const d = PALIERS[p];
          const actuel = p === compte.palier;
          return (
            <Stack key={p} direction="row" alignItems="center" gap={1.5} sx={{ px: 1.5, py: 1.25, borderRadius: 4, bgcolor: actuel ? tones.green.bg : "transparent" }}>
              <Avatar sx={{ bgcolor: actuel ? tones.green.fg : tones.neutral.bg, color: actuel ? "#fff" : tones.neutral.fg, fontWeight: 700 }}>{p}</Avatar>
              <Stack sx={{ flex: 1 }}>
                <Typography fontWeight={500}>{d.nom.split(" · ")[1].replace(/^./, (c) => c.toUpperCase())}</Typography>
                <Typography variant="body2">{d.entreeJour === null ? t("Sans plafond plateforme", "No platform limit") : t(`${xaf(d.entreeJour)} XAF par jour, en entrée comme en sortie`, `${xaf(d.entreeJour)} XAF per day, for deposits and withdrawals alike`)}</Typography>
              </Stack>
              {actuel && <Chip label={t("Vous", "You")} size="small" sx={{ bgcolor: tones.green.fg, color: "#fff" }} />}
            </Stack>
          );
        })}
      </List>
      {compte.verificationEnCours && (
        <Card sx={{ bgcolor: tones.blue.bg, color: tones.blue.fg }}>
          <Typography fontWeight={600} sx={{ color: "inherit" }}>{t("Vérification en cours", "Verification in progress")}</Typography>
          <Typography variant="body2" sx={{ color: "inherit" }}>{compte.verificationEnCours === "identite"
            ? t("L'équipe examine vos pièces (identité), en général sous 24 h ouvrées.", "The team is reviewing your documents (identity), usually within 24 business hours.")
            : t("L'équipe examine vos pièces (entreprise), en général sous 24 h ouvrées.", "The team is reviewing your documents (company), usually within 24 business hours.")}</Typography>
        </Card>
      )}
      <Box sx={{ flex: 1 }} />
      {!compte.verificationEnCours && compte.palier < 1 && <Button variant="contained" onClick={() => navigate("/compte/paliers/identite")}>{t("Vérifier mon identité", "Verify my identity")}</Button>}
      {!compte.verificationEnCours && compte.palier < 2 && <Button variant={compte.palier < 1 ? "outlined" : "contained"} onClick={() => navigate("/compte/paliers/entreprise")}>{t("Vérifier mon entreprise", "Verify my company")}</Button>}
    </Screen>
  );
}

function Pieces({ type, titre, pieces }: { type: "identite" | "entreprise"; titre: string; pieces: { cle: string; label: string; aide: string }[] }) {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const rafraichir = useRafraichir();
  const [fichiers, setFichiers] = useState<Record<string, File>>({});
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const complet = pieces.every((p) => fichiers[p.cle]);
  const envoyer = () => lancer(async () => { await guichet.demanderVerification({ type, pieces: pieces.map((p) => fichiers[p.cle]) }); await rafraichir(); navigate("/compte/paliers", { replace: true }); });
  return (
    <Screen title={titre} back="/compte/paliers">
      <Typography variant="body2">{t("Des photos nettes, lisibles, sans reflet. 10 Mo au plus par pièce. Elles ne servent qu'à cette vérification.", "Sharp, readable photos with no glare. 10 MB max per document. They are used only for this verification.")}</Typography>
      <List>
        {pieces.map((p) => (
          <Stack key={p.cle} component="label" direction="row" alignItems="center" gap={1.5} sx={{ px: 1.5, py: 1.25, borderRadius: 4, cursor: "pointer" }}>
            <Avatar sx={{ bgcolor: fichiers[p.cle] ? tones.green.bg : tones.neutral.bg, color: fichiers[p.cle] ? tones.green.fg : tones.neutral.fg }}>{fichiers[p.cle] ? <VerifiedRounded /> : <UploadFileRounded />}</Avatar>
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={500}>{p.label}</Typography>
              <Typography variant="body2" noWrap>{fichiers[p.cle]?.name ?? p.aide}</Typography>
            </Stack>
            <input type="file" accept="image/*,.pdf" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size <= 10 * 1024 * 1024) setFichiers((x) => ({ ...x, [p.cle]: f })); }} />
          </Stack>
        ))}
      </List>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!complet || enCours} onClick={() => void envoyer()}>{enCours ? t("Envoi…", "Sending…") : t("Envoyer pour vérification", "Submit for verification")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

export function ComptePaliersIdentite() {
  return <Pieces type="identite" titre={t("Vérifier mon identité", "Verify my identity")} pieces={[
    { cle: "recto", label: t("Pièce d'identité, recto", "ID document, front"), aide: t("CNI, passeport ou récépissé", "National ID card, passport or receipt of application") },
    { cle: "verso", label: t("Pièce d'identité, verso", "ID document, back"), aide: t("ou la page suivante du passeport", "or the next page of the passport") },
    { cle: "selfie", label: t("Selfie avec la pièce", "Selfie with the document"), aide: t("votre visage et la pièce, nets", "your face and the document, both sharp") },
  ]} />;
}

export function ComptePaliersEntreprise() {
  return <Pieces type="entreprise" titre={t("Vérifier mon entreprise", "Verify my company")} pieces={[
    { cle: "rccm", label: t("Registre du commerce (RCCM)", "Trade register (RCCM)"), aide: t("l'extrait de moins de trois mois", "an extract less than three months old") },
    { cle: "niu", label: t("Attestation d'immatriculation (NIU)", "Tax registration certificate (NIU)"), aide: t("carte de contribuable", "taxpayer card") },
    { cle: "gerant", label: t("Pièce d'identité du gérant", "Manager's ID document"), aide: t("recto et verso sur une image", "front and back in one image") },
  ]} />;
}

/* ----------------------------------------------------------- sécurité */

export { CompteSecurite } from "./securite";

/* ---------------------------------------------------------- API, aide */

export function CompteApi() {
  return (
    <Screen title={t("Accès API", "API access")} back="/compte">
      <Card>
        <Typography fontWeight={600}>{t("Pour les desks et les gros apporteurs de liquidité", "For trading desks and large liquidity providers")}</Typography>
        <Typography variant="body2">{t("Placer et annuler des ordres, lire le carnet et vos soldes depuis vos propres outils, recevoir un webhook à chaque exécution et à chaque dépôt crédité.", "Place and cancel orders, read the order book and your balances from your own tools, and receive a webhook for every fill and every credited deposit.")}</Typography>
        <Line label={t("État", "Status")} value={t("En préparation", "In preparation")} />
        <Line label={t("Ouverture", "Availability")} value={t("Avec le palier 2", "With tier 2")} />
      </Card>
      <Typography variant="body2">{t("Les clés se créeront ici, avec leurs droits (lecture seule, ordres, retraits) et leur adresse IP autorisée. Rien à faire aujourd'hui : dites-nous ce dont vous avez besoin.", "Keys will be created here, with their permissions (read-only, orders, withdrawals) and their allowed IP address. Nothing to do today: tell us what you need.")}</Typography>
      <Box sx={{ flex: 1 }} />
      <Contact sujet={t("Accès API Glisil", "Glisil API access")} texte={t("Bonjour, je souhaite un accès API pour mon desk.", "Hello, I would like API access for my desk.")} />
    </Screen>
  );
}

/* une fonction, pas une constante : les frais se lisent au moment d'afficher, après les paramètres de l'équipe */
const faq = (): [string, string][] => [
  [t("Combien de temps pour être crédité ?", "How long until I'm credited?"),
    t("Dès que TOTEM lit le SMS de votre paiement, en général moins de 10 secondes après que vous avez tapé le transaction ID. Si le SMS arrive après, votre ID attend et se crédite tout seul.",
      "As soon as TOTEM reads the SMS for your payment, usually less than 10 seconds after you enter the transaction ID. If the SMS arrives later, your ID waits and is credited automatically.")],
  [t("Pourquoi un transaction ID ?", "Why a transaction ID?"),
    t("MTN et Orange en donnent un à chaque opération, et le même ID est dans le SMS que notre float reçoit. C'est la preuve la plus simple et la plus sûre : pas de capture d'écran, pas de montant à taper.",
      "MTN and Orange give one for every transaction, and the same ID appears in the SMS our float receives. It's the simplest and safest proof: no screenshot, no amount to type.")],
  [t("Un XAFe vaut toujours 1 XAF ?", "Is one XAFe always worth 1 XAF?"),
    t("Oui. Un XAFe n'est créé que quand un XAF est reçu, et détruit quand un XAF est envoyé. Les réserves sont sur nos floats MoMo et nos comptes en banque.",
      "Yes. An XAFe is created only when an XAF is received, and destroyed when an XAF is paid out. The reserves are held on our MoMo floats and in our bank accounts.")],
  [t("Que coûte une sortie ?", "How much does a withdrawal cost?"), FRAIS.sortie <= 0
    ? t("Rien pour le moment : vous recevez exactement le montant de votre sortie. La sortie part en plusieurs transferts si elle dépasse le plafond de l'opérateur ; vous les voyez tous.",
        "Nothing for now: you receive exactly the amount you withdraw. The withdrawal is split into several transfers if it exceeds the operator's limit; you see all of them.")
    : t(`${pourcent(FRAIS.sortie)} du montant, arrondis au franc supérieur par transfert. Au-delà du plafond de l'opérateur, la sortie part en plusieurs transferts ; vous les voyez tous.`,
        `${pourcent(FRAIS.sortie)} of the amount, rounded up to the nearest franc per transfer. Above the operator's limit, the withdrawal is split into several transfers; you see all of them.`)],
  [t("J'ai changé mon mot de passe : pourquoi ne puis-je plus retirer ?", "I changed my password: why can't I withdraw?"),
    t("Après un changement de mot de passe ou d'application d'authentification, les retraits sont en pause pendant 24 heures. Si quelqu'un d'autre a pris votre compte, il n'a pas le temps de le vider, et vous avez reçu un e-mail pour nous prévenir. Vos dépôts et le marché restent ouverts.",
      "After a password or authenticator app change, withdrawals are paused for 24 hours. If someone else took over your account, they don't have time to empty it, and you received an email so you can warn us. Deposits and trading stay open.")],
  [t("Comment changer mon adresse e-mail ?", "How do I change my email address?"),
    t("Pour votre sécurité, l'adresse e-mail d'un compte ne se change pas seule dans l'application : c'est elle qui reçoit vos codes et vos alertes. Écrivez au support depuis votre adresse actuelle ; si vous n'y avez plus accès, l'équipe vérifie d'abord votre identité (appel vidéo, pièce d'identité).",
      "For your security, an account's email address can't be changed alone in the app: it receives your codes and your alerts. Contact support from your current address; if you can no longer access it, the team first verifies your identity (video call, ID document).")],
  [t("Un transfert a échoué, où est mon argent ?", "A transfer failed. Where is my money?"),
    t("Après trois essais, les XAFe de ce transfert reviennent en disponible sur votre compte. Le détail de l'opération le dit, et vous êtes prévenu.",
      "After three attempts, the XAFe from that transfer return to your available balance. The transaction details show it, and you are notified.")],
  // le délai d'un numéro neuf est un réglage de l'équipe (0020) : la question n'existe que s'il y en a un
  ...(NUMEROS.delaiHeures > 0 ? [[t(`Pourquoi attendre ${NUMEROS.delaiHeures} h pour un nouveau numéro ?`, `Why wait ${NUMEROS.delaiHeures} hours for a new number?`),
    t("Pour que personne qui aurait pris votre téléphone ne puisse vider votre compte vers son propre numéro dans la minute.", "So that anyone who takes your phone cannot empty your account to their own number within a minute.")] as [string, string]] : []),
  ...(BETA.actif ? [[t("Qu'est-ce que la bêta ?", "What is the Beta?"),
    t("Glisil se teste en grand avant d'ouvrir pour de vrai. Tout l'argent ici est de l'argent de test, offert à l'inscription : il ne vaut rien hors de Glisil, et les dépôts et retraits réels sont fermés. Le marché est animé par des robots qui suivent le vrai cours du dollar. Achetez, vendez, essayez tout — et dites-nous ce qui coince, juste en dessous.",
      "Glisil is being tested at scale before it opens for real. All the money here is test money, given when you sign up: it has no value outside Glisil, and real deposits and withdrawals are closed. The market is run by bots that follow the real dollar rate. Buy, sell, try everything — and tell us what doesn't work, just below.")] as [string, string]] : []),
];

export function CompteAide() {
  const [params] = useSearchParams();
  const ref = params.get("ref") ?? "";
  /* l'écran d'où l'on vient (« Signaler » du bandeau bêta) : un indice pour l'équipe, rien de plus */
  const depuis = params.get("depuis");
  const { data: compte } = useCompte();
  const guichet = useGuichet();
  const [texte, setTexte] = useState(ref ? t(`Référence ${ref} : `, `Reference ${ref}: `) : "");
  const [recu, setRecu] = useState<string | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const qui = `${compte?.nom ?? ""} (${telephoneLisible(compte?.telephone ?? "")}${compte?.email ? ` · ${compte.email}` : ""})`;
  const lien = lienWhatsapp(`${qui} · ${texte}`);
  const envoyer = () => lancer(async () => {
    const r = await guichet.signalerUnProbleme({ texte, ecran: depuis && depuis.startsWith("/") ? depuis : "/compte/aide" });
    setRecu(r.reference); setTexte("");
  });
  return (
    <Screen title={t("Aide", "Help")} back="/compte">
      <Box>
        {faq().map(([q, r]) => (
          <Accordion key={q} disableGutters sx={{ bgcolor: "background.paper", "&:before": { display: "none" }, borderRadius: "16px !important", mb: 1, overflow: "hidden" }}>
            <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography fontWeight={500}>{q}</Typography></AccordionSummary>
            <AccordionDetails><Typography variant="body2">{r}</Typography></AccordionDetails>
          </Accordion>
        ))}
      </Box>
      <Groupes sx={{ mt: 1 }}>
      <EnTete variante="subtitle1" titre={t("Signaler un problème", "Report a problem")}
        texte={t("Dites ce qui s'est passé ; gardez la référence de l'opération (XAFe-…) si vous l'avez. Personne chez Glisil ne vous demandera votre mot de passe ni vos codes.", "Tell us what happened; include the transaction reference (XAFe-…) if you have it. No one at Glisil will ever ask for your password or your codes.")} />
      <Champs>
      <TextField label={t("Ce qui s'est passé", "What happened")} value={texte} onChange={(e) => { setTexte(e.target.value); setRecu(null); }} fullWidth multiline minRows={3} inputProps={{ maxLength: 2000 }} />
      {recu && (
        <Stack direction="row" gap={1} alignItems="center" role="status" data-signalement-recu
          sx={{ p: 1.5, borderRadius: 4, bgcolor: tones.green.bg, color: tones.green.fg }}>
          <CheckCircleRounded fontSize="small" />
          <Typography variant="body2" sx={{ color: "inherit" }}>{t(`Reçu (${recu}) : l'équipe le lit et revient vers vous si besoin. Merci !`, `Received (${recu}): the team will read it and get back to you if needed. Thank you!`)}</Typography>
        </Stack>
      )}
      <Actions>
        <Button variant="contained" startIcon={<SendRounded />} onClick={() => void envoyer()} disabled={enCours || texte.trim().length < 5}>
          {enCours ? t("Envoi…", "Sending…") : t("Envoyer à l'équipe Glisil", "Send to the Glisil team")}
        </Button>
        {lien
          ? <Button variant="outlined" startIcon={<WhatsApp />} href={lien} target="_blank" rel="noopener" disabled={texte.trim().length < 5}>{t("Envoyer sur WhatsApp", "Send on WhatsApp")}</Button>
          : null}
      </Actions>
      </Champs>
      </Groupes>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
      <Contact sujet={ref ? t(`Problème · ${ref}`, `Problem · ${ref}`) : t("Un problème avec Glisil", "A problem with Glisil")} texte={`${qui}\n\n${texte}`} />
      <Typography variant="caption" textAlign="center">{t("L'équipe répond de 8 h à 20 h, sept jours sur sept.", "The team answers from 8 am to 8 pm, seven days a week.")}</Typography>
    </Screen>
  );
}

/* ------------------------------------------------- mes informations */

const dateLongue = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(langue() === "en" ? "en-US" : "fr-FR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Ce que Glisil sait de vous, tel que la base le garde. En lecture seule :
 * ce sont les informations qui servent à vérifier votre identité, et une
 * correction passe par le support (qui peut demander une pièce).
 */
export function CompteInformations() {
  const { data: compte } = useCompte();
  return (
    <Screen title={t("Mes informations", "My details")} back="/compte">
      {!compte ? <Squelette hauteur={280} /> : (
        <>
          <Card>
            <Line label={t("Prénom", "First name")} value={compte.prenom ?? "—"} />
            <Line label={t("Nom", "Last name")} value={compte.nomDeFamille ?? "—"} />
            <Line label={t("Date de naissance", "Date of birth")} value={compte.dateNaissance ? t(`${dateLongue(compte.dateNaissance)} · ${ageAu(compte.dateNaissance)} ans`, `${dateLongue(compte.dateNaissance)} · ${ageAu(compte.dateNaissance)} years old`) : "—"} />
            <Line label={t("Adresse e-mail", "Email address")} value={<Box component="span" sx={{ overflowWrap: "anywhere" }}>{compte.email ?? "—"}</Box>} />
            <Line label={t("Téléphone", "Phone")} value={telephoneLisible(compte.telephone)} />
            <Line label={t("Résidence", "Residence")} value={[compte.ville, compte.pays ? paysDe(compte.pays)?.nom ?? compte.pays : null].filter(Boolean).join(", ") || "—"} />
            {compte.entreprise && <Line label={t("Entreprise", "Company")} value={compte.entreprise} />}
          </Card>
          <Typography variant="body2">
            {t("Ces informations servent à vérifier votre identité : elles ne se modifient pas ici. Une erreur, un déménagement, un nouveau numéro ? Écrivez au support, il vous dira quoi envoyer.",
              "This information is used to verify your identity: it cannot be changed here. A mistake, a move, a new number? Contact support and they will tell you what to send.")}
          </Typography>
          <Contact sujet={t("Corriger mes informations", "Correct my details")} texte={compte.email ?? ""} />
          <Typography variant="caption">{t(`Conditions acceptées : version du ${dateLongue(VERSION_CONDITIONS)}.`, `Terms accepted: version of ${dateLongue(VERSION_CONDITIONS)}.`)}</Typography>
          <Box sx={{ flex: 1 }} />
          <Button component={Link} to="/compte/fermer" variant="text" color="error">{t("Fermer mon compte", "Close my account")}</Button>
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------- fermer mon compte */

/* La clé est la phrase française : c'est elle qui part à l'équipe (motif), quelle que soit la langue de l'écran.
   Une fonction, pas une constante : l'étiquette se lit dans la langue de l'écran. */
const motifs = (): { cle: string; label: string }[] => [
  { cle: "Je n'en ai plus besoin", label: t("Je n'en ai plus besoin", "I no longer need it") }, // langue-ok
  { cle: "Les frais", label: t("Les frais", "The fees") }, // langue-ok
  { cle: "Un problème avec l'application", label: t("Un problème avec l'application", "A problem with the app") }, // langue-ok
  { cle: "Je préfère un autre service", label: t("Je préfère un autre service", "I prefer another service") }, // langue-ok
  { cle: "Autre raison", label: t("Autre raison", "Other reason") }, // langue-ok
];

/**
 * Fermer son compte, en trois temps : ce qu'il faut d'abord (argent sorti,
 * rien en cours — chaque point dit où aller le régler), ce que fermer veut
 * dire, puis la vérification (application, mot de passe, code e-mail).
 * La base revérifie tout (fermer_mon_compte).
 */
export function CompteFermer() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { data: soldes } = useSoldes();
  const { data: ordres } = useMesOrdres();
  const { data: depots } = useDepotsEnAttente();
  const [motif, setMotif] = useState<string | null>(null);
  const [demander, setDemander] = useState(false);

  const charge = Boolean(soldes && ordres && depots);
  const tout = (x: "XAFe" | "USDT" | "USDC") => (soldes ? soldes[x].disponible + soldes[x].bloque : 0);
  const dollars = tout("USDT") + tout("USDC");
  const argent = soldes ? tout("XAFe") > 0 || dollars > 0 : true;
  const ordresOuverts = (ordres ?? []).filter((o) => o.etat === "ouvert" || o.etat === "partiel").length;
  const enAttente = (depots ?? []).length;
  const points: { ok: boolean; texte: string; vers?: { label: string; to: string } }[] = [
    { ok: !argent, texte: argent && soldes ? t(`Il reste ${xaf(tout("XAFe"))} XAFe, ${tout("USDT").toFixed(2)} USDT et ${tout("USDC").toFixed(2)} USDC`, `${xaf(tout("XAFe"))} XAFe, ${tout("USDT").toFixed(2)} USDT and ${tout("USDC").toFixed(2)} USDC remaining`) : t("Votre solde est à zéro", "Your balance is zero"), vers: argent ? { label: t("Sortir", "Withdraw"), to: soldes && dollars > 0 ? "/crypto" : "/sortir/montant" } : undefined },
    { ok: ordresOuverts === 0, texte: ordresOuverts ? t(`${ordresOuverts} ordre${ordresOuverts > 1 ? "s" : ""} encore ouvert${ordresOuverts > 1 ? "s" : ""}`, `${ordresOuverts} order${ordresOuverts > 1 ? "s" : ""} still open`) : t("Aucun ordre ouvert", "No open orders"), vers: ordresOuverts ? { label: t("Voir", "View"), to: "/marche/ordres" } : undefined },
    { ok: enAttente === 0, texte: enAttente ? t("Un dépôt attend encore son paiement", "A deposit is still awaiting payment") : t("Aucun dépôt en attente", "No pending deposits"), vers: enAttente ? { label: t("Voir", "View"), to: "/historique" } : undefined },
  ];
  const pret = charge && points.every((p) => p.ok);

  const fermer = async (preuve: PreuveDeVerification) => {
    await guichet.fermerCompte({ motif: motif ?? "", preuve });
    await rafraichir(); /* la garde voit le compte fermé et montre l'écran qui le dit */
  };

  return (
    <Screen title={t("Fermer mon compte", "Close my account")} back="/compte/informations">
      <Typography variant="subtitle1">{t("D'abord", "First")}</Typography>
      {!charge ? <Squelette hauteur={160} /> : (
        <List>
          {points.map((p) => (
            <Stack key={p.texte} direction="row" alignItems="center" gap={1.5} sx={{ px: 1.5, py: 1.25 }}>
              {p.ok ? <CheckCircleRounded sx={{ color: "primary.main" }} /> : <ErrorOutlineRounded sx={{ color: "secondary.main" }} />}
              <Typography sx={{ flex: 1 }}>{p.texte}</Typography>
              {p.vers && <Button component={Link} to={p.vers.to} size="small" variant="outlined">{p.vers.label}</Button>}
            </Stack>
          ))}
        </List>
      )}
      <Typography variant="subtitle1">{t("Ce que fermer veut dire", "What closing means")}</Typography>
      <Card>
        <Typography variant="body2">{t("· Vous ne pourrez plus entrer, sortir ni échanger d'argent avec ce compte.", "· You will no longer be able to add, withdraw or exchange money with this account.")}</Typography>
        <Typography variant="body2">{t("· La loi nous oblige à garder la trace de vos opérations et de votre identité pendant plusieurs années ; elles ne servent plus à rien d'autre.", "· The law requires us to keep records of your transactions and identity for several years; they are used for nothing else.")}</Typography>
        <Typography variant="body2">{t("· Pour rouvrir le compte, il suffira d'écrire au support depuis votre adresse e-mail.", "· To reopen the account, just contact support from your email address.")}</Typography>
      </Card>
      <Typography variant="subtitle1">{t("Pourquoi partez-vous ? ", "Why are you leaving? ")}<Typography component="span" variant="body2">{t("(facultatif)", "(optional)")}</Typography></Typography>
      <Stack direction="row" gap={1} flexWrap="wrap">
        {motifs().map(({ cle, label }) => <Chip key={cle} label={label} onClick={() => setMotif(motif === cle ? null : cle)} color={motif === cle ? "primary" : "default"} variant={motif === cle ? "filled" : "outlined"} />)}
      </Stack>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" color="error" disabled={!pret} onClick={() => setDemander(true)}>{t("Fermer mon compte", "Close my account")}</Button>
      {charge && !pret && <Typography variant="caption" textAlign="center">{t("Réglez d'abord les points ci-dessus.", "Resolve the points above first.")}</Typography>}
      <Feuille ouverte={demander} onFermer={() => setDemander(false)} titre={t("Confirmer la fermeture", "Confirm closing")}>
        {demander && (
          <EtapeDeVerification op={{ operation: "fermer_compte" }} intention={{ fermer: true }}
            resume={<Typography variant="body2">{t("Le compte sera fermé tout de suite.", "The account will be closed immediately.")}</Typography>}
            libelle={t("Fermer mon compte", "Close my account")}
            executer={(preuve) => fermer(preuve)} />
        )}
      </Feuille>
    </Screen>
  );
}
