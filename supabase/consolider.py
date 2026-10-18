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
        "-- ║  Supabase → SQL Editor → coller → Run. Sur une base neuve, tout est    ║",
        "-- ║  créé dans l'ordre ; sur une base où une partie est déjà en place,     ║",
        "-- ║  cette partie le dit (NOTICE) et ne fait rien.                         ║",
        "-- ╚════════════════════════════════════════════════════════════════════════╝",
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
