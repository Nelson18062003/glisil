/*
 * Les textes qui engagent : les conditions d'utilisation et la politique de
 * confidentialité. Ils se lisent SANS compte (/conditions, /confidentialite :
 * le Play Store et l'App Store demandent une adresse publique), dans une
 * feuille pendant l'inscription (on ne quitte pas son brouillon pour lire),
 * et ils se réacceptent quand leur version change.
 *
 * Deux écrans de garde vivent ici aussi : « vos conditions ont changé » et
 * « votre compte est fermé ».
 */
import CloseRounded from "@mui/icons-material/CloseRounded";
import DoNotDisturbOnOutlined from "@mui/icons-material/DoNotDisturbOnOutlined";
import GavelRounded from "@mui/icons-material/GavelRounded";
import MailOutlineRounded from "@mui/icons-material/MailOutlineRounded";
import WhatsApp from "@mui/icons-material/WhatsApp";
import { Avatar, Box, Button, Checkbox, Dialog, FormControlLabel, IconButton, Link as LienMui, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompte, useGuichet, useRafraichir } from "../../guichet";
import { CONDITIONS, CONFIDENTIALITE, EDITEUR, lienEmail, lienWhatsapp, VERSION_CONDITIONS, type Document } from "../../noyau/conditions";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { FeuilleErreur, Screen } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

const dateVersion = new Date(`${VERSION_CONDITIONS}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Le texte lui-même, article par article ; le même partout où il s'affiche. */
export function TexteLegal({ doc }: { doc: Document }) {
  const editeur = [EDITEUR.nom, EDITEUR.forme, EDITEUR.rccm && `RCCM ${EDITEUR.rccm}`, EDITEUR.niu && `NIU ${EDITEUR.niu}`, EDITEUR.adresse].filter(Boolean).join(" · ");
  return (
    <Stack gap={2.5} component="article">
      <Stack gap={0.75}>
        <Typography variant="body1">{doc.resume}</Typography>
        <Typography variant="caption">Version du {dateVersion} · {editeur}</Typography>
      </Stack>
      {doc.articles.map((a) => (
        <Stack key={a.titre} gap={1} component="section">
          <Typography variant="subtitle1" component="h2" fontWeight={600}>{a.titre}</Typography>
          {a.paragraphes.map((p) => <Typography key={p.slice(0, 40)} variant="body2" sx={{ lineHeight: 1.6 }}>{p}</Typography>)}
        </Stack>
      ))}
    </Stack>
  );
}

/** Les pages publiques. La flèche revient d'où l'on vient — ou à l'accueil, si on est arrivé par un lien. */
function PageLegale({ doc }: { doc: Document }) {
  const navigate = useNavigate();
  return (
    <Screen title={doc.titre} onBack={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
      <TexteLegal doc={doc} />
      <Contact sujet={`Question sur : ${doc.titre}`} />
    </Screen>
  );
}
export const Conditions = () => <PageLegale doc={CONDITIONS} />;
export const Confidentialite = () => <PageLegale doc={CONFIDENTIALITE} />;

/** Le texte en plein écran par-dessus l'écran courant : lire sans perdre ce qu'on était en train de faire. */
export function FeuilleLegale({ doc, onFermer }: { doc: Document | null; onFermer: () => void }) {
  return (
    <Dialog fullScreen open={Boolean(doc)} onClose={onFermer} PaperProps={{ sx: { bgcolor: "background.default" } }}>
      {doc && (
        <Box sx={{ width: "100%", maxWidth: 720, mx: "auto", px: 2, pb: "calc(24px + env(safe-area-inset-bottom))" }}>
          <Stack direction="row" alignItems="center" sx={{ minHeight: 64, position: "sticky", top: 0, bgcolor: "background.default", zIndex: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }} component="h1">{doc.titre}</Typography>
            <IconButton onClick={onFermer} aria-label="Fermer" size="large"><CloseRounded /></IconButton>
          </Stack>
          <TexteLegal doc={doc} />
          <Button variant="contained" fullWidth onClick={onFermer} sx={{ mt: 3 }}>J'ai lu</Button>
        </Box>
      )}
    </Dialog>
  );
}

/** « J'accepte les conditions et la politique » : la case, avec les deux textes à portée de doigt. */
export function CaseConditions({ coche, onChange }: { coche: boolean; onChange: (v: boolean) => void }) {
  const [lu, setLu] = useState<Document | null>(null);
  const lien = (doc: Document, texte: string) => (
    <LienMui component="button" type="button" variant="body2" onClick={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setLu(doc); }}
      sx={{ fontWeight: 600, verticalAlign: "baseline", textAlign: "left" }}>{texte}</LienMui>
  );
  return (
    <>
      <FormControlLabel
        control={<Checkbox checked={coche} onChange={(e) => onChange(e.target.checked)} />}
        label={<Typography variant="body2" sx={{ color: "text.primary" }}>J'accepte les {lien(CONDITIONS, "conditions d'utilisation")} et la {lien(CONFIDENTIALITE, "politique de confidentialité")}.</Typography>}
        sx={{ alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.5 } }}
      />
      <FeuilleLegale doc={lu} onFermer={() => setLu(null)} />
    </>
  );
}

/** Écrire au support : WhatsApp s'il est réglé, sinon (et en plus) l'e-mail. */
export function Contact({ sujet, texte = "" }: { sujet: string; texte?: string }) {
  const wa = lienWhatsapp(`${sujet}${texte ? ` · ${texte}` : ""}`);
  const mail = lienEmail(sujet, texte);
  if (!wa && !mail) return null;
  return (
    <Stack gap={1} sx={{ mt: 1 }}>
      {wa && <Button variant="outlined" startIcon={<WhatsApp />} href={wa} target="_blank" rel="noopener">Écrire au support sur WhatsApp</Button>}
      {mail && <Button variant={wa ? "text" : "outlined"} startIcon={<MailOutlineRounded />} href={mail}>Écrire au support par e-mail</Button>}
    </Stack>
  );
}

/* ------------------------------------------------------ écrans de garde */

/** Les conditions ont changé depuis l'inscription : on les relit, on accepte, on continue là où l'on allait. */
export function ConditionsAReaccepter() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const session = useSession();
  const [coche, setCoche] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  return (
    <Screen gap={2.5}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.blue.bg, color: tones.blue.fg, mt: 2 }}><GavelRounded sx={{ fontSize: 32 }} /></Avatar>
      <Stack gap={0.75}>
        <Typography variant="h5" component="h1">Nos conditions ont changé</Typography>
        <Typography variant="body1">Avant de continuer, relisez-les et dites-nous que vous les acceptez. Rien ne change sur votre argent.</Typography>
      </Stack>
      <CaseConditions coche={coche} onChange={setCoche} />
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!coche || enCours} onClick={() => void lancer(async () => { await guichet.accepterConditions(VERSION_CONDITIONS); await rafraichir(); })}>
        {enCours ? "Un instant…" : "Accepter et continuer"}
      </Button>
      <Button variant="text" color="inherit" sx={{ color: "text.secondary" }} onClick={() => void session.deconnecter()}>Se déconnecter</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/** Le compte est fermé (par son titulaire) ou suspendu (par l'équipe) : on le dit, et qui peut le rouvrir. */
export function CompteFerme() {
  const session = useSession();
  const { data: compte } = useCompte();
  const ferme = Boolean(compte?.fermeLe);
  const le = compte?.fermeLe ? new Date(compte.fermeLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;
  return (
    <Screen gap={2.5}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.neutral.bg, color: tones.neutral.fg, mt: 2 }}><DoNotDisturbOnOutlined sx={{ fontSize: 32 }} /></Avatar>
      <Stack gap={0.75}>
        <Typography variant="h5" component="h1">{ferme ? "Votre compte est fermé" : "Votre compte est suspendu"}</Typography>
        <Typography variant="body1">
          {ferme ? `Vous l'avez fermé${le ? ` le ${le}` : ""}. Aucune opération n'est possible.` : "L'équipe Glisil a suspendu votre compte. Aucune opération n'est possible pour l'instant."}
        </Typography>
        <Typography variant="body2">{ferme ? "Pour le rouvrir, écrivez au support depuis l'adresse de ce compte." : "Écrivez au support : il vous dira pourquoi, et ce qu'il faut pour le réactiver."}</Typography>
      </Stack>
      <Contact sujet={ferme ? "Rouvrir mon compte Glisil" : "Mon compte Glisil est suspendu"} texte={compte?.email ?? ""} />
      <Box sx={{ flex: 1 }} />
      <Button variant="text" color="inherit" sx={{ color: "text.secondary" }} onClick={() => void session.deconnecter()}>Se déconnecter</Button>
    </Screen>
  );
}
