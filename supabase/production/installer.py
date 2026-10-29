#!/usr/bin/env python3
"""
L'INSTALLATION DE LA PRODUCTION, EN UNE SEULE INSTRUCTION SQL.

    python3 supabase/production/installer.py   (écrit le fichier, dit son chemin)

Le même contenu que « annoncer + consolidé + constat » (docs/PRODUCTION.md,
étape F), mais en UN bloc : l'annonce, chaque migration de
supabase/migrations dans l'ordre, puis le constat d'une base neuve. Une
instruction est toujours tout ou rien, quel que soit l'outil qui l'envoie
(l'éditeur, une connexion de chantier) : une tâche pg_cron ne peut pas voir le
schéma avant la fin, ni doter un robot. Une erreur, et rien n'est écrit.

Refuse une base qui a déjà un schéma (comme annoncer-la-production.sql).
"""
import pathlib
import re

ICI = pathlib.Path(__file__).resolve().parent
RACINE = ICI.parent.parent


def main() -> None:
    fichiers = sorted((RACINE / "supabase" / "migrations").glob("*.sql"))
    morceaux = [
        "-- Fabriqué par supabase/production/installer.py — ne pas modifier à la main.",
        "do $installation$",
        "begin",
        "  if to_regclass('public.parametres') is not null then",
        "    raise exception 'cette base a déjà un schéma : on n''installe la production que sur un projet neuf';",
        "  end if;",
        "  perform set_config('glisil.profil', 'production', true);",
        "  perform set_config('check_function_bodies', 'off', true);",
        "  perform set_config('statement_timeout', '0', true);",
        # le cours de référence a besoin de l'extension http (0022) : posée ici, dans la même instruction
        "  if exists (select 1 from pg_available_extensions where name = 'http') then",
        "    create extension if not exists http with schema extensions;",
        "  end if;",
    ]
    for f in fichiers:
        texte = f.read_text(encoding="utf-8")
        etiquette = "$m" + re.sub(r"[^a-z0-9]", "_", f.stem.lower()) + "$"
        if etiquette in texte or "$installation$" in texte:
            raise SystemExit(f"✗ {f.name} contient l'étiquette {etiquette}")
        morceaux += [f"  -- {f.name}", f"  execute {etiquette}", texte.rstrip("\n"), f"{etiquette};"]
    morceaux += [
        "  -- le constat d'une base NEUVE : il lève, et tout s'annule, si quoi que ce soit ne tient pas",
        "  perform verifier_le_profil_production(true);",
        "end $installation$;",
        "",
    ]
    sortie = ICI / "installation.sql"
    sortie.write_text("\n".join(morceaux), encoding="utf-8")
    print(sortie.relative_to(RACINE))


if __name__ == "__main__":
    main()
