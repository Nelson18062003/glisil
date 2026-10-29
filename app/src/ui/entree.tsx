/*
 * Les champs de l'entrée, posés une fois : le mot de passe (qu'on peut
 * montrer), sa règle dite pendant qu'on tape, et le code à six chiffres —
 * celui de l'e-mail comme celui de l'application d'authentification. Les
 * mêmes pièces servent à l'entrée, à Compte → Sécurité et à la vérification
 * avant sortie.
 */
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedRounded from "@mui/icons-material/RadioButtonUncheckedRounded";
import VisibilityOffOutlined from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Box, IconButton, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { forwardRef, useState, type ReactNode } from "react";
import { manquesDuMotDePasse, MOT_DE_PASSE_MAX, MOT_DE_PASSE_MIN } from "../noyau/motDePasse";
import { t } from "../noyau/langue";
import { sixChiffres } from "../noyau/verification";

export function ChampMotDePasse({
  label, valeur, onChange, nouveau = false, erreur, aide, autoFocus, disabled,
}: {
  label?: string; valeur: string; onChange: (v: string) => void;
  /** un mot de passe qu'on CHOISIT (le gestionnaire de mots de passe en propose un) ; sinon celui qu'on a déjà */
  nouveau?: boolean; erreur?: boolean; aide?: string; autoFocus?: boolean; disabled?: boolean;
}) {
  const [vu, setVu] = useState(false);
  return (
    <TextField
      label={label ?? t("Mot de passe", "Password")}
      type={vu ? "text" : "password"}
      value={valeur}
      onChange={(e) => onChange(e.target.value.slice(0, 200))}
      autoComplete={nouveau ? "new-password" : "current-password"}
      autoCapitalize="none"
      spellCheck={false}
      fullWidth
      autoFocus={autoFocus}
      disabled={disabled}
      error={erreur}
      helperText={aide}
      slotProps={{
        htmlInput: { maxLength: 200 },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton onClick={() => setVu((v) => !v)} edge="end" aria-label={vu ? t("Cacher le mot de passe", "Hide password") : t("Montrer le mot de passe", "Show password")} aria-pressed={vu}>
                {vu ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** La règle d'Auth, cochée à mesure : dix caractères, des lettres, des chiffres. Elle se lit comme l'aide de
 *  son champ : posée dans un groupe de champs (20 px), elle remonte à 4 px de lui. */
export function RegleDuMotDePasse({ valeur }: { valeur: string }) {
  const manques = manquesDuMotDePasse(valeur);
  const lignes: { ok: boolean; texte: string }[] = [
    { ok: !manques.includes("longueur"), texte: t(`${MOT_DE_PASSE_MIN} caractères au moins`, `At least ${MOT_DE_PASSE_MIN} characters`) },
    { ok: !manques.includes("lettres"), texte: t("des lettres", "letters") },
    { ok: !manques.includes("chiffres"), texte: t("des chiffres", "digits") },
  ];
  return (
    <Stack direction="row" gap={1.5} flexWrap="wrap" role="status" aria-live="polite" sx={{ mt: "-16px" }}>
      {lignes.map((l) => (
        <Stack key={l.texte} direction="row" gap={0.5} alignItems="center">
          {l.ok ? <CheckCircleRounded sx={{ fontSize: 18, color: "primary.main" }} /> : <RadioButtonUncheckedRounded sx={{ fontSize: 18, color: "text.secondary" }} />}
          <Typography variant="body2" sx={{ color: l.ok ? "primary.main" : "text.secondary", fontWeight: l.ok ? 600 : 400 }}>{l.texte}</Typography>
        </Stack>
      ))}
      {manques.includes("trop_long") && <Typography variant="body2" color="error">{t(`${MOT_DE_PASSE_MAX} octets au plus`, `${MOT_DE_PASSE_MAX} bytes at most`)}</Typography>}
    </Stack>
  );
}

/** Six chiffres, en grand : un code reçu par e-mail ou affiché par l'application. Coller « 482 913 » marche aussi.
 *  L'étiquette se voit toujours, au-dessus (même en grand : un champ sans nom visible ne dit pas ce qu'il attend). */
export const ChampCode = forwardRef<HTMLInputElement, {
  valeur: string; onChange: (v: string) => void; label: string; erreur?: boolean; aide?: string; autoFocus?: boolean; disabled?: boolean; compact?: boolean;
}>(function ChampCode({ valeur, onChange, label, erreur, aide, autoFocus, disabled, compact }, ref) {
  return (
    <TextField
      inputRef={ref}
      value={valeur}
      onChange={(e) => onChange(sixChiffres(e.target.value))}
      placeholder={"•".repeat(6)}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      disabled={disabled}
      fullWidth
      error={erreur}
      label={label}
      helperText={aide}
      slotProps={{ htmlInput: { maxLength: 7, pattern: "[0-9]*", style: compact ? { fontSize: 22, letterSpacing: "0.3em", fontVariantNumeric: "tabular-nums" } : { textAlign: "center", fontSize: 32, letterSpacing: "0.45em", fontVariantNumeric: "tabular-nums", paddingLeft: "0.45em" } } }}
    />
  );
});

/** Un bloc numéroté (1, 2, 3) : une décision par bloc, lisible de haut en bas. */
export function Etape({ numero, titre, children }: { numero: number; titre: string; children?: ReactNode }) {
  return (
    <Stack direction="row" gap={1.5} alignItems="flex-start">
      <Box aria-hidden sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", bgcolor: "primary.main", color: "#FFFFFF", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14, mt: 0.25 }}>{numero}</Box>
      <Stack gap={1.25} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ lineHeight: 1.35 }}>{titre}</Typography>
        {children}
      </Stack>
    </Stack>
  );
}
