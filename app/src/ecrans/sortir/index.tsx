/*
 * Sortir des XAF : 1 Montant → 2 Destination → 3 Vérifier → 4 Code → 5 Envoyé.
 * Un numéro vérifié depuis 24 h, TOTEM compose le transfert, le reçu suit.
 */
import AddRounded from "@mui/icons-material/AddRounded";
import LockRounded from "@mui/icons-material/LockRounded";
import { Box, Button, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useGuichet, useNumeros, useSoldes, useSortie } from "../../guichet";
import { decouperSortie, FRAIS, montantValide, operateur as opDe } from "../../noyau/argent";
import { apresFrappe, duree, jourRelatif, montantDepuisSaisie, numeroEnTranches, pourcent, quand, xaf } from "../../noyau/format";
import { parcours, useParcours } from "../../navigation/parcours";
import { Amount, Card, Chips, Dot, FeuilleErreur, Keypad, Line, List, Points, Row, Screen, Squelette, Success } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

/* --------------------------------------------------------- 1 · montant */

export function SortirMontant() {
  const navigate = useNavigate();
  const { data: soldes } = useSoldes();
  const [etat, poser] = useParcours("sortir");
  const [saisie, setSaisie] = useState(etat.montant ? String(etat.montant) : "");
  const montant = montantDepuisSaisie(saisie);
  const dispo = soldes?.XAFe.disponible ?? 0;
  const trop = soldes ? montant > dispo : false;
  const ok = montantValide(montant, 100) && !trop;

  const choisir = (c: string) => {
    if (c === "Tout") setSaisie(String(Math.trunc(dispo)));
    else setSaisie(c.replace(/\D/g, ""));
  };

  return (
    <Screen title="Sortir des XAF" back="/" gap={1.5}>
      <Amount
        value={saisie ? xaf(montant) : "0"}
        unit="XAFe"
        hint={soldes ? (trop ? `Vous n'avez que ${xaf(dispo)} XAFe disponibles` : `Disponible : ${xaf(dispo)} XAFe`) : " "}
        hintColor={trop ? "error.main" : undefined}
      />
      <Chips items={["100 000", "500 000", "Tout"]} selected={saisie === String(Math.trunc(dispo)) && dispo > 0 ? "Tout" : xaf(montant)} onSelect={choisir} />
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={(k) => setSaisie(apresFrappe(saisie, k))} />
      <Button variant="contained" disabled={!ok} onClick={() => { poser({ montant }); navigate("/sortir/destination"); }}>Continuer</Button>
    </Screen>
  );
}

/* ----------------------------------------------------- 2 · destination */

export function SortirDestination() {
  const navigate = useNavigate();
  const { data: numeros } = useNumeros();
  const [etat, poser] = useParcours("sortir");
  const actif = (n: { verifieLe: string | null; actifDes: string }) => Boolean(n.verifieLe) && new Date(n.actifDes).getTime() <= Date.now();
  const choisi = numeros?.find((n) => n.id === etat.numeroId) ?? null;

  return (
    <Screen title="Vers quel numéro ?" back="/sortir/montant">
      {!numeros ? <Squelette hauteur={180} /> : (
        <List>
          {numeros.map((n) => (
            <Row
              key={n.id}
              badge={n.operateur}
              primary={numeroEnTranches(n.numero)}
              secondary={!n.verifieLe ? `${opDe(n.operateur).nom} · à vérifier` : actif(n) ? `${opDe(n.operateur).nom} · vérifié` : `${opDe(n.operateur).nom} · actif ${jourRelatif(n.actifDes).toLowerCase()} à ${new Date(n.actifDes).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
              selected={n.id === etat.numeroId}
              disabled={!actif(n)}
              onClick={() => poser({ numeroId: n.id })}
            />
          ))}
          <Row icon={<AddRounded />} tone="green" primary="Ajouter un numéro" secondary="Actif 24 h après vérification" onClick={() => { parcours.poserRetour("/sortir/destination"); navigate("/compte/numeros/ajouter"); }} />
        </List>
      )}
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!choisi || !actif(choisi)} onClick={() => navigate("/sortir/verifier")}>Continuer</Button>
    </Screen>
  );
}

/* --------------------------------------------------------- 3 · vérifier */

export function SortirVerifier() {
  const navigate = useNavigate();
  const { data: numeros } = useNumeros();
  const [etat] = useParcours("sortir");
  const numero = numeros?.find((n) => n.id === etat.numeroId);
  if (!etat.montant || !etat.numeroId) return <Navigate to="/sortir/montant" replace />;
  if (!numero) return <Screen title="Vérifiez" back="/sortir/destination"><Squelette hauteur={220} /></Screen>;
  const op = opDe(numero.operateur);
  const d = decouperSortie(etat.montant, op.plafondParTransfert);

  return (
    <Screen title="Vérifiez" back="/sortir/destination">
      <Card>
        <Line label="Montant" value={`${xaf(etat.montant)} XAFe`} />
        <Line label={`Frais (${pourcent(FRAIS.sortie)})`} value={xaf(d.frais)} />
        <Divider />
        <Line label="Vous recevez" value={`${xaf(d.envoi)} XAF`} strong />
        <Line label="Vers" value={`${op.nom.split(" ")[0]} · ${numeroEnTranches(numero.numero)}`} />
        {d.transferts.length > 1 && <Line label="En" value={`${d.transferts.length} transferts de ${xaf(d.transferts[0].envoi)}${d.transferts[d.transferts.length - 1].envoi !== d.transferts[0].envoi ? ` et ${xaf(d.transferts[d.transferts.length - 1].envoi)}` : ""}`} />}
        <Line label="Délai habituel" value={<><Dot tone="green" />{d.transferts.length > 1 ? `${d.transferts.length} min` : "40 s"}</>} />
      </Card>
      <Typography variant="body2" textAlign="center">
        Les XAFe sont bloqués à la confirmation et détruits quand le transfert est parti. Un transfert qui échoue vous revient.
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" startIcon={<LockRounded />} onClick={() => navigate("/sortir/code")}>Confirmer avec mon code</Button>
    </Screen>
  );
}

/* ------------------------------------------------------------- 4 · code */

export function SortirCode() {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [etat] = useParcours("sortir");
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState<string | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("wd", { montant: etat.montant, numeroId: etat.numeroId });

  if (!etat.montant || !etat.numeroId) return <Navigate to="/sortir/montant" replace />;

  const envoyer = (c: string) =>
    lancer(async (cle) => {
      try {
        const s = await guichet.demanderSortie({ montant: etat.montant, numeroId: etat.numeroId!, cle, codeSecret: c });
        /* le parcours s'efface à l'arrivée sur « Envoyé », jamais ici : cet écran se redessinerait sans montant et repartirait au début */
        navigate(`/sortir/envoye/${s.reference}`, { replace: true });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.startsWith("code secret") || m.startsWith("compte verrouillé")) { setFaux(m.startsWith("compte") ? "Trois codes faux : le compte est verrouillé 15 minutes." : "Code incorrect. Trois erreurs verrouillent le compte 15 minutes."); setCode(""); return; }
        throw e;
      }
    });

  const touche = (k: string) => {
    setFaux(null);
    const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 4);
    setCode(suite);
    if (suite.length === 4) void envoyer(suite);
  };

  return (
    <Screen title="Votre code secret" back="/sortir/verifier" gap={1.5}>
      <Typography variant="body2">Pour envoyer {xaf(etat.montant)} XAFe.</Typography>
      <Points longueur={4} saisis={code.length} erreur={Boolean(faux)} />
      {faux && <Typography variant="body2" color="error" textAlign="center">{faux}</Typography>}
      {enCours && <Stack alignItems="center"><CircularProgress size={28} /></Stack>}
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={null} />
      <FeuilleErreur erreur={erreur} onFermer={() => { effacerErreur(); setCode(""); }} />
    </Screen>
  );
}

/* ----------------------------------------------------------- 5 · envoyé */

export function SortirEnvoye() {
  const { ref } = useParams();
  const { data: s } = useSortie(ref);
  useEffect(() => { parcours.effacer("sortir"); }, []);
  if (!s) return <Screen><Squelette hauteur={300} /></Screen>;
  const op = opDe(s.operateur);
  const faits = s.transferts.filter((t) => t.etat === "faite").length;

  if (s.etat === "envoyee") {
    return (
      <Success title={`${xaf(s.montantEnvoye)} XAF envoyés`} amount={`au ${numeroEnTranches(s.numero)}`} caption={`${op.nom}, ${quand(s.termineeLe ?? s.creeLe)}${s.transferts.length > 1 ? `, en ${s.transferts.length} transferts` : ""}.`}
        primary={{ label: "Retour à l'accueil", to: "/" }} secondary={{ label: "Voir le reçu", to: `/historique/${s.reference}` }}>
        <Card>
          <Line label="XAFe détruits" value={xaf(s.montant)} />
          <Line label="Frais" value={xaf(s.frais)} />
          <Line label="Référence" value={s.reference} mono />
          {s.transferts.filter((t) => t.referenceOperateur).map((t, i) => <Line key={i} label={`Transaction ID ${op.nom.split(" ")[0]}`} value={t.referenceOperateur!} mono />)}
        </Card>
      </Success>
    );
  }

  if (s.etat === "echouee" || s.etat === "partielle") {
    return (
      <Success tone={s.etat === "echouee" ? "red" : "amber"} title={s.etat === "echouee" ? "Le transfert n'est pas parti" : "Sortie partielle"} amount={s.etat === "echouee" ? `${xaf(s.montantRendu)} XAFe revenus` : `${xaf(s.montantEnvoye)} XAF envoyés`}
        caption={s.etat === "echouee" ? `${op.nom} n'a pas accepté le transfert après trois essais. Vos XAFe sont de nouveau disponibles.` : `${xaf(s.montantRendu)} XAFe n'ont pas pu partir et sont revenus sur votre compte.`}
        primary={{ label: "Voir le détail", to: `/historique/${s.reference}` }} secondary={{ label: "Retour à l'accueil", to: "/" }} />
    );
  }

  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
        <CircularProgress size={64} thickness={3} />
        <Typography variant="h6">En cours</Typography>
        <Typography variant="h4" color="primary.main">{xaf(s.montantXaf)} XAF</Typography>
        <Typography variant="body2">
          TOTEM compose le transfert vers le {numeroEnTranches(s.numero)}{s.transferts.length > 1 ? ` · ${faits}/${s.transferts.length} partis` : ""}. Cet écran bascule tout seul.
        </Typography>
        <Typography variant="caption">Demandé {quand(s.creeLe)} · {duree((Date.now() - new Date(s.creeLe).getTime()) / 1000)} écoulées</Typography>
      </Box>
      <Button variant="text" component={Link} to="/" replace>Retour à l'accueil, je serai prévenu</Button>
    </Screen>
  );
}
