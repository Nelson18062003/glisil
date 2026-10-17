/*
 * Sortir des XAF : 1 Montant → 2 Destination → 3 Vérifier → 4 Code → 5 Envoyé.
 * Un numéro vérifié depuis 24 h. Deux façons de payer, selon « sortie.mode » :
 * TOTEM compose le transfert tout seul ; ou l'équipe Glisil paie à la main,
 * au nom que le client a donné, puis lui rend le transaction ID. Les XAFe
 * sont mis de côté à la confirmation, détruits quand l'argent est parti.
 */
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import UndoRounded from "@mui/icons-material/UndoRounded";
import RadioButtonUncheckedRounded from "@mui/icons-material/RadioButtonUncheckedRounded";
import AccountBalanceWalletOutlined from "@mui/icons-material/AccountBalanceWalletOutlined";
import AddRounded from "@mui/icons-material/AddRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import ScheduleRounded from "@mui/icons-material/ScheduleRounded";
import LockRounded from "@mui/icons-material/LockRounded";
import { Box, Button, CircularProgress, Divider, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useCompte, useGuichet, useNumeros, useOuvertures, useRafraichir, useSoldes, useSortie } from "../../guichet";
import { decouperSortie, delaiDuNumero, FRAIS, fraisSortieManuelle, montantValide, nomsDesReseaux, NUMEROS, operateur as opDe } from "../../noyau/argent";
import { apresFrappe, duree, jourRelatif, montantDepuisSaisie, numeroEnTranches, numeroSaisi, numeroValide, operateurDuNumero, pourcent, quand, xaf } from "../../noyau/format";
import { parcours, useParcours } from "../../navigation/parcours";
import { Amount, Attente, Card, Chips, Dot, EtatVide, FeuilleErreur, Keypad, Line, List, Points, Row, Screen, Squelette, Success } from "../../ui";
import { tones } from "../../theme";
import { useGesteUnique } from "../../ui/gestes";

/* --------------------------------------------------------- 1 · montant */

export function SortirMontant() {
  const navigate = useNavigate();
  const { data: soldes } = useSoldes();
  const { data: numeros } = useNumeros();
  const [etat, poser] = useParcours("sortir");
  const ouvert = useOuvertures();
  const [saisie, setSaisie] = useState(etat.montant ? String(etat.montant) : "");
  const montant = montantDepuisSaisie(saisie);
  const dispo = soldes?.XAFe.disponible ?? 0;
  const trop = soldes ? montant > dispo : false;
  const ok = montantValide(montant, 100) && !trop;

  const choisir = (c: string) => {
    if (c === "Tout") setSaisie(String(Math.trunc(dispo)));
    else setSaisie(c.replace(/\D/g, ""));
  };

  /* Avant de taper un montant : y a-t-il quelque chose à sortir, et un numéro où l'envoyer ?
     Le dire ici, plutôt qu'à l'étape 2 après avoir tapé un montant pour rien. */
  const vivants = (numeros ?? []).filter((n) => !n.retireLe);
  const verifies = vivants.filter((n) => n.verifieLe);
  const prochain = verifies.map((n) => new Date(n.actifDes).getTime()).sort((a, b) => a - b)[0];
  const bloque = soldes?.XAFe.bloque ?? 0;
  if (soldes && dispo < 100) {
    return (
      <Screen title="Sortir des XAF" back="/">
        {bloque > 0 ? (
          <EtatVide icone={<ScheduleRounded sx={{ fontSize: 36 }} />} tone="amber" titre="Vos XAFe sont engagés"
            texte={`${xaf(bloque)} XAFe sont bloqués dans vos ordres ouverts ou une sortie en cours. Annulez un ordre pour les libérer.`}
            action={{ label: "Voir mes ordres", to: "/marche/ordres" }} secondaire={{ label: "Retour à l'accueil", to: "/" }} />
        ) : (
          <EtatVide icone={<ArrowDownwardRounded sx={{ fontSize: 36 }} />} tone="green" titre="Rien à sortir pour l'instant"
            texte="Vos XAFe apparaissent ici dès que vous en avez entré par Mobile Money."
            action={{ label: "Entrer des XAF", to: "/entrer/operateur" }} secondaire={{ label: "Retour à l'accueil", to: "/" }} />
        )}
      </Screen>
    );
  }
  /* sans code SMS, le numéro se tape à l'étape suivante : rien à faire avant */
  if (numeros && verifies.length === 0 && NUMEROS.verificationSms) {
    return (
      <Screen title="Sortir des XAF" back="/">
        <EtatVide icone={<PhoneAndroidRounded sx={{ fontSize: 36 }} />} tone="green" titre="D'abord, votre numéro MoMo"
          texte={`Vos XAF partent vers un numéro Mobile Money vérifié à votre nom. Il devient actif ${delaiDuNumero()} : ajoutez-le dès maintenant.`}
          action={{ label: "Ajouter un numéro", onClick: () => { parcours.poserRetour("/sortir/montant"); navigate("/compte/numeros/ajouter"); } }}
          secondaire={{ label: "Retour à l'accueil", to: "/" }} />
      </Screen>
    );
  }
  if (numeros && prochain && prochain > Date.now() && verifies.every((n) => new Date(n.actifDes).getTime() > Date.now())) {
    return (
      <Screen title="Sortir des XAF" back="/">
        <EtatVide icone={<ScheduleRounded sx={{ fontSize: 36 }} />} tone="amber" titre="Votre numéro sera bientôt prêt"
          texte={`Pour votre sécurité, un numéro ajouté reçoit des sorties ${delaiDuNumero()} : ${jourRelatif(new Date(prochain).toISOString()).toLowerCase()} à ${new Date(prochain).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`}
          action={{ label: "Retour à l'accueil", to: "/" }} secondaire={{ label: "Mes numéros", to: "/compte/numeros" }} />
      </Screen>
    );
  }

  return (
    <Screen title="Sortir des XAF" back="/" gap={1.5}>
      <Amount
        value={saisie ? xaf(montant) : "0"}
        unit="XAFe"
        hint={soldes ? (trop ? `Vous n'avez que ${xaf(Math.trunc(dispo))} XAFe disponibles` : `Disponible : ${xaf(Math.trunc(dispo))} XAFe`) : " "}
        hintColor={trop ? "error.main" : undefined}
      />
      <Chips items={["100 000", "500 000", "Tout"]} selected={saisie === String(Math.trunc(dispo)) && dispo > 0 ? "Tout" : xaf(montant)} onSelect={choisir} />
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={(k) => setSaisie(apresFrappe(saisie, k))} />
      <Button variant="contained" disabled={!ok} onClick={() => { poser({ montant }); navigate("/sortir/destination"); }}>Continuer</Button>
      {/* l'autre façon de sortir ses XAFe : vers son propre wallet, sur la chaîne */}
      {ouvert.cryptoRetraits && <Button variant="text" startIcon={<AccountBalanceWalletOutlined />} component={Link} to="/crypto/retirer/XAFe/adresse">{`Ou vers mon wallet · ${nomsDesReseaux()}`}</Button>}
    </Screen>
  );
}

/* ----------------------------------------------------- 2 · destination */

export function SortirDestination() {
  const navigate = useNavigate();
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  useOuvertures();   // se redessine quand le réglage « numeros » arrive
  const { data: numeros } = useNumeros();
  const [etat, poser] = useParcours("sortir");
  /* Sans code SMS (0020), le numéro se tape ICI : il est retenu, choisi, et l'on continue. */
  const [nouveau, setNouveau] = useState("");
  const opNouveau = operateurDuNumero(nouveau);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const ajouter = () =>
    lancer(async () => {
      const n = await guichet.ajouterNumero({ operateur: opNouveau!, numero: numeroSaisi(nouveau) });
      await rafraichir();
      poser({ numeroId: n.id });
      setNouveau("");
    });
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
              secondary={!n.verifieLe ? `${opDe(n.operateur).nom} · à vérifier` : actif(n) ? `${opDe(n.operateur).nom}${NUMEROS.verificationSms ? " · vérifié" : ""}` : `${opDe(n.operateur).nom} · actif ${jourRelatif(n.actifDes).toLowerCase()} à ${new Date(n.actifDes).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
              selected={n.id === etat.numeroId}
              disabled={!actif(n)}
              onClick={() => poser({ numeroId: n.id })}
            />
          ))}
          {NUMEROS.verificationSms && <Row icon={<AddRounded />} tone="green" primary="Ajouter un numéro" secondary={`Actif ${delaiDuNumero()}`} onClick={() => { parcours.poserRetour("/sortir/destination"); navigate("/compte/numeros/ajouter"); }} />}
        </List>
      )}
      {numeros && !NUMEROS.verificationSms && (
        <Stack gap={1}>
          <Typography variant="body2" fontWeight={500}>{numeros.length ? "Ou un autre numéro" : "Le numéro Mobile Money qui reçoit"}</Typography>
          <Stack direction="row" gap={1} alignItems="flex-start">
            <TextField label="Numéro MoMo ou Orange Money" value={numeroEnTranches(nouveau)} onChange={(e) => setNouveau(numeroSaisi(e.target.value))} type="tel" inputMode="numeric" fullWidth
              helperText={nouveau.length >= 9 && !opNouveau ? "Ce n'est ni un numéro MTN ni un numéro Orange" : opNouveau ? opDe(opNouveau).nom : " "}
              error={nouveau.length >= 9 && !opNouveau}
              slotProps={{ input: { startAdornment: <Typography sx={{ mr: 1, color: "text.secondary" }}>+237</Typography>, sx: { fontVariantNumeric: "tabular-nums" } } }} />
            <Button variant="outlined" disabled={!numeroValide(nouveau) || !opNouveau || enCours} onClick={() => void ajouter()} sx={{ minHeight: 56, flexShrink: 0 }}>Ajouter</Button>
          </Stack>
        </Stack>
      )}
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!choisi || !actif(choisi)} onClick={() => navigate("/sortir/verifier")}>Continuer</Button>
    </Screen>
  );
}

/* --------------------------------------------------------- 3 · vérifier */

export function SortirVerifier() {
  const navigate = useNavigate();
  const { data: numeros } = useNumeros();
  const { data: compte } = useCompte();
  const { sortieManuelle } = useOuvertures();
  const [etat, poser] = useParcours("sortir");
  const numero = numeros?.find((n) => n.id === etat.numeroId);
  /* le nom du compte Glisil d'abord : c'est presque toujours lui, et il doit l'être */
  useEffect(() => { if (sortieManuelle && !etat.nom && compte?.nom) poser({ nom: compte.nom }); }, [sortieManuelle, etat.nom, compte?.nom, poser]);
  if (!etat.montant || !etat.numeroId) return <Navigate to="/sortir/montant" replace />;
  if (!numero) return <Screen title="Vérifiez" back="/sortir/destination"><Squelette hauteur={220} /></Screen>;
  const op = opDe(numero.operateur);

  if (sortieManuelle) {
    const { frais, envoi } = fraisSortieManuelle(etat.montant);
    const nomOk = etat.nom.trim().length >= 2 && etat.nom.trim().length <= 80;
    return (
      <Screen title="Vérifiez" back="/sortir/destination">
        <Card>
          <Line label="Montant" value={`${xaf(etat.montant)} XAFe`} />
          <Line label={`Frais (${pourcent(FRAIS.sortie)})`} value={xaf(frais)} />
          <Divider />
          <Line label="Vous recevez" value={`${xaf(envoi)} XAF`} strong />
          <Line label="Vers" value={`${op.nom.split(" ")[0]} · ${numeroEnTranches(numero.numero)}`} />
          <Line label="Payé par" value={<><Dot tone="amber" />l'équipe Glisil</>} />
        </Card>
        <TextField
          label={`Nom exact du compte ${op.nom}`}
          value={etat.nom}
          onChange={(e) => poser({ nom: e.target.value.slice(0, 80) })}
          fullWidth
          autoComplete="name"
          error={etat.nom.length > 0 && !nomOk}
          helperText="Celui que l'opérateur affiche quand on vous envoie de l'argent. S'il ne correspond pas, la demande est refusée et vos XAFe vous reviennent."
        />
        <Typography variant="body2" textAlign="center">
          Vos XAFe sont mis de côté dès votre confirmation. L'équipe Glisil vous paie, en général dans la journée, puis vous donne le transaction ID.
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<LockRounded />} disabled={!nomOk} onClick={() => navigate("/sortir/code")}>Confirmer avec mon code</Button>
      </Screen>
    );
  }

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
  const { sortieManuelle } = useOuvertures();
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState<string | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("wd", { montant: etat.montant, numeroId: etat.numeroId, nom: etat.nom });

  if (!etat.montant || !etat.numeroId) return <Navigate to="/sortir/montant" replace />;

  const envoyer = (c: string) =>
    lancer(async (cle) => {
      try {
        const s = await guichet.demanderSortie({ montant: etat.montant, numeroId: etat.numeroId!, cle, codeSecret: c, ...(sortieManuelle ? { nom: etat.nom.trim() } : {}) });
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
  const { data: s, error } = useSortie(ref);
  useEffect(() => { parcours.effacer("sortir"); }, []);
  if (!s) return <Attente erreur={error} />;
  const op = opDe(s.operateur);
  const faits = s.transferts.filter((t) => t.etat === "faite").length;

  if (s.etat === "annulee") {
    return (
      <Success tone="amber" icone={<UndoRounded sx={{ fontSize: 56 }} />} title="Demande refusée" amount={`${xaf(s.montantRendu || s.montant)} XAFe revenus`}
        caption={s.motif ? `${s.motif} Vos XAFe sont de nouveau disponibles.` : "Vos XAFe sont de nouveau disponibles."}
        primary={{ label: "Retour à l'accueil", to: "/" }} secondary={{ label: "Voir le détail", to: `/historique/${s.reference}` }} />
    );
  }

  if (s.mode === "manuel" && s.etat !== "envoyee") return <SortieManuelleEnCours s={s} />;

  if (s.etat === "envoyee") {
    return (
      <Success title={`${xaf(s.montantEnvoye)} XAF envoyés`} amount={`au ${numeroEnTranches(s.numero)}`} caption={`${op.nom}, ${quand(s.termineeLe ?? s.creeLe)}${s.transferts.length > 1 ? `, en ${s.transferts.length} transferts` : ""}.`}
        primary={{ label: "Retour à l'accueil", to: "/" }} secondary={{ label: "Voir le reçu", to: `/historique/${s.reference}` }}>
        <Card>
          <Line label="XAFe débités" value={xaf(s.montant)} />
          <Line label="XAFe détruits" value={xaf(s.montantEnvoye)} />
          <Line label="Frais" value={xaf(s.frais)} />
          <Line label="Référence" value={s.reference} mono />
          {s.transactionId && <Line label={`Transaction ID ${op.nom.split(" ")[0]}`} value={s.transactionId} mono />}
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

/* Payée à la main : trois étapes que le client voit avancer — reçue, prise en charge, payée. */
function SortieManuelleEnCours({ s }: { s: import("../../guichet/types").Sortie }) {
  const etapes = [
    { fait: true, titre: "Demande reçue", texte: `${quand(s.creeLe)} · vos XAFe sont mis de côté` },
    { fait: Boolean(s.prisLe), titre: "Prise en charge", texte: s.prisLe ? `${quand(s.prisLe)} · l'équipe Glisil s'en occupe` : "l'équipe Glisil va s'en occuper" },
    { fait: Boolean(s.payeeLe), titre: "Payée", texte: s.transactionId ? `Transaction ID ${s.transactionId}` : "vous recevrez le transaction ID" },
  ];
  return (
    <Screen title="Votre sortie" back="/">
      <Stack alignItems="center" gap={0.5} sx={{ py: 2 }}>
        <Typography variant="body2">Vous allez recevoir</Typography>
        <Typography variant="h4" color="primary.main">{xaf(s.montantXaf)} XAF</Typography>
        <Typography variant="body2">au {numeroEnTranches(s.numero)}{s.nomBeneficiaire ? ` · ${s.nomBeneficiaire}` : ""}</Typography>
      </Stack>
      <Card>
        {etapes.map((e, i) => (
          <Stack key={e.titre} direction="row" gap={1.5} alignItems="flex-start" sx={{ py: 0.5 }}>
            {e.fait ? <CheckCircleRounded sx={{ color: tones.green.fg }} /> : <RadioButtonUncheckedRounded sx={{ color: i === etapes.findIndex((x) => !x.fait) ? tones.amber.fg : "text.disabled" }} />}
            <Stack sx={{ minWidth: 0 }}>
              <Typography fontWeight={600}>{e.titre}</Typography>
              <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{e.texte}</Typography>
            </Stack>
          </Stack>
        ))}
      </Card>
      <Card>
        <Line label="XAFe mis de côté" value={xaf(s.montant)} />
        <Line label="Frais" value={xaf(s.frais)} />
        <Line label="Référence" value={s.reference} mono />
      </Card>
      <Typography variant="body2" textAlign="center">Cet écran avance tout seul. Vous êtes aussi prévenu par une notification.</Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" component={Link} to="/" replace>Retour à l'accueil</Button>
    </Screen>
  );
}
