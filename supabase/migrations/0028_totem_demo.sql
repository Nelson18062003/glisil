-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0028 · la démo vivante de TOTEM, branchée sur la bêta        ║
-- ║                                                                        ║
-- ║  Les testeurs ont, dans TOTEM, de fausses cartes MTN et Orange avec    ║
-- ║  de faux francs (docs/DEMO-VIVANTE.md, dépôt totem). Glisil les        ║
-- ║  prend comme un vrai boîtier : un terminal « totem-demo », signé avec  ║
-- ║  sa propre clé, et des floats qui sont des cartes de démo.             ║
-- ║                                                                        ║
-- ║    · Les numéros de démo (600 0x xx xx pour MTN, 600 9x xx xx pour     ║
-- ║      Orange — une tranche que personne n'attribue) se reconnaissent    ║
-- ║      PENDANT LA BÊTA, et seulement elle ;                              ║
-- ║    · un terminal se marque « démo » : ses floats reçoivent des dépôts  ║
-- ║      même quand les dépôts réels sont fermés — c'est de l'argent de    ║
-- ║      test des deux côtés ; et il est toujours « entendu » : c'est la   ║
-- ║      plateforme TOTEM qui répond pour lui, pas un boîtier qui dort ;   ║
-- ║    · un retrait vers un numéro de démo s'ouvre aussi pendant la bêta,  ║
-- ║      les autres restent fermés.                                        ║
-- ║  Le terminal se crée dans l'administration (Terminaux → nouveau,       ║
-- ║  « totem-demo ») : sa clé n'est montrée qu'une fois, et va dans        ║
-- ║  XAFE_DEMO_CLE chez TOTEM. Rien ici ne crée de clé.                    ║
-- ╚════════════════════════════════════════════════════════════════════════╝

alter table terminaux add column if not exists demo boolean not null default false;

-- ───────────────── les numéros de démo, pendant la bêta seulement ──────────
create or replace function _en_beta() returns boolean
language sql stable set search_path = public as $$
  select coalesce((parametre('beta') ->> 'actif')::boolean, false)
$$;

create or replace function numero_de_demo(p text) returns boolean
language sql stable set search_path = public as $$
  select _en_beta() and left(normaliser_numero(p), 4) in ('6000', '6009')
$$;

-- STABLE et non plus IMMUTABLE : la réponse dépend de la bêta. Aucun index
-- ni contrainte ne s'en sert (vérifié) — seules des fonctions l'appellent.
create or replace function operateur_du_numero(p text) returns text
language sql stable set search_path = public as $$
  select case
    when numero_de_demo(p) then case left(normaliser_numero(p), 4) when '6000' then 'mtn' else 'om' end
    when left(normaliser_numero(p), 3)::int between 650 and 654 or left(normaliser_numero(p), 3)::int between 670 and 689 then 'mtn'
    when left(normaliser_numero(p), 3)::int between 655 and 659 or left(normaliser_numero(p), 3)::int between 690 and 699 then 'om'
  end
$$;

-- ───────────── un terminal de démo est entendu, ses floats ouverts ─────────
create or replace function _terminal_entendu(p_terminal text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select t.demo or (t.vu_le is not null and t.vu_le > now() - interval '10 minutes')
                     from terminaux t where t.id = p_terminal), false)
$$;

create or replace function _depot_json(d depots) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object(
    'reference', d.reference, 'etat', d.etat, 'operateur', d.operateur,
    'montant_recu', d.montant_recu,
    'float_numero', f.numero,
    'titulaire', f.titulaire,
    'code_agent', f.code_agent,
    'reception', case when not coalesce(f.actif, false) then 'fermee'
                      when not _terminal_entendu(f.terminal) then 'retardee'
                      else 'ouverte' end,
    'declarations', (select coalesce(jsonb_agg(_declaration_json(x) order by x.declare_le), '[]'::jsonb)
                       from depot_declarations x where x.depot_id = d.id),
    'chaine', _trace_chaine('depots', d.reference),
    'cree_le', d.cree_le, 'expire_le', d.expire_le, 'credite_le', d.credite_le)
    from (select 1) _ left join floats f on f.id = d.float_id left join terminaux t on t.id = f.terminal
$$;

-- Le float d'un dépôt : quand les dépôts réels sont fermés pour ce compte
-- (la bêta), SEULS les floats de démo sont proposés — un client n'est jamais
-- envoyé payer un vrai float avec de vrais francs qu'il ne reverrait pas.
create or replace function ouvrir_depot(p_operateur text, p_cle text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_compte uuid := auth.uid();
  v_d      depots;
  v_float  floats;
  v_reels  boolean;
begin
  perform _exiger_compte_actif(v_compte);
  if p_cle is not null then
    select * into v_d from depots where compte_id = v_compte and cle = p_cle;
    if found then return _depot_json(v_d) || '{"deja": true}'; end if;
  end if;
  perform 1 from operateurs where id = p_operateur;
  if not found then raise exception 'opérateur inconnu'; end if;
  v_reels := _depots_reels_ouverts(v_compte);

  select f.* into v_float
    from floats f join terminaux t on t.id = f.terminal
   where f.operateur = p_operateur and f.actif and (v_reels or t.demo)
   order by _terminal_entendu(t.id) desc,
            (select count(*) from depots d where d.float_id = f.id and d.etat = 'en_attente') asc,
            f.id
   limit 1;
  if not found then
    if not v_reels then
      raise exception 'dépôts fermés pendant la bêta'
        using detail = 'aucun float de démo TOTEM pour cet opérateur : l''argent de la bêta est de l''argent de test';
    end if;
    raise exception 'aucun float disponible pour cet opérateur';
  end if;

  insert into depots (reference, compte_id, operateur, float_id, cle, expire_le)
  values ('XAFe-DP-' || lpad(nextval('depots_numero')::text, 6, '0'), v_compte, p_operateur, v_float.id,
          p_cle, now() + make_interval(mins => (parametre('depot') ->> 'validite_minutes')::int))
  returning * into v_d;
  return _depot_json(v_d);
end $$;

-- La garde à la source (0021) laisse passer un dépôt sur un float de démo.
create or replace function _depot_pendant_la_beta() returns trigger
language plpgsql set search_path = public as $$
begin
  if not _depots_reels_ouverts(new.compte_id)
     and not exists (select 1 from floats f join terminaux t on t.id = f.terminal
                      where f.id = new.float_id and t.demo) then
    raise exception 'dépôts fermés pendant la bêta'
      using detail = 'l''argent de la bêta est de l''argent de test : aucun vrai paiement n''est accepté pour l''instant';
  end if;
  return new;
end $$;

-- ───────────── les retraits vers un numéro de démo, pendant la bêta ────────
create or replace function demander_sortie(p_montant numeric, p_numero_id uuid, p_cle text, p_code text, p_nom text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not coalesce((parametre('sortie') ->> 'ouvertes')::boolean, true)
     and not exists (select 1 from numeros n where n.id = p_numero_id and n.compte_id = auth.uid()
                                              and n.retire_le is null and numero_de_demo(n.numero)) then
    raise exception 'sorties pas encore ouvertes' using detail = 'vos XAFe restent sur votre compte';
  end if;
  v := _controler_code(auth.uid(), p_code);
  if not (v ->> 'ok')::boolean then return v; end if;
  if _sortie_manuelle() then return _demander_sortie_manuelle(p_montant, p_numero_id, p_cle, p_nom); end if;
  return demander_sortie(p_montant, p_numero_id, p_cle);
end $$;

-- ───────────── l'équipe marque un terminal « démo » ─────────────────────────
create or replace function admin_terminal_demo(p_id text, p_demo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('terminaux');
  update terminaux set demo = p_demo where id = p_id;
  if not found then raise exception 'terminal inconnu'; end if;
  perform _journaliser('terminal_demo', p_id, jsonb_build_object('demo', p_demo));
  return jsonb_build_object('id', p_id, 'demo', p_demo);
end $$;

-- Un terminal NOMMÉ « totem-demo » naît démo : c'est l'identité que TOTEM
-- donne à sa démo vivante (lib/demo-vivante.ts, TERMINAL_DEMO).
create or replace function _terminal_demo_par_son_nom() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.id = 'totem-demo' then new.demo := true; end if;
  return new;
end $$;
drop trigger if exists terminal_demo_par_son_nom on terminaux;
create trigger terminal_demo_par_son_nom before insert on terminaux
  for each row execute function _terminal_demo_par_son_nom();
update terminaux set demo = true where id = 'totem-demo';

-- ──────────────────────────────── les droits ───────────────────────────────
revoke all on function _en_beta(), numero_de_demo(text), _terminal_entendu(text),
  admin_terminal_demo(text, boolean), _terminal_demo_par_son_nom() from public, anon, authenticated;
grant execute on function admin_terminal_demo(text, boolean) to authenticated;
-- operateur_du_numero et numero_de_demo sont appelées par des fonctions
-- SECURITY DEFINER ; operateur_du_numero garde ses droits d'avant.
grant execute on function numero_de_demo(text), _en_beta(), _terminal_entendu(text) to service_role;
