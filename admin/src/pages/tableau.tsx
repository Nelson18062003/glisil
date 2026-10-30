/*
 * Le Tableau : la première question du matin — ce que la plateforme doit
 * (les XAFe des clients), ce qui circule, ce qui attend quelqu'un.
 */
import { Chip, Paper, Stack, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { useApprobation, useATraiter, useTableau } from "../guichet";
import { enTranches, heure, jourRelatif, numeroEnTranches, prix, xaf } from "../noyau/format";
import { Coquille, Etat, Section, Tableau as Table, Tuile } from "../ui";

export function Tableau() {
  const { data: t } = useTableau();
  const { data: a } = useATraiter();
  const { data: ap } = useApprobation();
  if (!t) return <Coquille titre="Tableau"><Typography variant="body2">Chargement…</Typography></Coquille>;
  const xafe = t.soldes.XAFe ?? { disponible: 0, bloque: 0 };
  const usdt = t.soldes.USDT ?? { disponible: 0, bloque: 0 };
  const usdc = t.soldes.USDC ?? { disponible: 0, bloque: 0 };
  return (
    <Coquille titre="Tableau">
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="XAFe en circulation (ce qu'on doit)" valeur={xaf(t.circulation)} unite="XAFe" tone="green" aide={`${xaf(xafe.disponible)} disponibles · ${xaf(xafe.bloque)} bloqués`} />
        <Tuile label="USDT des clients" valeur={enTranches(usdt.disponible + usdt.bloque, 2)} unite="USDT" tone="blue" aide={`${enTranches(usdt.bloque, 2)} bloqués au carnet`} />
        <Tuile label="USDC des clients" valeur={enTranches(usdc.disponible + usdc.bloque, 2)} unite="USDC" tone="blue" aide={`${enTranches(usdc.bloque, 2)} bloqués au carnet`} />
        <Tuile label="Maison · frais encaissés" valeur={xaf(t.maison.XAFe ?? 0)} unite="XAFe" tone="amber" aide={`${enTranches(t.maison.USDT ?? 0, 2)} USDT · ${enTranches(t.maison.USDC ?? 0, 2)} USDC`} />
        <Tuile label="USDT/XAFe" valeur={t.cotation.dernier != null ? prix(t.cotation.dernier) : "—"} tone="neutral" aide={`${xaf(t.cotation.volume_usdt)} USDT sur 24 h`} />
      </Stack>
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="Entré aujourd'hui" valeur={xaf(t.jour.entrees)} unite="XAF" />
        <Tuile label="Sorti aujourd'hui" valeur={xaf(t.jour.sorties)} unite="XAF" />
        <Tuile label="Volume du jour" valeur={xaf(Math.round(t.jour.volumes?.["USDT/XAFe"] ?? t.jour.volume_usdt))} unite="USDT"
          aide={t.jour.volumes?.["USDC/XAFe"] != null ? `et ${xaf(Math.round(t.jour.volumes["USDC/XAFe"]))} USDC` : undefined} />
        <Tuile label="Frais du jour" valeur={xaf(t.jour.frais_xafe)} unite="XAFe" />
      </Stack>

      {a?.parite && (
        <Paper component={Link} to="/parite" data-parite={a.parite.statut} sx={{ p: 2.5, borderRadius: 5, textDecoration: "none", color: "inherit",
          bgcolor: a.parite.statut === "ecart" ? "#F9DEDC" : a.parite.statut === "incomplet" ? "#FFE3B5" : "#D7F2E0" }}>
          <Typography variant="body2">Parité · floats, registre, chaîne</Typography>
          <Typography variant="h5">
            {a.parite.statut === "ecart" ? `Écart${a.parite.ecart ? ` de ${xaf(a.parite.ecart)} XAFe` : ""} · ${a.parite.alertes} alarme${a.parite.alertes > 1 ? "s" : ""}`
              : a.parite.statut === "incomplet" ? "Pas encore conclue : une colonne manque"
              : `Elle tient, au franc près${a.parite.couverture != null ? ` · floats +${xaf(a.parite.couverture)} XAF` : ""}`}
          </Typography>
        </Paper>
      )}

      <Section titre="Ce qui attend quelqu'un">
        <Stack direction="row" gap={2} flexWrap="wrap">
          {/* en premier : un client attend son argent */}
          <Paper component={Link} to="/sorties" data-a-payer={a?.sorties_manuelles ?? 0} sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit", bgcolor: (a?.sorties_en_ecart ?? 0) > 0 ? "#F9DEDC" : (a?.sorties_manuelles ?? 0) + (a?.sorties_a_confirmer ?? 0) > 0 ? "#FFE3B5" : "background.paper" }}>
            <Typography variant="body2">Remboursements à payer{a && (a.sorties_en_preuve ?? 0) > 0 ? ` · ${a.sorties_en_preuve} en preuve` : ""}{a && (a.sorties_en_ecart ?? 0) > 0 ? ` · ${a.sorties_en_ecart} en écart` : ""}{a && a.sorties_a_confirmer > 0 ? ` · ${a.sorties_a_confirmer} à confirmer` : ""}</Typography>
            <Typography variant="h5">{a?.sorties_manuelles ?? "—"} · {xaf(a?.montant_a_payer ?? 0)} XAF</Typography>
          </Paper>
          {/* 0047 : un nouveau compte attend qu'on l'approuve avant son premier geste d'argent */}
          {ap && ap.manuelle && ap.en_attente > 0 && (
            <Paper component={Link} to="/clients?filtre=a_approuver" data-a-approuver={ap.en_attente} sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit", bgcolor: "#FFE3B5" }}>
              <Typography variant="body2">Comptes à approuver</Typography>
              <Typography variant="h5">{ap.en_attente}</Typography>
            </Paper>
          )}
          {a && (a.retenues_solde ?? 0) > 0 && (
            <Paper component={Link} to="/entrees?onglet=retenues" data-solde-a-verifier={a.retenues_solde} sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit", bgcolor: "#F9DEDC" }}>
              <Typography variant="body2">SMS au solde à vérifier</Typography>
              <Typography variant="h5">{a.retenues_solde}</Typography>
            </Paper>
          )}
          {a && a.sorties_non_expliquees > 0 && (
            <Paper component={Link} to="/sorties" sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit", bgcolor: "#F9DEDC" }}>
              <Typography variant="body2">Sorti du float sans sortie en face</Typography>
              <Typography variant="h5">{a.sorties_non_expliquees}</Typography>
            </Paper>
          )}
          <Paper component={Link} to="/entrees?onglet=retenues" sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit", bgcolor: t.retenues.nombre > 0 ? "#FFE3B5" : "background.paper" }}>
            <Typography variant="body2">SMS retenus, à rapprocher ou rembourser</Typography>
            <Typography variant="h5">{t.retenues.nombre} · {xaf(t.retenues.montant)} XAF</Typography>
          </Paper>
          <Paper component={Link} to="/sorties" sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit" }}>
            <Typography variant="body2">Sorties en cours chez TOTEM</Typography>
            <Typography variant="h5">{t.sorties_en_cours}</Typography>
          </Paper>
          <Paper component={Link} to="/entrees" sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit" }}>
            <Typography variant="body2">Transaction ID qui attendent leur SMS</Typography>
            <Typography variant="h5">{t.declarations_attendues}</Typography>
          </Paper>
          <Paper component={Link} to="/clients?filtre=verifications" sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220, textDecoration: "none", color: "inherit", bgcolor: t.verifications > 0 ? "#DBEAFF" : "background.paper" }}>
            <Typography variant="body2">Vérifications de pièces à faire</Typography>
            <Typography variant="h5">{t.verifications}</Typography>
          </Paper>
        </Stack>
      </Section>

      <Section titre="Les boîtiers et leurs floats">
        <Table
          colonnes={["Terminal", "Lieu", "Vu", "État", "Floats"]}
          lignes={t.terminaux.map((x) => [
            <Typography fontWeight={600} key="n">{x.nom} <Typography component="span" variant="caption">({x.id})</Typography></Typography>,
            x.lieu ?? "—",
            x.vu_le ? `${jourRelatif(x.vu_le)} ${heure(x.vu_le)}` : "jamais",
            <Etat valeur={x.muet ? "muet" : "actif"} key="e" />,
            <Stack direction="row" gap={0.5} flexWrap="wrap" key="f">
              {t.floats.filter((f) => f.terminal === x.id).map((f) => <Chip key={f.id} size="small" label={`${f.operateur.toUpperCase()} ${numeroEnTranches(f.numero)}${f.dossiers_ouverts ? ` · ${f.dossiers_ouverts} ouverts` : ""}`} sx={{ height: 24, opacity: f.actif ? 1 : 0.45 }} />)}
            </Stack>,
          ])}
        />
      </Section>
    </Coquille>
  );
}
