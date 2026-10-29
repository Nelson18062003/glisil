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
import { EtapeDeVerification } from "../../ui/verification";
import { decouperSortie, delaiDuNumero, FRAIS, fraisSortieManuelle, montantValide, nomsDesReseaux, NUMEROS, operateur as opDe } from "../../noyau/argent";
import { apresFrappe, duree, heure, jourRelatif, montantDepuisSaisie, numeroDeDemo, numeroEnTranches, numeroSaisi, numeroValide, operateurDuNumero, pourcent, quand, xaf } from "../../noyau/format";
import { motifLisible } from "../../noyau/serveur";
import { t } from "../../noyau/langue";
import { parcours, useParcours } from "../../navigation/parcours";
import { Amount, Attente, Card, Chips, Dot, EtatVide, FeuilleErreur, Keypad, Line, List, Row, Screen, Squelette, Success } from "../../ui";
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

  const TOUT = t("Tout", "All");
  const choisir = (c: string) => {
    if (c === TOUT) setSaisie(String(Math.trunc(dispo)));
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
      <Screen title={t("Sortir des XAF", "Withdraw XAF")} back="/">
        {bloque > 0 ? (
          <EtatVide icone={<ScheduleRounded sx={{ fontSize: 36 }} />} tone="amber" titre={t("Vos XAFe sont engagés", "Your XAFe are tied up")}
            texte={t(`${xaf(bloque)} XAFe sont bloqués dans vos ordres ouverts ou une sortie en cours. Annulez un ordre pour les libérer.`, `${xaf(bloque)} XAFe are locked in your open orders or a withdrawal in progress. Cancel an order to free them.`)}
            action={{ label: t("Voir mes ordres", "View my orders"), to: "/marche/ordres" }} secondaire={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} />
        ) : (
          <EtatVide icone={<ArrowDownwardRounded sx={{ fontSize: 36 }} />} tone="green" titre={t("Rien à sortir pour l'instant", "Nothing to withdraw yet")}
            texte={t("Vos XAFe apparaissent ici dès que vous en avez entré par Mobile Money.", "Your XAFe show up here as soon as you add some via Mobile Money.")}
            action={{ label: t("Entrer des XAF", "Add XAF"), to: "/entrer/operateur" }} secondaire={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} />
        )}
      </Screen>
    );
  }
  /* sans code SMS, le numéro se tape à l'étape suivante : rien à faire avant */
  if (numeros && verifies.length === 0 && NUMEROS.verificationSms) {
    return (
      <Screen title={t("Sortir des XAF", "Withdraw XAF")} back="/">
        <EtatVide icone={<PhoneAndroidRounded sx={{ fontSize: 36 }} />} tone="green" titre={t("D'abord, votre numéro MoMo", "First, your MoMo number")}
          texte={t(`Vos XAF partent vers un numéro Mobile Money vérifié à votre nom. Il devient actif ${delaiDuNumero()} : ajoutez-le dès maintenant.`, `Your XAF go to a verified Mobile Money number in your name. It becomes active ${delaiDuNumero()}, so add it now.`)}
          action={{ label: t("Ajouter un numéro", "Add a number"), onClick: () => { parcours.poserRetour("/sortir/montant"); navigate("/compte/numeros/ajouter"); } }}
          secondaire={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} />
      </Screen>
    );
  }
  if (numeros && prochain && prochain > Date.now() && verifies.every((n) => new Date(n.actifDes).getTime() > Date.now())) {
    return (
      <Screen title={t("Sortir des XAF", "Withdraw XAF")} back="/">
        <EtatVide icone={<ScheduleRounded sx={{ fontSize: 36 }} />} tone="amber" titre={t("Votre numéro sera bientôt prêt", "Your number will be ready soon")}
          texte={t(`Pour votre sécurité, un numéro ajouté reçoit des sorties ${delaiDuNumero()} : ${jourRelatif(new Date(prochain).toISOString()).toLowerCase()} à ${heure(new Date(prochain))}.`, `For your security, a newly added number can receive withdrawals ${delaiDuNumero()}: ${jourRelatif(new Date(prochain).toISOString()).toLowerCase()} at ${heure(new Date(prochain))}.`)}
          action={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} secondaire={{ label: t("Mes numéros", "My numbers"), to: "/compte/numeros" }} />
      </Screen>
    );
  }

  return (
    <Screen title={t("Sortir des XAF", "Withdraw XAF")} back="/" gap={1.5}>
      <Amount
        value={saisie ? xaf(montant) : "0"}
        unit="XAFe"
        hint={soldes ? (trop ? t(`Vous n'avez que ${xaf(Math.trunc(dispo))} XAFe disponibles`, `You only have ${xaf(Math.trunc(dispo))} XAFe available`) : t(`Disponible : ${xaf(Math.trunc(dispo))} XAFe`, `Available: ${xaf(Math.trunc(dispo))} XAFe`) + (soldes.USDT.disponible + soldes.USDC.disponible > 0 ? t(" · vos USDT et USDC se vendent d'abord au Marché", " · sell your USDT and USDC on the Market first") : "")) : " "}
        hintColor={trop ? "error.main" : undefined}
      />
      <Chips items={[xaf(100000), xaf(500000), TOUT]} selected={saisie === String(Math.trunc(dispo)) && dispo > 0 ? TOUT : xaf(montant)} onSelect={choisir} />
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={(k) => setSaisie(apresFrappe(saisie, k))} />
      <Button variant="contained" disabled={!ok} onClick={() => { poser({ montant }); navigate("/sortir/destination"); }}>{t("Continuer", "Continue")}</Button>
      {/* l'autre façon de sortir ses XAFe : vers son propre wallet, sur la chaîne */}
      {ouvert.cryptoRetraits && <Button variant="text" startIcon={<AccountBalanceWalletOutlined />} component={Link} to="/crypto/retirer/XAFe/adresse">{t(`Ou vers mon wallet · ${nomsDesReseaux()}`, `Or to my wallet · ${nomsDesReseaux()}`)}</Button>}
    </Screen>
  );
}

/* ----------------------------------------------------- 2 · destination */

export function SortirDestination() {
  const navigate = useNavigate();
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  /* pendant la bêta, seuls les numéros de démo TOTEM reçoivent : la base refuse les autres (0028) */
  const { sortiesDemoSeulement } = useOuvertures();   // et se redessine quand le réglage « numeros » arrive
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
  const actif = (n: { numero: string; verifieLe: string | null; actifDes: string }) =>
    Boolean(n.verifieLe) && new Date(n.actifDes).getTime() <= Date.now() && (!sortiesDemoSeulement || numeroDeDemo(n.numero));
  const horsDemo = sortiesDemoSeulement && numeroValide(nouveau) && !numeroDeDemo(nouveau);
  const choisi = numeros?.find((n) => n.id === etat.numeroId) ?? null;

  return (
    <Screen title={t("Vers quel numéro ?", "To which number?")} back="/sortir/montant">
      {sortiesDemoSeulement && (
        <Typography variant="body2" color="text.secondary">
          {t("Pendant la bêta, vos XAFe de test sortent vers une carte de démo TOTEM (un numéro en 600). Les vrais numéros restent fermés.", "During the beta, your test XAFe go to a TOTEM demo card (a number starting with 600). Real numbers stay closed.")}
        </Typography>
      )}
      {!numeros ? <Squelette hauteur={180} /> : (
        <List>
          {numeros.map((n) => (
            <Row
              key={n.id}
              badge={n.operateur}
              primary={numeroEnTranches(n.numero)}
              secondary={sortiesDemoSeulement && !numeroDeDemo(n.numero) ? t(`${opDe(n.operateur).nom} · fermé pendant la bêta`, `${opDe(n.operateur).nom} · closed during the beta`)
                : !n.verifieLe ? t(`${opDe(n.operateur).nom} · à vérifier`, `${opDe(n.operateur).nom} · needs verification`)
                : actif(n) ? `${opDe(n.operateur).nom}${NUMEROS.verificationSms ? t(" · vérifié", " · verified") : ""}`
                : t(`${opDe(n.operateur).nom} · actif ${jourRelatif(n.actifDes).toLowerCase()} à ${heure(n.actifDes)}`, `${opDe(n.operateur).nom} · active ${jourRelatif(n.actifDes).toLowerCase()} at ${heure(n.actifDes)}`)}
              selected={n.id === etat.numeroId}
              disabled={!actif(n)}
              onClick={() => poser({ numeroId: n.id })}
            />
          ))}
          {NUMEROS.verificationSms && <Row icon={<AddRounded />} tone="green" primary={t("Ajouter un numéro", "Add a number")} secondary={t(`Actif ${delaiDuNumero()}`, `Active ${delaiDuNumero()}`)} onClick={() => { parcours.poserRetour("/sortir/destination"); navigate("/compte/numeros/ajouter"); }} />}
        </List>
      )}
      {numeros && !NUMEROS.verificationSms && (
        <Stack gap={1}>
          <Typography variant="body2" fontWeight={500}>{numeros.length ? t("Ou un autre numéro", "Or another number") : t("Le numéro Mobile Money qui reçoit", "The receiving Mobile Money number")}</Typography>
          <Stack direction="row" gap={1} alignItems="flex-start">
            <TextField label={t("Numéro MoMo ou Orange Money", "MoMo or Orange Money number")} value={numeroEnTranches(nouveau)} onChange={(e) => setNouveau(numeroSaisi(e.target.value))} type="tel" inputMode="numeric" fullWidth
              helperText={horsDemo ? t("Pendant la bêta : seulement une carte de démo TOTEM (600 …)", "During the beta: TOTEM demo cards only (600 …)") : nouveau.length >= 9 && !opNouveau ? t("Ce n'est ni un numéro MTN ni un numéro Orange", "This is neither an MTN nor an Orange number") : opNouveau ? opDe(opNouveau).nom : " "}
              error={horsDemo || (nouveau.length >= 9 && !opNouveau)}
              slotProps={{ input: { startAdornment: <Typography sx={{ mr: 1, color: "text.secondary" }}>+237</Typography>, sx: { fontVariantNumeric: "tabular-nums" } } }} />
            <Button variant="outlined" disabled={!numeroValide(nouveau) || !opNouveau || horsDemo || enCours} onClick={() => void ajouter()} sx={{ minHeight: 56, flexShrink: 0 }}>{t("Ajouter", "Add")}</Button>
          </Stack>
        </Stack>
      )}
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!choisi || !actif(choisi)} onClick={() => navigate("/sortir/verifier")}>{t("Continuer", "Continue")}</Button>
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
  if (!numero) return <Screen title={t("Vérifiez", "Review")} back="/sortir/destination"><Squelette hauteur={220} /></Screen>;
  const op = opDe(numero.operateur);

  if (sortieManuelle) {
    const { frais, envoi } = fraisSortieManuelle(etat.montant);
    const nomOk = etat.nom.trim().length >= 2 && etat.nom.trim().length <= 80;
    return (
      <Screen title={t("Vérifiez", "Review")} back="/sortir/destination">
        <Card>
          <Line label={t("Montant", "Amount")} value={`${xaf(etat.montant)} XAFe`} />
          <Line label={FRAIS.sortie > 0 ? t(`Frais (${pourcent(FRAIS.sortie)})`, `Fees (${pourcent(FRAIS.sortie)})`) : t("Frais", "Fees")} value={frais > 0 ? xaf(frais) : t("Offerts", "Free")} />
          <Divider />
          <Line label={t("Vous recevez", "You receive")} value={`${xaf(envoi)} XAF`} strong />
          <Line label={t("Vers", "To")} value={`${op.nom.split(" ")[0]} · ${numeroEnTranches(numero.numero)}`} />
          <Line label={t("Payé par", "Paid by")} value={<><Dot tone="amber" />{t("l'équipe Glisil", "the Glisil team")}</>} />
        </Card>
        <TextField
          label={t(`Nom exact du compte ${op.nom}`, `Exact ${op.nom} account name`)}
          value={etat.nom}
          onChange={(e) => poser({ nom: e.target.value.slice(0, 80) })}
          fullWidth
          autoComplete="name"
          error={etat.nom.length > 0 && !nomOk}
          helperText={t("Celui que l'opérateur affiche quand on vous envoie de l'argent. S'il ne correspond pas, la demande est refusée et vos XAFe vous reviennent.", "The name the operator shows when someone sends you money. If it doesn't match, the request is declined and your XAFe are returned to you.")}
        />
        <Typography variant="body2" textAlign="center">
          {t("Vos XAFe sont mis de côté dès votre confirmation. L'équipe Glisil vous paie, en général dans la journée, puis vous donne le transaction ID.", "Your XAFe are set aside as soon as you confirm. The Glisil team pays you, usually within the day, then gives you the transaction ID.")}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<LockRounded />} disabled={!nomOk} onClick={() => navigate("/sortir/code")}>{t("Continuer vers la vérification", "Continue to verification")}</Button>
      </Screen>
    );
  }

  const d = decouperSortie(etat.montant, op.plafondParTransfert);
  const dernierEnvoi = d.transferts[d.transferts.length - 1]?.envoi;
  const autreEnvoi = dernierEnvoi !== undefined && dernierEnvoi !== d.transferts[0]?.envoi ? xaf(dernierEnvoi) : null;

  return (
    <Screen title={t("Vérifiez", "Review")} back="/sortir/destination">
      <Card>
        <Line label={t("Montant", "Amount")} value={`${xaf(etat.montant)} XAFe`} />
        <Line label={FRAIS.sortie > 0 ? t(`Frais (${pourcent(FRAIS.sortie)})`, `Fees (${pourcent(FRAIS.sortie)})`) : t("Frais", "Fees")} value={d.frais > 0 ? xaf(d.frais) : t("Offerts", "Free")} />
        <Divider />
        <Line label={t("Vous recevez", "You receive")} value={`${xaf(d.envoi)} XAF`} strong />
        <Line label={t("Vers", "To")} value={`${op.nom.split(" ")[0]} · ${numeroEnTranches(numero.numero)}`} />
        {d.transferts.length > 1 && <Line label={t("En", "In")} value={t(`${d.transferts.length} transferts de ${xaf(d.transferts[0].envoi)}${autreEnvoi ? ` et ${autreEnvoi}` : ""}`, `${d.transferts.length} transfers of ${xaf(d.transferts[0].envoi)}${autreEnvoi ? ` and ${autreEnvoi}` : ""}`)} />}
        <Line label={t("Délai habituel", "Usual time")} value={<><Dot tone="green" />{d.transferts.length > 1 ? `${d.transferts.length} min` : "40 s"}</>} />
      </Card>
      <Typography variant="body2" textAlign="center">
        {t("Les XAFe sont bloqués à la confirmation et détruits quand le transfert est parti. Un transfert qui échoue vous revient.", "Your XAFe are locked when you confirm and burned once the transfer has gone out. A failed transfer is returned to you.")}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" startIcon={<LockRounded />} onClick={() => navigate("/sortir/code")}>{t("Continuer vers la vérification", "Continue to verification")}</Button>
    </Screen>
  );
}

/* ------------------------------------------------------------- 4 · code */

export function SortirCode() {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [etat] = useParcours("sortir");
  const { sortieManuelle, pret } = useOuvertures();

  if (!etat.montant || !etat.numeroId) return <Navigate to="/sortir/montant" replace />;
  /* le mode (manuel ou non) décide si le nom fait partie de l'opération : on l'attend, sinon le
     code demandé à l'ouverture ne correspondrait plus, et le second attendrait une minute */
  if (!pret) return <Screen title={t("Vérification", "Verification")} back="/sortir/verifier"><Squelette hauteur={320} /></Screen>;
  const nom = sortieManuelle ? etat.nom.trim() : undefined;

  return (
    <Screen title={t("Vérification", "Verification")} back="/sortir/verifier" gap={1.5}>
      <EtapeDeVerification
        op={{ operation: "sortie_momo", montant: etat.montant, numeroId: etat.numeroId, ...(nom ? { nom } : {}) }}
        intention={{ montant: etat.montant, numeroId: etat.numeroId, nom: etat.nom }}
        resume={<Line label={t("Vous envoyez", "You send")} value={`${xaf(etat.montant)} XAFe`} strong />}
        libelle={t(`Envoyer ${xaf(etat.montant)} XAFe`, `Send ${xaf(etat.montant)} XAFe`)}
        executer={async (preuve, cle) => {
          const s = await guichet.demanderSortie({ montant: etat.montant, numeroId: etat.numeroId!, cle, preuve, ...(nom ? { nom } : {}) });
          /* le parcours s'efface à l'arrivée sur « Envoyé », jamais ici : cet écran se redessinerait sans montant et repartirait au début */
          navigate(`/sortir/envoye/${s.reference}`, { replace: true });
        }}
      />
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
  const faits = s.transferts.filter((tr) => tr.etat === "faite").length;

  if (s.etat === "annulee") {
    return (
      <Success tone="amber" icone={<UndoRounded sx={{ fontSize: 56 }} />} title={t("Demande refusée", "Request declined")} amount={t(`${xaf(s.montantRendu || s.montant)} XAFe revenus`, `${xaf(s.montantRendu || s.montant)} XAFe returned`)}
        caption={s.motif ? t(`${s.motif} Vos XAFe sont de nouveau disponibles.`, `${motifLisible(s.motif)} Your XAFe are available again.`) : t("Vos XAFe sont de nouveau disponibles.", "Your XAFe are available again.")}
        primary={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} secondary={{ label: t("Voir le détail", "View details"), to: `/historique/${s.reference}` }} />
    );
  }

  if (s.mode === "manuel" && s.etat !== "envoyee") return <SortieManuelleEnCours s={s} />;

  if (s.etat === "envoyee") {
    return (
      <Success title={t(`${xaf(s.montantEnvoye)} XAF envoyés`, `${xaf(s.montantEnvoye)} XAF sent`)} amount={t(`au ${numeroEnTranches(s.numero)}`, `to ${numeroEnTranches(s.numero)}`)}
        caption={t(`${op.nom}, ${quand(s.termineeLe ?? s.creeLe)}${s.transferts.length > 1 ? `, en ${s.transferts.length} transferts` : ""}.${s.mode === "manuel" && s.prouveeLe ? " Confirmation envoyée par e-mail." : ""}`, `${op.nom}, ${quand(s.termineeLe ?? s.creeLe)}${s.transferts.length > 1 ? `, in ${s.transferts.length} transfers` : ""}.${s.mode === "manuel" && s.prouveeLe ? " Confirmation sent by email." : ""}`)}
        primary={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} secondary={{ label: t("Voir le reçu", "View receipt"), to: `/historique/${s.reference}` }}>
        <Card>
          <Line label={t("XAFe débités", "XAFe debited")} value={xaf(s.montant)} />
          <Line label={t("XAFe détruits", "XAFe burned")} value={xaf(s.montantEnvoye)} />
          <Line label={t("Frais", "Fees")} value={xaf(s.frais)} />
          <Line label={t("Référence", "Reference")} value={s.reference} mono />
          {(s.paiements?.length ? s.paiements : s.transactionId ? [{ transactionId: s.transactionId, montant: s.montantXaf }] : []).map((p) => (
            <Line key={p.transactionId} label={t(`Transaction ID ${op.nom.split(" ")[0]}`, `${op.nom.split(" ")[0]} transaction ID`)} value={(s.paiements?.length ?? 0) > 1 ? `${p.transactionId} · ${xaf(p.montant)} XAF` : p.transactionId} mono />
          ))}
          {s.mode === "manuel" && s.payeeLe && <Line label={t("Payé le", "Paid on")} value={quand(s.payeeLe)} />}
          {s.transferts.filter((tr) => tr.referenceOperateur).map((tr, i) => <Line key={i} label={t(`Transaction ID ${op.nom.split(" ")[0]}`, `${op.nom.split(" ")[0]} transaction ID`)} value={tr.referenceOperateur!} mono />)}
        </Card>
      </Success>
    );
  }

  if (s.etat === "echouee" || s.etat === "partielle") {
    return (
      <Success tone={s.etat === "echouee" ? "red" : "amber"} title={s.etat === "echouee" ? t("Le transfert n'est pas parti", "The transfer didn't go through") : t("Sortie partielle", "Partial withdrawal")}
        amount={s.etat === "echouee" ? t(`${xaf(s.montantRendu)} XAFe revenus`, `${xaf(s.montantRendu)} XAFe returned`) : t(`${xaf(s.montantEnvoye)} XAF envoyés`, `${xaf(s.montantEnvoye)} XAF sent`)}
        caption={s.etat === "echouee" ? t(`${op.nom} n'a pas accepté le transfert après trois essais. Vos XAFe sont de nouveau disponibles.`, `${op.nom} didn't accept the transfer after three attempts. Your XAFe are available again.`) : t(`${xaf(s.montantRendu)} XAFe n'ont pas pu partir et sont revenus sur votre compte.`, `${xaf(s.montantRendu)} XAFe couldn't be sent and are back in your account.`)}
        primary={{ label: t("Voir le détail", "View details"), to: `/historique/${s.reference}` }} secondary={{ label: t("Retour à l'accueil", "Back to home"), to: "/" }} />
    );
  }

  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
        <CircularProgress size={64} thickness={3} />
        <Typography variant="h6">{t("En cours", "In progress")}</Typography>
        <Typography variant="h4" color="primary.main">{xaf(s.montantXaf)} XAF</Typography>
        <Typography variant="body2">
          {t(`TOTEM compose le transfert vers le ${numeroEnTranches(s.numero)}${s.transferts.length > 1 ? ` · ${faits}/${s.transferts.length} partis` : ""}. Cet écran bascule tout seul.`, `TOTEM is sending the transfer to ${numeroEnTranches(s.numero)}${s.transferts.length > 1 ? ` · ${faits}/${s.transferts.length} sent` : ""}. This screen updates automatically.`)}
        </Typography>
        <Typography variant="caption">{t(`Demandé ${quand(s.creeLe)} · ${duree((Date.now() - new Date(s.creeLe).getTime()) / 1000)} écoulées`, `Requested ${quand(s.creeLe)} · ${duree((Date.now() - new Date(s.creeLe).getTime()) / 1000)} elapsed`)}</Typography>
      </Box>
      <Button variant="text" component={Link} to="/" replace>{t("Retour à l'accueil, je serai prévenu", "Back to home, I'll be notified")}</Button>
    </Screen>
  );
}

/* Payée à la main : trois étapes que le client voit avancer — reçue, prise en charge, payée. */
/** Les ID du paiement : un par transfert (0038), sinon le seul ID d'avant. */
export const idsDuPaiement = (s: import("../../guichet/types").Sortie) => (s.paiements ?? []).map((p) => p.transactionId).join(", ") || s.transactionId || "";

function SortieManuelleEnCours({ s }: { s: import("../../guichet/types").Sortie }) {
  const ids = idsDuPaiement(s);
  const etapes = [
    { fait: true, titre: t("Demande reçue", "Request received"), texte: t(`${quand(s.creeLe)} · vos XAFe sont mis de côté`, `${quand(s.creeLe)} · your XAFe are set aside`) },
    { fait: Boolean(s.prisLe), titre: t("Prise en charge", "Being processed"), texte: s.prisLe ? t(`${quand(s.prisLe)} · l'équipe Glisil s'en occupe`, `${quand(s.prisLe)} · the Glisil team is on it`) : t("l'équipe Glisil va s'en occuper", "the Glisil team will handle it") },
    { fait: Boolean(s.payeeLe), titre: t("Payée", "Paid"), texte: s.payeeLe && ids ? t(`${quand(s.payeeLe)} · Transaction ID ${ids}`, `${quand(s.payeeLe)} · transaction ID ${ids}`) : t("vous recevrez le transaction ID", "you'll receive the transaction ID") },
    /* l'argent ne quitte vraiment Glisil que lorsque le SMS de l'opérateur, sur la puce qui a payé, montre ce paiement */
    { fait: false, titre: t("Vérifiée", "Verified"), texte: s.etat === "en_preuve"
        ? t("Glisil retrouve ce paiement dans les relevés de l'opérateur, puis vous le confirme par notification et par e-mail.", "Glisil is matching this payment with the operator's records, then confirms it by notification and email.")
        : t("après le paiement", "after payment") },
  ];
  return (
    <Screen title={t("Votre sortie", "Your withdrawal")} back="/">
      <Stack alignItems="center" gap={0.5} sx={{ py: 2 }}>
        <Typography variant="body2">{t("Vous allez recevoir", "You will receive")}</Typography>
        <Typography variant="h4" color="primary.main">{xaf(s.montantXaf)} XAF</Typography>
        <Typography variant="body2">{t(`au ${numeroEnTranches(s.numero)}`, `to ${numeroEnTranches(s.numero)}`)}{s.nomBeneficiaire ? ` · ${s.nomBeneficiaire}` : ""}</Typography>
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
        <Line label={t("XAFe mis de côté", "XAFe set aside")} value={xaf(s.montant)} />
        <Line label={t("Frais", "Fees")} value={xaf(s.frais)} />
        {(s.paiements ?? []).map((p) => <Line key={p.transactionId} label="Transaction ID" /* langue-ok */ value={(s.paiements ?? []).length > 1 ? `${p.transactionId} · ${xaf(p.montant)} XAF` : p.transactionId} mono />)}
        <Line label={t("Référence", "Reference")} value={s.reference} mono />
      </Card>
      <Typography variant="body2" textAlign="center">{t("Cet écran avance tout seul. Vous êtes aussi prévenu par une notification.", "This screen updates automatically. You'll also get a notification.")}</Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" component={Link} to="/" replace>{t("Retour à l'accueil", "Back to home")}</Button>
    </Screen>
  );
}
