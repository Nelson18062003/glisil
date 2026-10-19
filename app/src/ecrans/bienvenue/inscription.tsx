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
import { VERSION_CONDITIONS } from "../../noyau/conditions";
import { CaseConditions } from "../legal";
import { lisible } from "../../noyau/erreurs";
import { dateDepuis, nomPropre, nomValide, PAYS, paysDe, telephoneE164, telephoneEnDirect, telephoneLisible, verdictNaissance, VILLES, type Pays } from "../../noyau/identite";
import { t } from "../../noyau/langue";
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

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]; // langue-ok
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; // langue-ok : les mois anglais
/** « 5 mars 2000 » ; en anglais « March 5, 2000 ». */
const dateLisible = (jour: string, mois: string, annee: string) =>
  t(`${Number(jour)} ${MOIS[Number(mois) - 1]} ${annee}`, `${MONTHS[Number(mois) - 1]} ${Number(jour)}, ${annee}`);

/* ------------------------------------------------------------ morceaux */

function Question({ titre, texte }: { titre: string; texte: string }) {
  return (
    <Stack gap={0.75}>
      <Typography variant="h5" sx={{ textWrap: "balance" }}>{titre}</Typography>
      <Typography variant="body2">{texte}</Typography>
    </Stack>
  );
}

const Bon = () => <CheckCircleRounded sx={{ color: "primary.main" }} aria-label={t("valide", "valid")} />;

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
  const [accepte, setAccepte] = useState(false);
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
    verifier: certifie && accepte,
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
          telephone: e164!, ville: nomPropre(b.ville).trim(), pays: b.pays, conditions: VERSION_CONDITIONS,
        });
        oublier();
        session.compteOuvert(compte);
        navigate("/bienvenue/profil", { replace: true });
      } catch (e) {
        /* on ramène la personne à l'étape qui pèche — d'après le titre de noyau/erreurs, dans l'une ou l'autre langue */
        const titre = lisible(e).titre.toLowerCase();
        if (titre.includes("numéro") || titre.includes("number")) aller("telephone"); // langue-ok
        else if (titre.includes("18 ans") || titre.includes("naissance") || titre.includes("18 or older") || titre.includes("date of birth")) aller("naissance");
        else if (titre.includes("prénom") || titre.startsWith("ce nom") || titre.includes("first name") || titre.startsWith("this last name")) aller("identite"); // langue-ok
        else if (titre.includes("ville") || titre.includes("pays") || titre.includes("city") || titre.includes("country")) aller("residence");
        throw e;
      }
    });

  const villes = useMemo(() => VILLES[b.pays] ?? [], [b.pays]);

  let contenu: ReactNode;
  if (etape === "identite") {
    contenu = (
      <>
        <Question titre={t("Comment vous appelez-vous ?", "What's your name?")} texte={t("Comme sur votre pièce d'identité : c'est le nom qui figurera sur vos reçus.", "As shown on your ID: this is the name that will appear on your receipts.")} />
        <TextField label={t("Prénom", "First name")} value={b.prenom} onChange={(e) => maj({ prenom: nomPropre(e.target.value) })} onBlur={() => voir("prenom")}
          autoComplete="given-name" autoFocus fullWidth error={vu.prenom && !prenomOk}
          helperText={vu.prenom && !prenomOk ? t("Des lettres seulement, au moins deux.", "Letters only, at least two.") : " "}
          slotProps={{ input: { endAdornment: prenomOk ? <InputAdornment position="end"><Bon /></InputAdornment> : null } }} />
        <TextField label={t("Nom de famille", "Last name")} value={b.nom} onChange={(e) => maj({ nom: nomPropre(e.target.value) })} onBlur={() => voir("nom")}
          autoComplete="family-name" fullWidth error={vu.nom && !nomOk}
          helperText={vu.nom && !nomOk ? t("Des lettres seulement, au moins deux.", "Letters only, at least two.") : " "}
          slotProps={{ input: { endAdornment: nomOk ? <InputAdornment position="end"><Bon /></InputAdornment> : null } }} />
      </>
    );
  } else if (etape === "naissance") {
    const message = naissance.ok
      ? t(`Vous avez ${naissance.age} ans.`, `You are ${naissance.age} years old.`)
      : naissance.raison === "incomplete" ? t("Le jour, le mois, puis l'année en quatre chiffres.", "Day, month, then the year in four digits.")
      : naissance.raison === "inexistante" ? t("Cette date n'existe pas : vérifiez le jour et le mois.", "This date doesn't exist: check the day and month.")
      : naissance.raison === "future" ? t("Cette date est dans le futur.", "This date is in the future.")
      : naissance.raison === "mineur" ? t("Glisil est réservé aux personnes de 18 ans et plus.", "Glisil is only for people aged 18 and over.")
      : t("Vérifiez l'année.", "Check the year.");
    const enErreur = !naissance.ok && naissance.raison !== "incomplete";
    const chiffres = (v: string, n: number) => v.replace(/\D/g, "").slice(0, n);
    contenu = (
      <>
        <Question titre={t("Quelle est votre date de naissance ?", "What's your date of birth?")} texte={t("Glisil est un service financier : il faut avoir 18 ans pour ouvrir un compte.", "Glisil is a financial service: you must be 18 to open an account.")} />
        <Stack direction="row" gap={1.5}>
          <TextField label={t("Jour", "Day")} value={b.jour} placeholder={t("JJ", "DD")} inputMode="numeric" autoComplete="bday-day" autoFocus
            onChange={(e) => { const v = chiffres(e.target.value, 2); maj({ jour: v }); if (v.length === 2) refMois.current?.focus(); }}
            sx={{ flex: 1 }} error={enErreur} slotProps={{ htmlInput: { style: { textAlign: "center", fontSize: 20 } } }} />
          <TextField label={t("Mois", "Month")} value={b.mois} placeholder="MM" inputMode="numeric" autoComplete="bday-month" inputRef={refMois}
            onChange={(e) => { const v = chiffres(e.target.value, 2); maj({ mois: v }); if (v.length === 2) refAnnee.current?.focus(); }}
            sx={{ flex: 1 }} error={enErreur} slotProps={{ htmlInput: { style: { textAlign: "center", fontSize: 20 } } }} />
          <TextField label={t("Année", "Year")} value={b.annee} placeholder={t("AAAA", "YYYY")} inputMode="numeric" autoComplete="bday-year" inputRef={refAnnee}
            onChange={(e) => maj({ annee: chiffres(e.target.value, 4) })}
            sx={{ flex: 1.4 }} error={enErreur} slotProps={{ htmlInput: { style: { textAlign: "center", fontSize: 20 } } }} />
        </Stack>
        <Stack direction="row" gap={1} alignItems="center" role="status">
          {naissance.ok && <Bon />}
          <Typography variant="body2" sx={{ color: enErreur ? "error.main" : naissance.ok ? "primary.main" : "text.secondary", fontWeight: naissance.ok ? 600 : 400 }}>
            {naissance.ok ? `${dateLisible(b.jour, b.mois, b.annee)} · ${message}` : message}
          </Typography>
        </Stack>
      </>
    );
  } else if (etape === "telephone") {
    const p = paysDe(b.paysTel);
    contenu = (
      <>
        <Question titre={t("Votre numéro de téléphone", "Your phone number")} texte={t("Pour vous joindre si quelque chose demande votre attention. Il ne sert qu'à un seul compte.", "So we can reach you if something needs your attention. It can only be used for one account.")} />
        <ChoixPays label={t("Pays du numéro", "Phone number country")} valeur={b.paysTel} avecIndicatif onChange={(c) => maj({ paysTel: c, tel: "", pays: b.ville ? b.pays : c })} />
        <TextField label={t("Numéro de téléphone", "Phone number")} value={telephoneEnDirect(b.paysTel, b.tel)} onChange={(e) => maj({ tel: e.target.value.replace(/[^\d]/g, "").slice(0, 15) })}
          onBlur={() => voir("tel")} type="tel" inputMode="tel" autoComplete="tel-national" autoFocus fullWidth
          placeholder={b.paysTel === "CM" ? "6 77 12 34 56" : undefined}
          error={vu.tel && b.tel.length > 0 && !e164}
          helperText={vu.tel && b.tel.length > 0 && !e164 ? (b.paysTel === "CM" ? t("Au Cameroun : 9 chiffres, commençant par 6 (mobile) ou 2 (fixe).", "In Cameroon: 9 digits, starting with 6 (mobile) or 2 (landline).") : t("Ce numéro n'est pas valide pour ce pays.", "This number isn't valid for this country.")) : e164 ? t(`Sera enregistré : ${telephoneLisible(e164)}`, `Will be saved as: ${telephoneLisible(e164)}`) : " "}
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
        <Question titre={t("Où vivez-vous ?", "Where do you live?")} texte={t("Votre pays et votre ville de résidence aujourd'hui.", "Your current country and city of residence.")} />
        <ChoixPays label={t("Pays de résidence", "Country of residence")} valeur={b.pays} onChange={(c) => maj({ pays: c, ville: "" })} />
        <Autocomplete<string, false, false, true>
          freeSolo
          options={villes}
          inputValue={b.ville}
          onInputChange={(_, v) => maj({ ville: nomPropre(v) })}
          renderInput={(params) => (
            <TextField {...params} label={t("Ville", "City")} autoComplete="address-level2" onBlur={() => voir("ville")}
              error={vu.ville && !villeOk} helperText={vu.ville && !villeOk ? t("Le nom de votre ville, en lettres.", "Your city's name, in letters.") : villes.length ? t("Tapez les premières lettres, ou une ville qui n'est pas dans la liste.", "Type the first few letters, or a city that isn't on the list.") : " "} />
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
        <Typography variant="body2" sx={{ color: "primary.main", fontWeight: 600 }}>{t("Modifier", "Edit")}</Typography>
        <ChevronRightRounded sx={{ color: "text.secondary" }} />
      </Box>
    );
    contenu = (
      <>
        <Question titre={t("Vérifiez vos informations", "Check your details")} texte={t("Elles servent à vérifier votre identité. Touchez une ligne pour la corriger.", "They're used to verify your identity. Tap a line to correct it.")} />
        <Box sx={{ bgcolor: "background.paper", borderRadius: 4, px: 2 }}>
          {ligne(t("Prénom et nom", "Full name"), `${nomPropre(b.prenom).trim()} ${nomPropre(b.nom).trim()}`, "identite")}
          {ligne(t("Date de naissance", "Date of birth"), naissance.ok ? dateLisible(b.jour, b.mois, b.annee) : "—", "naissance")}
          {ligne(t("Téléphone", "Phone"), e164 ? telephoneLisible(e164) : "—", "telephone")}
          {ligne(t("Résidence", "Residence"), `${nomPropre(b.ville).trim()}, ${paysDe(b.pays)?.nom ?? b.pays}`, "residence")}
        </Box>
        <FormControlLabel
          control={<Checkbox checked={certifie} onChange={(e) => setCertifie(e.target.checked)} />}
          label={<Typography variant="body2" sx={{ color: "text.primary" }}>{t("Je certifie que ces informations sont exactes et qu'elles sont les miennes.", "I certify that this information is accurate and is my own.")}</Typography>}
          sx={{ alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.5 } }}
        />
        <CaseConditions coche={accepte} onChange={setAccepte} />
      </>
    );
  }

  return (
    <Screen onBack={precedent} gap={2.5}>
      <Stack gap={1} sx={{ mt: -1 }}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption">{etape === "verifier" ? t("Dernière étape", "Last step") : t(`Étape ${index + 1} sur 4`, `Step ${index + 1} of 4`)}</Typography>
          <Typography variant="caption">{t("Ouverture de votre compte", "Opening your account")}</Typography>
        </Stack>
        <LinearProgress variant="determinate" value={((index + 1) / ETAPES.length) * 100} sx={{ height: 6, borderRadius: 3, bgcolor: "divider" }} aria-label={t("Avancement de l'inscription", "Sign-up progress")} />
      </Stack>
      <Box key={etape} component="form" onSubmit={(e) => { e.preventDefault(); if (etape === "verifier") { if (certifie && accepte) void ouvrir(); } else suivant(); }}
        sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2.5,
              "@media (prefers-reduced-motion: no-preference)": { animation: "glisil-glisse 260ms cubic-bezier(.2,.8,.2,1)" },
              "@keyframes glisil-glisse": { from: { opacity: 0, transform: "translateX(24px)" }, to: { opacity: 1, transform: "none" } } }}>
        {contenu}
        <Box sx={{ flex: 1 }} />
        <Button type="submit" variant="contained" disabled={!pret[etape] || enCours}>
          {etape === "verifier" ? (enCours ? t("Ouverture du compte…", "Opening account…") : t("Ouvrir mon compte", "Open my account")) : t("Continuer", "Continue")}
        </Button>
      </Box>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}
