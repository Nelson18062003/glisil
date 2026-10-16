/*
 * L'INSCRIPTION : quatre questions, une par écran, puis le récapitulatif.
 *   1. qui êtes-vous      prénom, nom
 *   2. votre naissance    jour / mois / année — 18 ans révolus
 *   3. votre téléphone    le pays, puis le numéro, mis en forme pendant la frappe
 *   4. où vivez-vous      pays et ville de résidence
 *   5. vérifiez           tout se relit et se corrige, puis le compte s'ouvre
 * Chaque champ est mis en forme et vérifié pendant qu'on tape (noyau/identite.ts) ;
 * la base revérifie tout (ouvrir_mon_compte). Le brouillon survit à un
 * rechargement de la page, le temps de la session.
 */
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import { Autocomplete, Box, Button, Checkbox, FormControlLabel, InputAdornment, LinearProgress, Stack, TextField, Typography } from "@mui/material";
import type { CountryCode } from "libphonenumber-js/min";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useGuichet } from "../../guichet";
import { lisible } from "../../noyau/erreurs";
import { dateDepuis, nomPropre, nomValide, PAYS, paysDe, telephoneE164, telephoneEnDirect, telephoneLisible, verdictNaissance, VILLES, type Pays } from "../../noyau/identite";
import { useSession } from "../../session/session";
import { FeuilleErreur, Screen } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

type Brouillon = {
  prenom: string; nom: string;
  jour: string; mois: string; annee: string;
  paysTel: CountryCode; tel: string;
  pays: CountryCode; ville: string;
};
const VIDE: Brouillon = { prenom: "", nom: "", jour: "", mois: "", annee: "", paysTel: "CM", tel: "", pays: "CM", ville: "" };
const CLE = "glisil.inscription";
const lire = (): Brouillon => { try { return { ...VIDE, ...JSON.parse(sessionStorage.getItem(CLE) ?? "{}") }; } catch { return VIDE; } };
const garder = (b: Brouillon) => { try { sessionStorage.setItem(CLE, JSON.stringify(b)); } catch { /* sans stockage, le brouillon vit le temps de l'écran */ } };
const oublier = () => { try { sessionStorage.removeItem(CLE); } catch { /* idem */ } };

const ETAPES = ["identite", "naissance", "telephone", "residence", "verifier"] as const;
type Etape = (typeof ETAPES)[number];

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/* ------------------------------------------------------------ morceaux */

function Question({ titre, texte }: { titre: string; texte: string }) {
  return (
    <Stack gap={0.75}>
      <Typography variant="h5" sx={{ textWrap: "balance" }}>{titre}</Typography>
      <Typography variant="body2">{texte}</Typography>
    </Stack>
  );
}

const Bon = () => <CheckCircleRounded sx={{ color: "primary.main" }} aria-label="valide" />;

function ChoixPays({ label, valeur, onChange, avecIndicatif }: { label: string; valeur: CountryCode; onChange: (c: CountryCode) => void; avecIndicatif?: boolean }) {
  const p = paysDe(valeur) ?? null;
  return (
    <Autocomplete<Pays, false, true>
      options={PAYS}
      value={p ?? PAYS[0]}
      disableClearable
      onChange={(_, v) => v && onChange(v.code)}
      getOptionLabel={(o) => (avecIndicatif ? `${o.nom} (${o.indicatif})` : o.nom)}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      filterOptions={(opts, { inputValue }) => {
        const q = inputValue.trim().toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "");
        if (!q) return opts;
        return opts.filter((o) => o.nom.toLocaleLowerCase("fr").normalize("NFD").replace(/\p{M}/gu, "").includes(q) || o.indicatif.includes(q) || o.code.toLowerCase() === q);
      }}
      renderOption={(props, o) => {
        const { key, ...reste } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...reste} sx={{ display: "flex", gap: 1.5 }}>
            <span aria-hidden style={{ fontSize: 22 }}>{o.drapeau}</span>
            <Box sx={{ flex: 1, minWidth: 0 }}>{o.nom}</Box>
            {avecIndicatif && <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{o.indicatif}</Typography>}
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} label={label}
          slotProps={{ input: { ...params.InputProps, startAdornment: p ? <InputAdornment position="start"><span aria-hidden style={{ fontSize: 22 }}>{p.drapeau}</span></InputAdornment> : null } }} />
      )}
    />
  );
}

/* -------------------------------------------------------------- l'écran */

export function Inscription() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const [b, setB] = useState<Brouillon>(lire);
  const [etape, setEtape] = useState<Etape>("identite");
  const [vu, setVu] = useState<Record<string, boolean>>({});
  const [certifie, setCertifie] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const refMois = useRef<HTMLInputElement>(null);
  const refAnnee = useRef<HTMLInputElement>(null);

  useEffect(() => garder(b), [b]);
  const maj = (p: Partial<Brouillon>) => setB((x) => ({ ...x, ...p }));
  const voir = (champ: string) => setVu((v) => ({ ...v, [champ]: true }));

  /* ce que chaque étape vaut */
  const prenomOk = nomValide(b.prenom), nomOk = nomValide(b.nom);
  const naissance = verdictNaissance(b.jour, b.mois, b.annee);
  const e164 = telephoneE164(b.paysTel, b.tel);
  const villeOk = nomValide(b.ville);
  const pret: Record<Etape, boolean> = {
    identite: prenomOk && nomOk,
    naissance: naissance.ok,
    telephone: Boolean(e164),
    residence: villeOk && Boolean(paysDe(b.pays)),
    verifier: certifie,
  };

  const index = ETAPES.indexOf(etape);
  const aller = (e: Etape) => { setEtape(e); window.scrollTo?.(0, 0); };
  const suivant = () => { if (pret[etape] && index < ETAPES.length - 1) aller(ETAPES[index + 1]); };
  const precedent = () => (index > 0 ? aller(ETAPES[index - 1]) : void session.deconnecter().then(() => navigate("/bienvenue", { replace: true })));

  const ouvrir = () =>
    lancer(async () => {
      try {
        const compte = await guichet.ouvrirCompte({
          prenom: nomPropre(b.prenom).trim(), nom: nomPropre(b.nom).trim(), naissance: dateDepuis(b.jour, b.mois, b.annee)!,
          telephone: e164!, ville: nomPropre(b.ville).trim(), pays: b.pays,
        });
        oublier();
        session.compteOuvert(compte);
        navigate("/bienvenue/profil", { replace: true });
      } catch (e) {
        /* on ramène la personne à l'étape qui pèche */
        const t = lisible(e).titre.toLowerCase();
        if (t.includes("numéro")) aller("telephone");
        else if (t.includes("18 ans") || t.includes("naissance")) aller("naissance");
        else if (t.includes("prénom") || t.startsWith("ce nom")) aller("identite");
        else if (t.includes("ville") || t.includes("pays")) aller("residence");
        throw e;
      }
    });

  const villes = useMemo(() => VILLES[b.pays] ?? [], [b.pays]);

  let contenu: ReactNode;
  if (etape === "identite") {
    contenu = (
      <>
        <Question titre="Comment vous appelez-vous ?" texte="Comme sur votre pièce d'identité : c'est le nom qui figurera sur vos reçus." />
        <TextField label="Prénom" value={b.prenom} onChange={(e) => maj({ prenom: nomPropre(e.target.value) })} onBlur={() => voir("prenom")}
          autoComplete="given-name" autoFocus fullWidth error={vu.prenom && !prenomOk}
          helperText={vu.prenom && !prenomOk ? "Des lettres seulement, au moins deux." : " "}
          slotProps={{ input: { endAdornment: prenomOk ? <InputAdornment position="end"><Bon /></InputAdornment> : null } }} />
        <TextField label="Nom de famille" value={b.nom} onChange={(e) => maj({ nom: nomPropre(e.target.value) })} onBlur={() => voir("nom")}
          autoComplete="family-name" fullWidth error={vu.nom && !nomOk}
          helperText={vu.nom && !nomOk ? "Des lettres seulement, au moins deux." : " "}
          slotProps={{ input: { endAdornment: nomOk ? <InputAdornment position="end"><Bon /></InputAdornment> : null } }} />
      </>
    );
  } else if (etape === "naissance") {
    const message = naissance.ok
      ? `Vous avez ${naissance.age} ans.`
      : naissance.raison === "incomplete" ? "Le jour, le mois, puis l'année en quatre chiffres."
      : naissance.raison === "inexistante" ? "Cette date n'existe pas : vérifiez le jour et le mois."
      : naissance.raison === "future" ? "Cette date est dans le futur."
      : naissance.raison === "mineur" ? "Glisil est réservé aux personnes de 18 ans et plus."
      : "Vérifiez l'année.";
    const enErreur = !naissance.ok && naissance.raison !== "incomplete";
    const chiffres = (v: string, n: number) => v.replace(/\D/g, "").slice(0, n);
    contenu = (
      <>
        <Question titre="Quelle est votre date de naissance ?" texte="Glisil est un service financier : il faut avoir 18 ans pour ouvrir un compte." />
        <Stack direction="row" gap={1.5}>
          <TextField label="Jour" value={b.jour} placeholder="JJ" inputMode="numeric" autoComplete="bday-day" autoFocus
            onChange={(e) => { const v = chiffres(e.target.value, 2); maj({ jour: v }); if (v.length === 2) refMois.current?.focus(); }}
            sx={{ flex: 1 }} error={enErreur} slotProps={{ htmlInput: { style: { textAlign: "center", fontSize: 20 } } }} />
          <TextField label="Mois" value={b.mois} placeholder="MM" inputMode="numeric" autoComplete="bday-month" inputRef={refMois}
            onChange={(e) => { const v = chiffres(e.target.value, 2); maj({ mois: v }); if (v.length === 2) refAnnee.current?.focus(); }}
            sx={{ flex: 1 }} error={enErreur} slotProps={{ htmlInput: { style: { textAlign: "center", fontSize: 20 } } }} />
          <TextField label="Année" value={b.annee} placeholder="AAAA" inputMode="numeric" autoComplete="bday-year" inputRef={refAnnee}
            onChange={(e) => maj({ annee: chiffres(e.target.value, 4) })}
            sx={{ flex: 1.4 }} error={enErreur} slotProps={{ htmlInput: { style: { textAlign: "center", fontSize: 20 } } }} />
        </Stack>
        <Stack direction="row" gap={1} alignItems="center" role="status">
          {naissance.ok && <Bon />}
          <Typography variant="body2" sx={{ color: enErreur ? "error.main" : naissance.ok ? "primary.main" : "text.secondary", fontWeight: naissance.ok ? 600 : 400 }}>
            {naissance.ok ? `${Number(b.jour)} ${MOIS[Number(b.mois) - 1]} ${b.annee} · ${message}` : message}
          </Typography>
        </Stack>
      </>
    );
  } else if (etape === "telephone") {
    const p = paysDe(b.paysTel);
    contenu = (
      <>
        <Question titre="Votre numéro de téléphone" texte="Pour vous joindre si quelque chose demande votre attention. Il ne sert qu'à un seul compte." />
        <ChoixPays label="Pays du numéro" valeur={b.paysTel} avecIndicatif onChange={(c) => maj({ paysTel: c, tel: "", pays: b.ville ? b.pays : c })} />
        <TextField label="Numéro de téléphone" value={telephoneEnDirect(b.paysTel, b.tel)} onChange={(e) => maj({ tel: e.target.value.replace(/[^\d]/g, "").slice(0, 15) })}
          onBlur={() => voir("tel")} type="tel" inputMode="tel" autoComplete="tel-national" autoFocus fullWidth
          placeholder={b.paysTel === "CM" ? "6 77 12 34 56" : undefined}
          error={vu.tel && b.tel.length > 0 && !e164}
          helperText={vu.tel && b.tel.length > 0 && !e164 ? (b.paysTel === "CM" ? "Au Cameroun : 9 chiffres, commençant par 6 (mobile) ou 2 (fixe)." : "Ce numéro n'est pas valide pour ce pays.") : e164 ? `Sera enregistré : ${telephoneLisible(e164)}` : " "}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><Typography sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{p?.indicatif}</Typography></InputAdornment>,
              endAdornment: e164 ? <InputAdornment position="end"><Bon /></InputAdornment> : null,
              sx: { fontSize: 20, fontVariantNumeric: "tabular-nums" },
            },
          }} />
      </>
    );
  } else if (etape === "residence") {
    contenu = (
      <>
        <Question titre="Où vivez-vous ?" texte="Votre pays et votre ville de résidence aujourd'hui." />
        <ChoixPays label="Pays de résidence" valeur={b.pays} onChange={(c) => maj({ pays: c, ville: "" })} />
        <Autocomplete<string, false, false, true>
          freeSolo
          options={villes}
          inputValue={b.ville}
          onInputChange={(_, v) => maj({ ville: nomPropre(v) })}
          renderInput={(params) => (
            <TextField {...params} label="Ville" autoComplete="address-level2" onBlur={() => voir("ville")}
              error={vu.ville && !villeOk} helperText={vu.ville && !villeOk ? "Le nom de votre ville, en lettres." : villes.length ? "Tapez les premières lettres, ou une ville qui n'est pas dans la liste." : " "} />
          )}
        />
      </>
    );
  } else {
    const ligne = (label: string, valeur: string, e: Etape) => (
      <Box component="button" type="button" onClick={() => aller(e)}
        sx={{ all: "unset", boxSizing: "border-box", width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 1, py: 1.5, borderBottom: 1, borderColor: "divider", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2, borderRadius: 1 } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" component="div">{label}</Typography>
          <Typography variant="subtitle1" sx={{ overflowWrap: "anywhere" }}>{valeur}</Typography>
        </Box>
        <Typography variant="body2" sx={{ color: "primary.main", fontWeight: 600 }}>Modifier</Typography>
        <ChevronRightRounded sx={{ color: "text.secondary" }} />
      </Box>
    );
    contenu = (
      <>
        <Question titre="Vérifiez vos informations" texte="Elles servent à vérifier votre identité. Touchez une ligne pour la corriger." />
        <Box sx={{ bgcolor: "background.paper", borderRadius: 4, px: 2 }}>
          {ligne("Prénom et nom", `${nomPropre(b.prenom).trim()} ${nomPropre(b.nom).trim()}`, "identite")}
          {ligne("Date de naissance", naissance.ok ? `${Number(b.jour)} ${MOIS[Number(b.mois) - 1]} ${b.annee}` : "—", "naissance")}
          {ligne("Téléphone", e164 ? telephoneLisible(e164) : "—", "telephone")}
          {ligne("Résidence", `${nomPropre(b.ville).trim()}, ${paysDe(b.pays)?.nom ?? b.pays}`, "residence")}
        </Box>
        <FormControlLabel
          control={<Checkbox checked={certifie} onChange={(e) => setCertifie(e.target.checked)} />}
          label={<Typography variant="body2" sx={{ color: "text.primary" }}>Je certifie que ces informations sont exactes et qu'elles sont les miennes.</Typography>}
          sx={{ alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.5 } }}
        />
      </>
    );
  }

  return (
    <Screen onBack={precedent} gap={2.5}>
      <Stack gap={1} sx={{ mt: -1 }}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption">{etape === "verifier" ? "Dernière étape" : `Étape ${index + 1} sur 4`}</Typography>
          <Typography variant="caption">Ouverture de votre compte</Typography>
        </Stack>
        <LinearProgress variant="determinate" value={((index + 1) / ETAPES.length) * 100} sx={{ height: 6, borderRadius: 3, bgcolor: "divider" }} aria-label="Avancement de l'inscription" />
      </Stack>
      <Box key={etape} component="form" onSubmit={(e) => { e.preventDefault(); if (etape === "verifier") { if (certifie) void ouvrir(); } else suivant(); }}
        sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2.5,
              "@media (prefers-reduced-motion: no-preference)": { animation: "glisil-glisse 260ms cubic-bezier(.2,.8,.2,1)" },
              "@keyframes glisil-glisse": { from: { opacity: 0, transform: "translateX(24px)" }, to: { opacity: 1, transform: "none" } } }}>
        {contenu}
        <Box sx={{ flex: 1 }} />
        <Button type="submit" variant="contained" disabled={!pret[etape] || enCours}>
          {etape === "verifier" ? (enCours ? "Ouverture du compte…" : "Ouvrir mon compte") : "Continuer"}
        </Button>
      </Box>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}
