-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0024 · observer la bêta                                      ║
-- ║                                                                        ║
-- ║  Une bêta sert à apprendre. Deux choses manquaient pour cela :          ║
-- ║    · LE TESTEUR PARLE : « Signaler un problème », depuis l'écran où il  ║
-- ║      est. Le texte, l'écran, l'appareil ; rien d'autre (pas de capture  ║
-- ║      automatique, pas de journal de l'appareil). Vingt par jour au      ║
-- ║      plus, par compte ;                                                 ║
-- ║    · L'ÉQUIPE VOIT : une page « Bêta » qui dit en un coup d'œil qui     ║
-- ║      teste, qui échange, combien d'argent de test est parti, ce que     ║
-- ║      font les robots (0023), où en est le vrai dollar (0022), et ce     ║
-- ║      que les testeurs ont signalé.                                      ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create table if not exists signalements (
  id         bigint generated always as identity primary key,
  compte_id  uuid not null references comptes(id),
  texte      text not null check (length(texte) between 3 and 2000),
  ecran      text check (ecran is null or (length(ecran) <= 200 and ecran like '/%')),
  appareil   text check (appareil is null or length(appareil) <= 300),
  etat       text not null default 'nouveau' check (etat in ('nouveau', 'vu', 'regle')),
  note       text check (note is null or length(note) <= 1000),
  traite_par uuid,
  traite_le  timestamptz,
  cree_le    timestamptz not null default now()
);
alter table signalements enable row level security;
create index if not exists signalements_recents on signalements (cree_le desc);
create index if not exists signalements_du_compte on signalements (compte_id, cree_le desc);

create or replace function _reference_signalement(p_id bigint) returns text
language sql immutable set search_path = public as $$ select 'SIG-' || lpad(p_id::text, 6, '0') $$;

-- Le testeur signale. L'écran et l'appareil sont des indices, pas des preuves :
-- un écran qui ne ressemble pas à un chemin de l'application est oublié.
create or replace function signaler_un_probleme(p_texte text, p_ecran text default null, p_appareil text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_compte uuid := auth.uid(); v_texte text := btrim(coalesce(p_texte, '')); v_s signalements;
begin
  perform _exiger_compte_actif(v_compte);
  if length(v_texte) < 3 or length(v_texte) > 2000 then
    raise exception 'texte invalide' using detail = 'entre 3 et 2 000 caractères';
  end if;
  if (select count(*) from signalements where compte_id = v_compte and cree_le > now() - interval '24 hours') >= 20 then
    raise exception 'trop de signalements' using detail = 'vingt par jour au plus : écrivez-nous au support pour la suite';
  end if;
  insert into signalements (compte_id, texte, ecran, appareil)
  values (v_compte, v_texte,
          case when p_ecran ~ '^/[A-Za-z0-9/_\-?=&.%]{0,199}$' then p_ecran end,
          nullif(left(btrim(coalesce(p_appareil, '')), 300), ''))
  returning * into v_s;
  return jsonb_build_object('ok', true, 'reference', _reference_signalement(v_s.id));
end $$;

-- Ce que l'équipe en fait : vu, réglé, avec une note
create or replace function admin_signalements(p_etat text default null, p_limite int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('clients');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'reference', _reference_signalement(s.id), 'compte_id', s.compte_id, 'nom', coalesce(c.nom, c.email),
      'texte', s.texte, 'ecran', s.ecran, 'appareil', s.appareil, 'etat', s.etat, 'note', s.note,
      'traite_le', s.traite_le, 'cree_le', s.cree_le) order by s.cree_le desc, s.id desc), '[]'::jsonb)
    from (select * from signalements where p_etat is null or etat = p_etat
           order by cree_le desc, id desc limit least(greatest(coalesce(p_limite, 100), 1), 500)) s
    join comptes c on c.id = s.compte_id);
end $$;

create or replace function admin_traiter_signalement(p_id bigint, p_etat text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_s signalements;
begin
  perform _exiger_droit('clients');
  if p_etat not in ('nouveau', 'vu', 'regle') then raise exception 'état invalide'; end if;
  update signalements set etat = p_etat, note = coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''), note),
                          traite_par = auth.uid(), traite_le = now()
   where id = p_id returning * into v_s;
  if not found then raise exception 'signalement inconnu'; end if;
  perform _journaliser('traiter_signalement', _reference_signalement(v_s.id), jsonb_build_object('etat', v_s.etat, 'note', v_s.note));
  return jsonb_build_object('ok', true, 'etat', v_s.etat);
end $$;

-- ─────────────────────────────── la page Bêta ──────────────────────────────
create or replace function admin_beta() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('voir');
  return jsonb_build_object(
    'beta', parametre('beta'),
    'testeurs', (select jsonb_build_object(
        'total', count(*),
        'nouveaux_24h', count(*) filter (where c.cree_le > now() - interval '24 hours'),
        'nouveaux_7j', count(*) filter (where c.cree_le > now() - interval '7 days'),
        'ont_echange', count(*) filter (where exists (select 1 from ordres o where o.compte_id = c.id and o.executee > 0)),
        'actifs_24h', count(*) filter (where exists (select 1 from ordres o where o.compte_id = c.id and o.cree_le > now() - interval '24 hours')))
      from comptes c where not c.maison and c.genre = 'client' and c.ferme_le is null),
    'argent_de_test', (select jsonb_build_object(
        'xafe_testeurs', coalesce(sum(d.xafe) filter (where c.genre <> 'robot'), 0),
        'usdt_testeurs', coalesce(sum(d.usdt) filter (where c.genre <> 'robot'), 0),
        'xafe_robots', coalesce(sum(d.xafe) filter (where c.genre = 'robot'), 0),
        'usdt_robots', coalesce(sum(d.usdt) filter (where c.genre = 'robot'), 0),
        'dotations', count(*))
      from dotations_beta d join comptes c on c.id = d.compte_id),
    'robots', admin_robots(),
    'cours', admin_cours(24),
    'signalements', (select jsonb_build_object('nouveaux', count(*) filter (where etat = 'nouveau'), 'vus', count(*) filter (where etat = 'vu'),
                                               'regles', count(*) filter (where etat = 'regle')) from signalements),
    'derniers_signalements', case when admin_a_droit('clients') then admin_signalements(null, 20) else '[]'::jsonb end);
end $$;

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on table signalements from public, anon, authenticated;
grant all on table signalements to service_role;
revoke all on function _reference_signalement(bigint), signaler_un_probleme(text, text, text), admin_signalements(text, int),
  admin_traiter_signalement(bigint, text, text), admin_beta() from public, anon, authenticated;
grant execute on function signaler_un_probleme(text, text, text), admin_signalements(text, int),
  admin_traiter_signalement(bigint, text, text), admin_beta() to authenticated;
