#!/usr/bin/env python3
"""
Fabrique migrations/<date>_consolidated.sql : toutes les migrations de
supabase/migrations, dans l'ordre, en UN fichier qu'on peut coller dans
l'éditeur SQL de Supabase sur une base neuve — ou rejouer sans danger sur une
base où elles sont déjà : chaque partie regarde d'abord si ce qu'elle crée
existe, et ne fait rien si c'est le cas.

    python3 supabase/consolider.py            (écrit le fichier, dit son chemin)

Les fichiers de supabase/migrations restent la source : celui-ci se refait,
il ne se modifie pas à la main.
"""
import datetime
import hashlib
import pathlib

ICI = pathlib.Path(__file__).resolve().parent
RACINE = ICI.parent

# Pour chaque migration : ce qui prouve qu'elle est déjà en place (une
# expression SQL vraie si oui), et pourquoi ce témoin-là.
TEMOINS = {
    "0001_socle.sql": ("to_regclass('public.soldes') is not null", "la table des soldes"),
    "0002_compte_et_lectures.sql": ("to_regclass('public.retraits_crypto') is not null", "la table des retraits crypto"),
    "0003_administration.sql": ("to_regclass('public.administrateurs') is not null", "la table des administrateurs"),
    # 0004 retire puis rouvre les droits : la rejouer sur une base où d'autres
    # fonctions sont nées depuis les fermerait aux rôles qui en ont besoin.
    "0004_droits.sql": ("has_function_privilege('authenticated', 'public.mon_compte()', 'execute')", "les droits des clients déjà ouverts"),
    # 0005 se réécrit elle-même (elle retire la tâche avant de la reposer) : rejouable telle quelle.
    "0005_exploitation.sql": ("false", "rejouable telle quelle"),
    "0006_veilleur_en_ligne.sql": ("to_regclass('public.chaine_tours') is not null", "la table des tours du veilleur"),
    "0007_configuration_du_veilleur.sql": ("to_regprocedure('public.chaine_configuration()') is not null", "la fonction chaine_configuration"),
    # 0008 renomme et remplace une fonction : rejouable telle quelle.
    "0008_glisil.sql": ("false", "rejouable telle quelle"),
    # 0009 et 0010 n'ajoutent que des colonnes « if not exists » et des fonctions « or replace ».
    "0009_inscription_par_email.sql": ("false", "rejouable telle quelle"),
    "0010_vue_clients.sql": ("false", "rejouable telle quelle"),
    "0011_equipe.sql": ("false", "rejouable telle quelle"),
    "0012_garde_fous.sql": ("false", "rejouable telle quelle"),
    # 0013 : colonnes « if not exists », anciennes signatures retirées « if exists », fonctions « or replace ».
    "0013_depot_declare.sql": ("false", "rejouable telle quelle"),
    # 0014 : colonnes et index « if not exists », fonctions « or replace », seau et politiques re-posés.
    "0014_sorties_manuelles.sql": ("false", "rejouable telle quelle"),
    # 0015 : table « if not exists », déclencheur re-posé, le rattrapage ne prend que ce qui manque.
    "0015_reserve_sur_la_chaine.sql": ("false", "rejouable telle quelle"),
    # 0016 : tables « if not exists », fonctions « or replace », tâche planifiée retirée puis re-posée.
    "0016_parite.sql": ("false", "rejouable telle quelle"),
    # 0017 : fonctions « or replace » seulement.
    "0017_regles_du_marche.sql": ("false", "rejouable telle quelle"),
    # 0018 : table « if not exists », lignes « on conflict do nothing », clés étrangères posées si absentes,
    # déclencheur retiré puis re-posé, tâches du veilleur recalculées.
    "0018_reseaux.sql": ("false", "rejouable telle quelle"),
    # 0019 : une fonction « or replace ».
    "0019_recevoir_des_xafe.sql": ("false", "rejouable telle quelle"),
    # 0020 : paramètre « on conflict do nothing », fonctions « or replace », rattrapage idempotent.
    "0020_numeros_sans_code.sql": ("false", "rejouable telle quelle"),
    # 0021 : paramètre et colonnes « if not exists », table « if not exists », déclencheurs retirés puis reposés, fonctions « or replace ».
    "0021_beta.sql": ("false", "rejouable telle quelle"),
    # 0022 : paramètre « on conflict do nothing », table « if not exists », tâches pg_cron retirées puis reposées, fonctions « or replace ».
    "0022_cours_reel.sql": ("false", "rejouable telle quelle"),
    # 0023 : comptes et robots « on conflict do nothing », dotation une seule fois (au premier tour), tâches retirées puis reposées.
    "0023_robots.sql": ("false", "rejouable telle quelle"),
    # 0024 : table « if not exists », fonctions « or replace ».
    "0024_observer_la_beta.sql": ("false", "rejouable telle quelle"),
    # 0025 : table « if not exists », déclencheur retiré puis reposé, fonctions « or replace », historique rempli s'il manque.
    "0025_graphique.sql": ("false", "rejouable telle quelle"),
    # 0026 : réglages réécrits seulement s'ils sont encore ceux d'origine, compléments une seule fois.
    "0026_marche_profond.sql": ("false", "rejouable telle quelle"),
    # 0027 : fonctions « or replace », réglages réécrits seulement s'ils sont encore ceux d'origine.
    "0027_sans_plafond.sql": ("false", "rejouable telle quelle"),
    # 0028 redéfinit des fonctions de 0001, 0014, 0015 et 0021 (la garde des dépôts) : rejouée APRÈS
    # elles, ou une seconde passe remettrait l'ancienne garde et fermerait les floats de démo.
    "0028_totem_demo.sql": ("false", "rejouable telle quelle"),
    # 0029 redéfinit parametres_publics, posée par 0021 (rejouable) : rejouée après elle.
    "0029_demo_dans_l_ecran.sql": ("false", "rejouable telle quelle"),
    # 0030 redéfinit ouvrir_depot, la garde des dépôts et demander_sortie (0028) et admin_terminaux (0013) :
    # rejouée après elles.
    "0030_demo_et_argent_reel.sql": ("false", "rejouable telle quelle"),
    # 0031 : colonne rendue facultative, plafonds retirés seulement s'ils sont encore ceux de 0001,
    # demander_sortie « or replace » (posée par 0001).
    "0031_sans_plafond_par_transfert.sql": ("false", "rejouable telle quelle"),
    # 0032 : fonctions « or replace », paramètre inséré s'il manque, déclencheur retiré puis reposé.
    "0032_retraits_de_demo_automatiques.sql": ("false", "rejouable telle quelle"),
    # 0033 : parametres_publics « or replace » (après 0029), la version anglaise posée seulement si elle manque.
    "0033_bandeau_beta_en_anglais.sql": ("false", "rejouable telle quelle"),
    # 0034 : fonctions « or replace », _apparier retirée (« if exists ») puis reposée avec le monde du SMS.
    "0034_revue_d_attaque.sql": ("false", "rejouable telle quelle"),
    # 0035 à 0040 : colonnes et tables « if not exists », fonctions retirées « if exists » puis reposées,
    # paramètres « on conflict do nothing », déclencheurs et tâches retirés puis reposés.
    "0035_connexion_mot_de_passe_2fa.sql": ("false", "rejouable telle quelle"),
    "0036_verification_avant_sortie.sql": ("false", "rejouable telle quelle"),
    "0037_langue_des_courriels.sql": ("false", "rejouable telle quelle"),
    "0038_sortie_manuelle_prouvee.sql": ("false", "rejouable telle quelle"),
    "0039_continuite_des_soldes.sql": ("false", "rejouable telle quelle"),
    "0040_reserve_dans_le_contrat.sql": ("false", "rejouable telle quelle"),
    # 0041 : inerte hors production ; sur la production, re-tient le profil après 0021/0023/0032 rejouées.
    "0041_profil_production.sql": ("false", "rejouable telle quelle"),
    # 0042 : declarer_transaction « or replace ».
    "0042_cent_declarations_par_jour.sql": ("false", "rejouable telle quelle"),
    # 0043 : ne fait rien si pg_net est déjà hors de « public ».
    "0043_pg_net_hors_de_public.sql": ("false", "rejouable telle quelle"),
    # 0044 : politiques retirées « if exists » puis reposées.
    "0044_politiques_une_lecture.sql": ("false", "rejouable telle quelle"),
    # 0045 : anciennes signatures retirées « if exists », tout le reste « or replace » ou « if not exists ».
    "0045_usdc_et_deux_carnets.sql": ("false", "rejouable telle quelle"),
    # 0046 : _nom_propre « or replace ».
    "0046_nom_propre_apostrophe.sql": ("false", "rejouable telle quelle"),
}


def main() -> None:
    fichiers = sorted((ICI / "migrations").glob("*.sql"))
    inconnus = [f.name for f in fichiers if f.name not in TEMOINS]
    if inconnus:
        raise SystemExit(f"✗ migration sans témoin : {', '.join(inconnus)} — ajoutez-la à TEMOINS")
    date = datetime.date.today().strftime("%Y%m%d")
    sortie = RACINE / "migrations" / f"{date}_consolidated.sql"
    morceaux = [
        "-- ╔════════════════════════════════════════════════════════════════════════╗",
        "-- ║  Glisil · toutes les migrations, en un seul fichier             ║",
        "-- ║  Fabriqué par supabase/consolider.py à partir de supabase/migrations : ║",
        "-- ║  ne pas modifier à la main, le refaire.                                 ║",
        "-- ║                                                                        ║",
        "-- ║  Bêta : Supabase → SQL Editor → coller → Run. Sur une base neuve, tout ║",
        "-- ║  est créé dans l'ordre ; sur une base où une partie est déjà en place, ║",
        "-- ║  cette partie le dit (NOTICE) et ne fait rien.                         ║",
        "-- ║  Production : JAMAIS par l'éditeur — psql --single-transaction, avec   ║",
        "-- ║  l'annonce à l'installation seulement (docs/PRODUCTION.md).            ║",
        "-- ╚════════════════════════════════════════════════════════════════════════╝",
        "",
        "-- Rejoué sur une base déjà en place, une migration ancienne repose des fonctions SQL dont",
        "-- le corps nomme une table qu'une migration plus récente a retirée (0009 et codes_secrets,",
        "-- retirée par 0036) : la plus récente les redéfinit juste après, dans le même passage.",
        "-- Comme pg_dump, on ne valide donc pas les corps à la création — l'état final est celui",
        "-- d'une base neuve (supabase/production/eprouver-le-profil.sh rejoue les deux).",
        "set check_function_bodies = off;",
        "",
    ]
    for f in fichiers:
        texte = f.read_text(encoding="utf-8")
        for etiquette in ("$consolide$", "$sql$"):
            if etiquette in texte:
                raise SystemExit(f"✗ {f.name} contient {etiquette} : choisissez une autre étiquette")
        temoin, raison = TEMOINS[f.name]
        empreinte = hashlib.md5(texte.encode("utf-8")).hexdigest()
        morceaux += [
            f"-- ─── {f.name} (md5 {empreinte}) ───",
            f"-- déjà en place si : {raison}",
            "do $consolide$",
            "begin",
            f"  if {temoin} then",
            f"    raise notice '{f.name} : déjà en place, rien à faire';",
            "  else",
            "    execute $sql$",
            texte.rstrip("\n"),
            "$sql$;",
            f"    raise notice '{f.name} : appliquée';",
            "  end if;",
            "end $consolide$;",
            "",
        ]
    sortie.parent.mkdir(exist_ok=True)
    sortie.write_text("\n".join(morceaux), encoding="utf-8")
    print(sortie.relative_to(RACINE))


if __name__ == "__main__":
    main()
