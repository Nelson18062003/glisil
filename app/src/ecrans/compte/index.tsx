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
import LockResetRounded from "@mui/icons-material/LockResetRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import SendRounded from "@mui/icons-material/SendRounded";
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
import type { IdOperateur } from "../../guichet/types";
import { CODE_SMS_DEMO } from "../../guichet/demo";
import { BETA, delaiDuNumero, FRAIS, NUMEROS, OPERATEURS, PALIERS, operateur as opDe } from "../../noyau/argent";
import { initiales, jourRelatif, numeroEnTranches, numeroSaisi, numeroValide, operateurDuNumero, pourcent, xaf } from "../../noyau/format";
import { ageAu, paysDe, telephoneLisible } from "../../noyau/identite";
import { parcours } from "../../navigation/parcours";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { Card, Cases, Feuille, FeuilleErreur, Keypad, Line, List, Points, Row, Screen, Squelette } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

/* Le support vient de l'équipe (paramètre « support ») ou de la configuration :
   un numéro écrit en dur ici était un bouche-trou, et les messages des clients
   partaient chez un inconnu. Voir noyau/conditions.ts. */

/** « MTN, Orange · 2 vérifiés » : les opérateurs, puis le nombre */
function resumeNumeros(numeros: { operateur: string; verifieLe: string | null }[]): string {
  const verifies = numeros.filter((n) => n.verifieLe);
  const ops = [...new Set(verifies.map((n) => (n.operateur === "om" ? "Orange" : "MTN")))].join(", ");
  return verifies.length === 0 ? "Aucun vérifié" : `${ops} · ${verifies.length} vérifié${verifies.length > 1 ? "s" : ""}`;
}

export function Compte() {
  const session = useSession();
  const { data: compte } = useCompte();
  const { data: numeros } = useNumeros();
  const [lu, setLu] = useState<Document | null>(null);
  const palier = compte ? PALIERS[compte.palier] : null;
  return (
    <Screen tab="compte" title="Compte">
      <Stack alignItems="center" gap={1} py={2}>
        <Avatar sx={{ width: 88, height: 88, bgcolor: "primary.main", fontSize: 32, fontWeight: 600 }}>{initiales(compte?.nom)}</Avatar>
        <Typography variant="h6">{compte?.nom ?? "…"}</Typography>
        <Typography variant="body2">{compte?.entreprise ?? telephoneLisible(compte?.telephone ?? "")}</Typography>
        {compte?.email && <Typography variant="body2" sx={{ overflowWrap: "anywhere", textAlign: "center" }}>{compte.email}</Typography>}
        {palier && <Chip icon={<VerifiedRounded />} label={palier.nom} sx={{ bgcolor: tones.green.bg, color: tones.green.fg, "& .MuiChip-icon": { color: tones.green.fg } }} />}
      </Stack>
      <List>
        <Row icon={<BadgeOutlined />} tone="neutral" primary="Mes informations" secondary="Identité, adresse e-mail, résidence" to="/compte/informations" />
        <Row icon={<PhoneAndroidRounded />} tone="green" primary="Mes numéros MoMo" secondary={numeros ? resumeNumeros(numeros) : " "} to="/compte/numeros" />
        <Row icon={<VerifiedRounded />} tone="amber" primary="Paliers et limites" secondary={palier && compte ? `Palier ${compte.palier} · ${palier.entreeJour === null ? "sans plafond plateforme" : `${xaf(palier.entreeJour)} XAF par jour`}` : " "} to="/compte/paliers" />
        <Row icon={<ShieldOutlined />} tone="blue" primary="Sécurité" secondary="Code secret, appareils" to="/compte/securite" />
        <Row icon={<KeyRounded />} tone="neutral" primary="Accès API" secondary="Pour les desks" to="/compte/api" />
        <Row icon={<HelpOutlineRounded />} tone="neutral" primary="Aide et support" secondary="Questions fréquentes, nous écrire" to="/compte/aide" />
      </List>
      <List>
        <Row icon={<DescriptionOutlined />} tone="neutral" primary="Conditions d'utilisation" onClick={() => setLu(CONDITIONS)} />
        <Row icon={<PrivacyTipOutlined />} tone="neutral" primary="Politique de confidentialité" onClick={() => setLu(CONFIDENTIALITE)} />
      </List>
      <Button variant="text" color="error" startIcon={<LogoutRounded />} onClick={() => void session.deconnecter()}>Se déconnecter</Button>
      <FeuilleLegale doc={lu} onFermer={() => setLu(null)} />
      <Typography variant="caption" textAlign="center">Glisil · {import.meta.env.MODE === "production" ? "" : "mode "}{useGuichet().mode === "demo" ? "démonstration" : ""}</Typography>
    </Screen>
  );
}

/* ------------------------------------------------------------ numéros */

export function CompteNumeros() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { data: numeros } = useNumeros();
  const [aRetirer, setARetirer] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { lancer, erreur, effacerErreur } = useGesteUnique();

  const retirer = (c: string) =>
    lancer(async () => {
      if (!aRetirer) return;
      await guichet.retirerNumero({ id: aRetirer, codeSecret: c });
      setARetirer(null); setCode("");
      await rafraichir();
    });
  const touche = (k: string) => {
    const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 4);
    setCode(suite);
    if (suite.length === 4) void retirer(suite);
  };
  const cible = numeros?.find((n) => n.id === aRetirer);

  return (
    <Screen title="Mes numéros MoMo" back="/compte">
      <Typography variant="body2">Les numéros vers lesquels vous pouvez sortir des XAF. Un numéro ajouté devient actif 24 h après sa vérification.</Typography>
      {!numeros ? <Squelette hauteur={160} /> : (
        <List>
          {numeros.map((n) => {
            const actif = Boolean(n.verifieLe) && new Date(n.actifDes).getTime() <= Date.now();
            return <Row key={n.id} badge={n.operateur} primary={numeroEnTranches(n.numero)} secondary={!n.verifieLe ? `${opDe(n.operateur).nom} · à vérifier` : actif ? `${opDe(n.operateur).nom} · vérifié` : `${opDe(n.operateur).nom} · actif ${jourRelatif(n.actifDes).toLowerCase()}`} onClick={() => numeros.length > 1 ? setARetirer(n.id) : undefined} chevron={numeros.length > 1} />;
          })}
          <Row icon={<AddRounded />} tone="green" primary="Ajouter un numéro" to="/compte/numeros/ajouter" />
        </List>
      )}
      <Feuille ouverte={Boolean(aRetirer)} onFermer={() => { setARetirer(null); setCode(""); }} titre={cible ? `Retirer le ${numeroEnTranches(cible.numero)} ?` : ""}>
        <Stack gap={1}>
          <Typography variant="body2">Votre code secret pour confirmer. Ce numéro ne pourra plus recevoir de sortie.</Typography>
          <Points longueur={4} saisis={code.length} />
          <Keypad onKey={touche} triple={null} />
        </Stack>
      </Feuille>
      <FeuilleErreur erreur={erreur} onFermer={() => { effacerErreur(); setCode(""); }} />
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
      <Screen title="Numéro ajouté" back={retour}>
        <Card>
          <Line label="Numéro" value={numeroEnTranches(numero)} />
          <Line label="Opérateur" value={op ? opDe(op).nom : ""} />
          <Line label="Actif" value={delaiDuNumero()} strong />
        </Card>
        {NUMEROS.delaiHeures > 0 && <Typography variant="body2" textAlign="center">Ce délai protège votre argent : un numéro ajouté par quelqu'un d'autre ne peut pas recevoir une sortie tout de suite.</Typography>}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => { parcours.poserRetour(null); navigate(retour, { replace: true }); }}>Compris</Button>
      </Screen>
    );
  }

  if (etape === "code") {
    return (
      <Screen title="Code reçu sur ce numéro" onBack={() => setEtape("numero")} gap={1.5}>
        <Typography variant="body2">Un SMS a été envoyé au {numeroEnTranches(numero)} : c'est la preuve que ce numéro est à vous.{guichet.mode === "demo" ? ` Démonstration : ${CODE_SMS_DEMO}.` : ""}</Typography>
        <Cases longueur={6} valeur={code} erreur={faux} />
        {faux && <Typography variant="body2" color="error" textAlign="center">Ce code n'est pas le bon.</Typography>}
        <Button variant="text" disabled={renvoye || enCours} onClick={() => void renvoyer()} sx={{ alignSelf: "center" }}>
          {renvoye ? "Nouveau code envoyé" : "Renvoyer le code"}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Keypad onKey={touche} triple={null} />
        <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
      </Screen>
    );
  }

  return (
    <Screen title="Ajouter un numéro" back={retour}>
      <TextField label="Numéro MoMo" value={numeroEnTranches(numero)} onChange={(e) => setNumero(numeroSaisi(e.target.value))} type="tel" inputMode="numeric" fullWidth autoFocus
        slotProps={{ input: { startAdornment: <Typography sx={{ mr: 1, color: "text.secondary" }}>+237</Typography>, sx: { fontSize: 22, fontVariantNumeric: "tabular-nums" } } }} />
      <Typography variant="body2">Opérateur</Typography>
      <List>
        {OPERATEURS.map((o) => <Row key={o.id} badge={o.id} primary={o.nom} secondary={op === o.id ? "d'après le numéro" : undefined} selected={op === o.id} chevron={false} />)}
      </List>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!numeroValide(numero) || !op || enCours} onClick={() => void ajouter()}>{NUMEROS.verificationSms ? (enCours ? "Envoi du SMS…" : "Recevoir le code") : (enCours ? "…" : "Ajouter ce numéro")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/* ------------------------------------------------------------ paliers */

export function ComptePaliers() {
  const { data: compte } = useCompte();
  const navigate = useNavigate();
  if (!compte) return <Screen title="Paliers et limites" back="/compte"><Squelette hauteur={260} /></Screen>;
  return (
    <Screen title="Paliers et limites" back="/compte">
      <Typography variant="body2">Vous êtes au <b>palier {compte.palier}</b>. Chaque palier ouvre des plafonds plus larges ; au-delà du palier 2, la plateforme n'en pose plus.</Typography>
      <List>
        {[0, 1, 2].map((p) => {
          const d = PALIERS[p];
          const actuel = p === compte.palier;
          return (
            <Stack key={p} direction="row" alignItems="center" gap={1.5} sx={{ px: 1.5, py: 1.25, borderRadius: 4, bgcolor: actuel ? tones.green.bg : "transparent" }}>
              <Avatar sx={{ bgcolor: actuel ? tones.green.fg : tones.neutral.bg, color: actuel ? "#fff" : tones.neutral.fg, fontWeight: 700 }}>{p}</Avatar>
              <Stack sx={{ flex: 1 }}>
                <Typography fontWeight={500}>{d.nom.split(" · ")[1].replace(/^./, (c) => c.toUpperCase())}</Typography>
                <Typography variant="body2">{d.entreeJour === null ? "Sans plafond plateforme" : `${xaf(d.entreeJour)} XAF par jour, en entrée comme en sortie`}</Typography>
              </Stack>
              {actuel && <Chip label="Vous" size="small" sx={{ bgcolor: tones.green.fg, color: "#fff" }} />}
            </Stack>
          );
        })}
      </List>
      {compte.verificationEnCours && (
        <Card sx={{ bgcolor: tones.blue.bg, color: tones.blue.fg }}>
          <Typography fontWeight={600} sx={{ color: "inherit" }}>Vérification en cours</Typography>
          <Typography variant="body2" sx={{ color: "inherit" }}>L'équipe examine vos pièces ({compte.verificationEnCours === "identite" ? "identité" : "entreprise"}), en général sous 24 h ouvrées.</Typography>
        </Card>
      )}
      <Box sx={{ flex: 1 }} />
      {!compte.verificationEnCours && compte.palier < 1 && <Button variant="contained" onClick={() => navigate("/compte/paliers/identite")}>Vérifier mon identité</Button>}
      {!compte.verificationEnCours && compte.palier < 2 && <Button variant={compte.palier < 1 ? "outlined" : "contained"} onClick={() => navigate("/compte/paliers/entreprise")}>Vérifier mon entreprise</Button>}
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
      <Typography variant="body2">Des photos nettes, lisibles, sans reflet. 10 Mo au plus par pièce. Elles ne servent qu'à cette vérification.</Typography>
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
      <Button variant="contained" disabled={!complet || enCours} onClick={() => void envoyer()}>{enCours ? "Envoi…" : "Envoyer pour vérification"}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

export function ComptePaliersIdentite() {
  return <Pieces type="identite" titre="Vérifier mon identité" pieces={[{ cle: "recto", label: "Pièce d'identité, recto", aide: "CNI, passeport ou récépissé" }, { cle: "verso", label: "Pièce d'identité, verso", aide: "ou la page suivante du passeport" }, { cle: "selfie", label: "Selfie avec la pièce", aide: "votre visage et la pièce, nets" }]} />;
}

export function ComptePaliersEntreprise() {
  return <Pieces type="entreprise" titre="Vérifier mon entreprise" pieces={[{ cle: "rccm", label: "Registre du commerce (RCCM)", aide: "l'extrait de moins de trois mois" }, { cle: "niu", label: "Attestation d'immatriculation (NIU)", aide: "carte de contribuable" }, { cle: "gerant", label: "Pièce d'identité du gérant", aide: "recto et verso sur une image" }]} />;
}

/* ----------------------------------------------------------- sécurité */

export function CompteSecurite() {
  const guichet = useGuichet();
  const session = useSession();
  const [changer, setChanger] = useState(false);
  const [etape, setEtape] = useState<"ancien" | "nouveau" | "confirmer">("ancien");
  const [ancien, setAncien] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [conf, setConf] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const { lancer, erreur, effacerErreur } = useGesteUnique();

  const fermer = () => { setChanger(false); setEtape("ancien"); setAncien(""); setNouveau(""); setConf(""); setMessage(null); };
  const touche = (k: string) => {
    const maj = (v: string) => (k === "⌫" ? v.slice(0, -1) : (v + k).slice(0, 4));
    if (etape === "ancien") { const v = maj(ancien); setAncien(v); if (v.length === 4) setEtape("nouveau"); }
    else if (etape === "nouveau") { const v = maj(nouveau); setNouveau(v); if (v.length === 4) setEtape("confirmer"); }
    else {
      const v = maj(conf); setConf(v);
      if (v.length === 4) {
        if (v !== nouveau) { setMessage("Les deux codes ne sont pas les mêmes."); setNouveau(""); setConf(""); setEtape("nouveau"); return; }
        void lancer(async () => { await guichet.changerCodeSecret({ ancien, nouveau: v }); setMessage("Code changé."); setTimeout(fermer, 1200); }).then(() => { setAncien(""); setConf(""); });
      }
    }
  };
  const saisis = etape === "ancien" ? ancien.length : etape === "nouveau" ? nouveau.length : conf.length;

  return (
    <Screen title="Sécurité" back="/compte">
      <List>
        <Row icon={<LockResetRounded />} tone="blue" primary="Changer mon code secret" secondary="Quatre chiffres, pour chaque sortie d'argent" onClick={() => setChanger(true)} />
        <Row icon={<ShieldOutlined />} tone="green" primary="Verrouiller maintenant" secondary="Le code sera demandé à la prochaine ouverture" onClick={session.verrouiller} />
        <Row icon={<PhoneAndroidRounded />} tone="neutral" primary="Empreinte ou visage" secondary="Dans l'application Android, à la place du code" chevron={false} />
      </List>
      <Typography variant="body2">Trois codes faux verrouillent le compte 15 minutes. Un code secret ne se partage avec personne, pas même avec l'équipe Glisil : elle ne vous le demandera jamais.</Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="outlined" color="error" startIcon={<LogoutRounded />} onClick={() => void session.deconnecter()}>Déconnecter cet appareil</Button>
      <Feuille ouverte={changer} onFermer={fermer} titre={etape === "ancien" ? "Votre code actuel" : etape === "nouveau" ? "Le nouveau code" : "Confirmez le nouveau code"}>
        <Stack gap={1}>
          <Points longueur={4} saisis={saisis} erreur={Boolean(message && message !== "Code changé.")} />
          {message && <Typography variant="body2" color={message === "Code changé." ? "primary" : "error"} textAlign="center">{message}</Typography>}
          <Keypad onKey={touche} triple={null} />
        </Stack>
      </Feuille>
      <FeuilleErreur erreur={erreur} onFermer={() => { effacerErreur(); fermer(); }} />
    </Screen>
  );
}

/* ---------------------------------------------------------- API, aide */

export function CompteApi() {
  return (
    <Screen title="Accès API" back="/compte">
      <Card>
        <Typography fontWeight={600}>Pour les desks et les gros apporteurs de liquidité</Typography>
        <Typography variant="body2">Placer et annuler des ordres, lire le carnet et vos soldes depuis vos propres outils, recevoir un webhook à chaque exécution et à chaque dépôt crédité.</Typography>
        <Line label="État" value="En préparation" />
        <Line label="Ouverture" value="Avec le palier 2" />
      </Card>
      <Typography variant="body2">Les clés se créeront ici, avec leurs droits (lecture seule, ordres, retraits) et leur adresse IP autorisée. Rien à faire aujourd'hui : dites-nous ce dont vous avez besoin.</Typography>
      <Box sx={{ flex: 1 }} />
      <Contact sujet="Accès API Glisil" texte="Bonjour, je souhaite un accès API pour mon desk." />
    </Screen>
  );
}

/* une fonction, pas une constante : les frais se lisent au moment d'afficher, après les paramètres de l'équipe */
const faq = (): [string, string][] => [
  ["Combien de temps pour être crédité ?", "Dès que TOTEM lit le SMS de votre paiement, en général moins de 10 secondes après que vous avez tapé le transaction ID. Si le SMS arrive après, votre ID attend et se crédite tout seul."],
  ["Pourquoi un transaction ID ?", "MTN et Orange en donnent un à chaque opération, et le même ID est dans le SMS que notre float reçoit. C'est la preuve la plus simple et la plus sûre : pas de capture d'écran, pas de montant à taper."],
  ["Un XAFe vaut toujours 1 XAF ?", "Oui. Un XAFe n'est créé que quand un XAF est reçu, et détruit quand un XAF est envoyé. Les réserves sont sur nos floats MoMo et nos comptes en banque."],
  ["Que coûte une sortie ?", FRAIS.sortie <= 0 ? "Rien pour le moment : vous recevez exactement le montant de votre sortie. La sortie part en plusieurs transferts si elle dépasse le plafond de l'opérateur ; vous les voyez tous." : `${pourcent(FRAIS.sortie)} du montant, arrondis au franc supérieur par transfert. Au-delà du plafond de l'opérateur, la sortie part en plusieurs transferts ; vous les voyez tous.`],
  ["Un transfert a échoué, où est mon argent ?", "Après trois essais, les XAFe de ce transfert reviennent en disponible sur votre compte. Le détail de l'opération le dit, et vous êtes prévenu."],
  // le délai d'un numéro neuf est un réglage de l'équipe (0020) : la question n'existe que s'il y en a un
  ...(NUMEROS.delaiHeures > 0 ? [[`Pourquoi attendre ${NUMEROS.delaiHeures} h pour un nouveau numéro ?`, "Pour que personne qui aurait pris votre téléphone ne puisse vider votre compte vers son propre numéro dans la minute."] as [string, string]] : []),
  ...(BETA.actif ? [["Qu'est-ce que la bêta ?", "Glisil se teste en grand avant d'ouvrir pour de vrai. Tout l'argent ici est de l'argent de test, offert à l'inscription : il ne vaut rien hors de Glisil, et les dépôts et retraits réels sont fermés. Le marché est animé par des robots qui suivent le vrai cours du dollar. Achetez, vendez, essayez tout — et dites-nous ce qui coince, juste en dessous."] as [string, string]] : []),
];

export function CompteAide() {
  const [params] = useSearchParams();
  const ref = params.get("ref") ?? "";
  /* l'écran d'où l'on vient (« Signaler » du bandeau bêta) : un indice pour l'équipe, rien de plus */
  const depuis = params.get("depuis");
  const { data: compte } = useCompte();
  const guichet = useGuichet();
  const [texte, setTexte] = useState(ref ? `Référence ${ref} : ` : "");
  const [recu, setRecu] = useState<string | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const qui = `${compte?.nom ?? ""} (${telephoneLisible(compte?.telephone ?? "")}${compte?.email ? ` · ${compte.email}` : ""})`;
  const lien = lienWhatsapp(`${qui} · ${texte}`);
  const envoyer = () => lancer(async () => {
    const r = await guichet.signalerUnProbleme({ texte, ecran: depuis && depuis.startsWith("/") ? depuis : "/compte/aide" });
    setRecu(r.reference); setTexte("");
  });
  return (
    <Screen title="Aide" back="/compte">
      <Box>
        {faq().map(([q, r]) => (
          <Accordion key={q} disableGutters sx={{ bgcolor: "background.paper", "&:before": { display: "none" }, borderRadius: "16px !important", mb: 1, overflow: "hidden" }}>
            <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography fontWeight={500}>{q}</Typography></AccordionSummary>
            <AccordionDetails><Typography variant="body2">{r}</Typography></AccordionDetails>
          </Accordion>
        ))}
      </Box>
      <Typography variant="subtitle1" sx={{ mt: 1 }}>Signaler un problème</Typography>
      <Typography variant="body2">Dites ce qui s'est passé ; gardez la référence de l'opération (XAFe-…) si vous l'avez. Personne chez Glisil ne vous demandera votre code secret.</Typography>
      <TextField label="Ce qui s'est passé" value={texte} onChange={(e) => { setTexte(e.target.value); setRecu(null); }} fullWidth multiline minRows={3} inputProps={{ maxLength: 2000 }} />
      {recu && (
        <Stack direction="row" gap={1} alignItems="center" role="status" data-signalement-recu
          sx={{ p: 1.5, borderRadius: 4, bgcolor: tones.green.bg, color: tones.green.fg }}>
          <CheckCircleRounded fontSize="small" />
          <Typography variant="body2" sx={{ color: "inherit" }}>Reçu ({recu}) : l'équipe le lit et revient vers vous si besoin. Merci !</Typography>
        </Stack>
      )}
      <Button variant="contained" startIcon={<SendRounded />} onClick={() => void envoyer()} disabled={enCours || texte.trim().length < 5}>
        {enCours ? "Envoi…" : "Envoyer à l'équipe Glisil"}
      </Button>
      {lien
        ? <Button variant="outlined" startIcon={<WhatsApp />} href={lien} target="_blank" rel="noopener" disabled={texte.trim().length < 5}>Envoyer sur WhatsApp</Button>
        : null}
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
      <Contact sujet={ref ? `Problème · ${ref}` : "Un problème avec Glisil"} texte={`${qui}\n\n${texte}`} />
      <Typography variant="caption" textAlign="center">L'équipe répond de 8 h à 20 h, sept jours sur sept.</Typography>
    </Screen>
  );
}

/* ------------------------------------------------- mes informations */

const dateLongue = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Ce que Glisil sait de vous, tel que la base le garde. En lecture seule :
 * ce sont les informations qui servent à vérifier votre identité, et une
 * correction passe par le support (qui peut demander une pièce).
 */
export function CompteInformations() {
  const { data: compte } = useCompte();
  return (
    <Screen title="Mes informations" back="/compte">
      {!compte ? <Squelette hauteur={280} /> : (
        <>
          <Card>
            <Line label="Prénom" value={compte.prenom ?? "—"} />
            <Line label="Nom" value={compte.nomDeFamille ?? "—"} />
            <Line label="Date de naissance" value={compte.dateNaissance ? `${dateLongue(compte.dateNaissance)} · ${ageAu(compte.dateNaissance)} ans` : "—"} />
            <Line label="Adresse e-mail" value={<Box component="span" sx={{ overflowWrap: "anywhere" }}>{compte.email ?? "—"}</Box>} />
            <Line label="Téléphone" value={telephoneLisible(compte.telephone)} />
            <Line label="Résidence" value={[compte.ville, compte.pays ? paysDe(compte.pays)?.nom ?? compte.pays : null].filter(Boolean).join(", ") || "—"} />
            {compte.entreprise && <Line label="Entreprise" value={compte.entreprise} />}
          </Card>
          <Typography variant="body2">
            Ces informations servent à vérifier votre identité : elles ne se modifient pas ici. Une erreur, un déménagement, un nouveau numéro ? Écrivez au support, il vous dira quoi envoyer.
          </Typography>
          <Contact sujet="Corriger mes informations" texte={compte.email ?? ""} />
          <Typography variant="caption">Conditions acceptées : version du {dateLongue(VERSION_CONDITIONS)}.</Typography>
          <Box sx={{ flex: 1 }} />
          <Button component={Link} to="/compte/fermer" variant="text" color="error">Fermer mon compte</Button>
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------- fermer mon compte */

const MOTIFS = ["Je n'en ai plus besoin", "Les frais", "Un problème avec l'application", "Je préfère un autre service", "Autre raison"];

/**
 * Fermer son compte, en trois temps : ce qu'il faut d'abord (argent sorti,
 * rien en cours — chaque point dit où aller le régler), ce que fermer veut
 * dire, puis le code secret. La base revérifie tout (fermer_mon_compte).
 */
export function CompteFermer() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { data: soldes } = useSoldes();
  const { data: ordres } = useMesOrdres();
  const { data: depots } = useDepotsEnAttente();
  const [motif, setMotif] = useState<string | null>(null);
  const [demander, setDemander] = useState(false);
  const [code, setCode] = useState("");
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  const charge = Boolean(soldes && ordres && depots);
  const argent = soldes ? soldes.XAFe.disponible + soldes.XAFe.bloque > 0 || soldes.USDT.disponible + soldes.USDT.bloque > 0 : true;
  const ordresOuverts = (ordres ?? []).filter((o) => o.etat === "ouvert" || o.etat === "partiel").length;
  const enAttente = (depots ?? []).length;
  const points: { ok: boolean; texte: string; vers?: { label: string; to: string } }[] = [
    { ok: !argent, texte: argent && soldes ? `Il reste ${xaf(soldes.XAFe.disponible + soldes.XAFe.bloque)} XAFe et ${(soldes.USDT.disponible + soldes.USDT.bloque).toFixed(2)} USDT` : "Votre solde est à zéro", vers: argent ? { label: "Sortir", to: soldes && soldes.USDT.disponible + soldes.USDT.bloque > 0 ? "/crypto" : "/sortir/montant" } : undefined },
    { ok: ordresOuverts === 0, texte: ordresOuverts ? `${ordresOuverts} ordre${ordresOuverts > 1 ? "s" : ""} encore ouvert${ordresOuverts > 1 ? "s" : ""}` : "Aucun ordre ouvert", vers: ordresOuverts ? { label: "Voir", to: "/marche/ordres" } : undefined },
    { ok: enAttente === 0, texte: enAttente ? "Un dépôt attend encore son paiement" : "Aucun dépôt en attente", vers: enAttente ? { label: "Voir", to: "/historique" } : undefined },
  ];
  const pret = charge && points.every((p) => p.ok);

  const fermer = (c: string) =>
    lancer(async () => {
      try {
        await guichet.fermerCompte({ codeSecret: c, motif: motif ?? "" });
        await rafraichir(); /* la garde voit le compte fermé et montre l'écran qui le dit */
      } finally { setCode(""); }
    });
  const touche = (k: string) => {
    const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 4);
    setCode(suite);
    if (suite.length === 4) void fermer(suite);
  };

  return (
    <Screen title="Fermer mon compte" back="/compte/informations">
      <Typography variant="subtitle1">D'abord</Typography>
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
      <Typography variant="subtitle1">Ce que fermer veut dire</Typography>
      <Card>
        <Typography variant="body2">· Vous ne pourrez plus entrer, sortir ni échanger d'argent avec ce compte.</Typography>
        <Typography variant="body2">· La loi nous oblige à garder la trace de vos opérations et de votre identité pendant plusieurs années ; elles ne servent plus à rien d'autre.</Typography>
        <Typography variant="body2">· Pour rouvrir le compte, il suffira d'écrire au support depuis votre adresse e-mail.</Typography>
      </Card>
      <Typography variant="subtitle1">Pourquoi partez-vous ? <Typography component="span" variant="body2">(facultatif)</Typography></Typography>
      <Stack direction="row" gap={1} flexWrap="wrap">
        {MOTIFS.map((m) => <Chip key={m} label={m} onClick={() => setMotif(motif === m ? null : m)} color={motif === m ? "primary" : "default"} variant={motif === m ? "filled" : "outlined"} />)}
      </Stack>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" color="error" disabled={!pret || enCours} onClick={() => setDemander(true)}>Fermer mon compte</Button>
      {charge && !pret && <Typography variant="caption" textAlign="center">Réglez d'abord les points ci-dessus.</Typography>}
      <Feuille ouverte={demander} onFermer={() => { setDemander(false); setCode(""); }} titre="Votre code secret pour confirmer">
        <Stack gap={1}>
          <Typography variant="body2">Le compte sera fermé tout de suite.</Typography>
          <Points longueur={4} saisis={code.length} />
          <Keypad onKey={touche} triple={null} />
        </Stack>
      </Feuille>
      <FeuilleErreur erreur={erreur} onFermer={() => { effacerErreur(); setDemander(false); }} />
    </Screen>
  );
}
