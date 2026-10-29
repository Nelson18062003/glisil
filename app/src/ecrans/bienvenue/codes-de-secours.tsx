/*
 * Les dix codes de secours : la base les tire, l'écran les montre UNE fois.
 * Copier, télécharger (un .txt — la coque Android sait le garder), puis
 * cocher « j'ai noté ». Sans eux, un téléphone perdu ferme le compte jusqu'à
 * ce que l'équipe vérifie l'identité.
 */
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import KeyRounded from "@mui/icons-material/KeyRounded";
import { Avatar, Box, Button, Checkbox, CircularProgress, FormControlLabel, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useGuichet } from "../../guichet";
import { codeDeSecoursLisible, texteDesCodes } from "../../noyau/codesDeSecours";
import { t } from "../../noyau/langue";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { FeuilleErreur, Screen } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

/* en mémoire seulement : un changement de langue remonte l'écran, il ne doit pas tirer dix nouveaux codes */
let codesDuMoment: string[] | null = null;

/** Les dix codes, en deux colonnes, et de quoi les garder. */
export function ListeDesCodes({ codes, email }: { codes: string[]; email?: string | null }) {
  const [copie, setCopie] = useState(false);
  const entete = t(`Glisil · codes de secours${email ? ` de ${email}` : ""}\nChaque code ne sert qu'une fois. Gardez-les loin de votre téléphone.`,
    `Glisil · recovery codes${email ? ` for ${email}` : ""}\nEach code works only once. Keep them away from your phone.`);
  const texte = texteDesCodes(codes, entete);
  const copier = async () => { try { await navigator.clipboard.writeText(texte); setCopie(true); setTimeout(() => setCopie(false), 2500); } catch { /* les codes restent à l'écran */ } };
  const telecharger = () => {
    const url = URL.createObjectURL(new Blob([texte], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "glisil-codes-de-secours.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <Stack gap={1.5}>
      <Paper variant="outlined" data-codes-de-secours sx={{ p: 2, borderRadius: 4, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 2, rowGap: 1 }}>
        {codes.map((c, i) => (
          <Stack key={c} direction="row" gap={1} alignItems="baseline" sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ width: 18, textAlign: "right", flexShrink: 0 }}>{i + 1}</Typography>
            <Typography sx={{ fontFamily: "Roboto Mono, monospace", fontSize: { xs: 15, sm: 17 }, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{codeDeSecoursLisible(c)}</Typography>
          </Stack>
        ))}
      </Paper>
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Button variant="outlined" startIcon={<ContentCopyRounded />} onClick={() => void copier()} sx={{ flex: 1 }}>{copie ? t("Copiés", "Copied") : t("Copier", "Copy")}</Button>
        <Button variant="outlined" startIcon={<DownloadRounded />} onClick={telecharger} sx={{ flex: 1 }}>{t("Télécharger", "Download")}</Button>
      </Stack>
    </Stack>
  );
}

/** À la première connexion (et après un code de secours) : les codes, puis « j'ai noté ». */
export function CodesDeSecoursAEcrire() {
  const guichet = useGuichet();
  const session = useSession();
  const [codes, setCodes] = useState<string[] | null>(codesDuMoment);
  const [note, setNote] = useState(false);
  const demande = useRef(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const generer = () => lancer(async () => { const c = await guichet.genererCodesDeSecours(); codesDuMoment = c; setCodes(c); });
  useEffect(() => { if (demande.current || codesDuMoment) return; demande.current = true; void generer(); }, []);
  const confirmer = () => lancer(async () => { await guichet.confirmerCodesDeSecours(); codesDuMoment = null; setCodes(null); await session.avancer(); });
  return (
    <Screen onBack={() => void session.deconnecter()} gap={2.5}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.amber.bg, color: tones.amber.fg }}><KeyRounded sx={{ fontSize: 32 }} /></Avatar>
      <Stack gap={0.75}>
        <Typography variant="h5">{t("Vos codes de secours", "Your recovery codes")}</Typography>
        <Typography variant="body2">{t("Si vous perdez votre téléphone, l'un de ces codes vous rend l'accès. Notez-les sur papier ou gardez le fichier ailleurs que sur ce téléphone : ils ne s'afficheront plus.", "If you lose your phone, one of these codes gets you back in. Write them on paper or keep the file somewhere other than this phone: they won't be shown again.")}</Typography>
      </Stack>
      {codes ? <ListeDesCodes codes={codes} /> : <CircularProgress sx={{ alignSelf: "center" }} />}
      <FormControlLabel
        control={<Checkbox checked={note} onChange={(e) => setNote(e.target.checked)} disabled={!codes} />}
        label={<Typography variant="body2" sx={{ color: "text.primary" }}>{t("J'ai noté ou enregistré mes codes", "I've written down or saved my codes")}</Typography>}
      />
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!codes || !note || enCours} onClick={() => void confirmer()}>{enCours ? t("Enregistrement…", "Saving…") : t("Continuer", "Continue")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} onRecommencer={codes ? undefined : () => void generer()} />
    </Screen>
  );
}
