/*
 * Le Compte : mes numéros MoMo, mes paliers, la sécurité, l'accès API, l'aide.
 */
import AddRounded from "@mui/icons-material/AddRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import KeyRounded from "@mui/icons-material/KeyRounded";
import LockResetRounded from "@mui/icons-material/LockResetRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import UploadFileRounded from "@mui/icons-material/UploadFileRounded";
import VerifiedRounded from "@mui/icons-material/VerifiedRounded";
import WhatsApp from "@mui/icons-material/WhatsApp";
import { Accordion, AccordionDetails, AccordionSummary, Avatar, Box, Button, Chip, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCompte, useGuichet, useNumeros, useRafraichir } from "../../guichet";
import type { IdOperateur } from "../../guichet/types";
import { CODE_SMS_DEMO } from "../../guichet/demo";
import { OPERATEURS, PALIERS, operateur as opDe } from "../../noyau/argent";
import { initiales, jourRelatif, numeroEnTranches, numeroSaisi, numeroValide, operateurDuNumero, xaf } from "../../noyau/format";
import { parcours } from "../../navigation/parcours";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { Card, Cases, Feuille, FeuilleErreur, Keypad, Line, List, Points, Row, Screen, Squelette } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

const WHATSAPP = "237677000000";

export function Compte() {
  const session = useSession();
  const { data: compte } = useCompte();
  const { data: numeros } = useNumeros();
  const palier = compte ? PALIERS[compte.palier] : null;
  return (
    <Screen tab="compte" title="Compte">
      <Stack alignItems="center" gap={1} py={2}>
        <Avatar sx={{ width: 88, height: 88, bgcolor: "primary.main", fontSize: 32, fontWeight: 600 }}>{initiales(compte?.nom)}</Avatar>
        <Typography variant="h6">{compte?.nom ?? "…"}</Typography>
        <Typography variant="body2">{compte?.entreprise ?? numeroEnTranches(compte?.telephone ?? "")}</Typography>
        {palier && <Chip icon={<VerifiedRounded />} label={palier.nom} sx={{ bgcolor: tones.green.bg, color: tones.green.fg, "& .MuiChip-icon": { color: tones.green.fg } }} />}
      </Stack>
      <List>
        <Row icon={<PhoneAndroidRounded />} tone="green" primary="Mes numéros MoMo" secondary={numeros ? `${numeros.filter((n) => n.verifieLe).length} vérifié${numeros.filter((n) => n.verifieLe).length > 1 ? "s" : ""}` : " "} to="/compte/numeros" />
        <Row icon={<VerifiedRounded />} tone="amber" primary="Paliers et limites" secondary={palier ? (palier.entreeJour === null ? "Sans plafond plateforme" : `${xaf(palier.entreeJour)} XAF par jour`) : " "} to="/compte/paliers" />
        <Row icon={<ShieldOutlined />} tone="blue" primary="Sécurité" secondary="Code secret, appareils" to="/compte/securite" />
        <Row icon={<KeyRounded />} tone="neutral" primary="Accès API" secondary="Pour les desks" to="/compte/api" />
        <Row icon={<HelpOutlineRounded />} tone="neutral" primary="Aide" to="/compte/aide" />
      </List>
      <Button variant="text" color="error" startIcon={<LogoutRounded />} onClick={() => void session.deconnecter()}>Se déconnecter</Button>
      <Typography variant="caption" textAlign="center">XAFe Exchange · {import.meta.env.MODE === "production" ? "" : "mode "}{useGuichet().mode === "demo" ? "démonstration" : ""}</Typography>
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
  const [operateur, setOperateur] = useState<IdOperateur | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const op = operateur ?? operateurDuNumero(numero);
  const retour = parcours.lire().retour ?? "/compte/numeros";

  const ajouter = () =>
    lancer(async () => {
      const n = await guichet.ajouterNumero({ operateur: op!, numero: numeroSaisi(numero) });
      setId(n.id); setEtape("code");
    });
  const confirmer = (c: string) =>
    lancer(async () => {
      try { await guichet.confirmerNumero({ id: id!, code: c }); await rafraichir(); setEtape("fait"); }
      catch (e) { setFaux(true); setCode(""); throw e; }
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
          <Line label="Actif" value="dans 24 h" strong />
        </Card>
        <Typography variant="body2" textAlign="center">Les 24 heures protègent votre argent : un numéro ajouté par quelqu'un d'autre ne peut pas recevoir une sortie tout de suite.</Typography>
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
        <Box sx={{ flex: 1 }} />
        <Keypad onKey={touche} triple={null} />
        <FeuilleErreur erreur={erreur && !faux ? erreur : null} onFermer={effacerErreur} />
      </Screen>
    );
  }

  return (
    <Screen title="Ajouter un numéro" back={retour}>
      <TextField label="Numéro MoMo" value={numeroEnTranches(numero)} onChange={(e) => setNumero(numeroSaisi(e.target.value))} type="tel" inputMode="numeric" fullWidth autoFocus
        slotProps={{ input: { startAdornment: <Typography sx={{ mr: 1, color: "text.secondary" }}>+237</Typography>, sx: { fontSize: 22, fontVariantNumeric: "tabular-nums" } } }} />
      <Typography variant="body2">Opérateur</Typography>
      <List>
        {OPERATEURS.map((o) => <Row key={o.id} badge={o.id} primary={o.nom} selected={op === o.id} onClick={() => setOperateur(o.id)} />)}
      </List>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!numeroValide(numero) || !op || enCours} onClick={() => void ajouter()}>{enCours ? "Envoi du SMS…" : "Recevoir le code"}</Button>
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
      <Typography variant="body2">Trois codes faux verrouillent le compte 15 minutes. Un code secret ne se partage avec personne, pas même avec l'équipe XAFe.</Typography>
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
      <Button variant="outlined" startIcon={<WhatsApp />} href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Bonjour, je souhaite un accès API XAFe Exchange pour mon desk.")}`} target="_blank" rel="noopener">Nous écrire</Button>
    </Screen>
  );
}

const FAQ: [string, string][] = [
  ["Combien de temps pour être crédité ?", "Dès que TOTEM lit le SMS de votre paiement, en général moins de 10 secondes après que vous avez tapé le transaction ID. Si le SMS arrive après, votre ID attend et se crédite tout seul."],
  ["Pourquoi un transaction ID ?", "MTN et Orange en donnent un à chaque opération, et le même ID est dans le SMS que notre float reçoit. C'est la preuve la plus simple et la plus sûre : pas de capture d'écran, pas de montant à taper."],
  ["Un XAFe vaut toujours 1 XAF ?", "Oui. Un XAFe n'est créé que quand un XAF est reçu, et détruit quand un XAF est envoyé. Les réserves sont sur nos floats MoMo et nos comptes en banque."],
  ["Que coûte une sortie ?", "0,5 % du montant, arrondis au franc supérieur par transfert. Au-delà du plafond de l'opérateur, la sortie part en plusieurs transferts ; vous les voyez tous."],
  ["Un transfert a échoué, où est mon argent ?", "Après trois essais, les XAFe de ce transfert reviennent en disponible sur votre compte. Le détail de l'opération le dit, et vous êtes prévenu."],
  ["Pourquoi attendre 24 h pour un nouveau numéro ?", "Pour que personne qui aurait pris votre téléphone ne puisse vider votre compte vers son propre numéro dans la minute."],
];

export function CompteAide() {
  const [params] = useSearchParams();
  const ref = params.get("ref") ?? "";
  const { data: compte } = useCompte();
  const [texte, setTexte] = useState(ref ? `Référence ${ref} : ` : "");
  const lien = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`${compte?.nom ?? ""} (${numeroEnTranches(compte?.telephone ?? "")}) · ${texte}`)}`;
  return (
    <Screen title="Aide" back="/compte">
      <Box>
        {FAQ.map(([q, r]) => (
          <Accordion key={q} disableGutters sx={{ bgcolor: "background.paper", "&:before": { display: "none" }, borderRadius: "16px !important", mb: 1, overflow: "hidden" }}>
            <AccordionSummary expandIcon={<ExpandMoreRounded />}><Typography fontWeight={500}>{q}</Typography></AccordionSummary>
            <AccordionDetails><Typography variant="body2">{r}</Typography></AccordionDetails>
          </Accordion>
        ))}
      </Box>
      <Typography variant="subtitle1" sx={{ mt: 1 }}>Signaler un problème</Typography>
      <TextField label="Ce qui s'est passé" value={texte} onChange={(e) => setTexte(e.target.value)} fullWidth multiline minRows={3} />
      <Button variant="contained" startIcon={<WhatsApp />} href={lien} target="_blank" rel="noopener" disabled={texte.trim().length < 5}>Envoyer sur WhatsApp</Button>
      <Typography variant="caption" textAlign="center">L'équipe répond de 8 h à 20 h, sept jours sur sept.</Typography>
    </Screen>
  );
}
