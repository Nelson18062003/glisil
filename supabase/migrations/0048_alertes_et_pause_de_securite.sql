-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0048 · les alertes de sécurité, et la pause des retraits     ║
-- ║                                                                        ║
-- ║  Décision du propriétaire (30/10). Quand ce qui garde un compte        ║
-- ║  change, le client le SAIT, et l'argent ne part pas tout de suite :    ║
-- ║                                                                        ║
-- ║    mot de passe changé (oublié ou non)   e-mail + retraits en pause    ║
-- ║    application d'authentification        e-mail + retraits en pause    ║
-- ║      ajoutée (nouveau téléphone)                                       ║
-- ║    application retirée (code de secours, e-mail déjà parti (0035)      ║
-- ║      ou l'équipe)                        + retraits en pause           ║
-- ║    nouveaux codes de secours notés       e-mail                        ║
-- ║                                                                        ║
-- ║  La pause : 24 h sans retrait (Mobile Money ni crypto) — ce que font   ║
-- ║  les grandes plateformes. Un voleur qui a pris le compte n'a pas le    ║
-- ║  temps de le vider : le vrai client, prévenu par l'e-mail, écrit au    ║
-- ║  support. Dépôts, marché et achat rapide restent ouverts.              ║
-- ║                                                                        ║
-- ║  Tout passe par le journal de sécurité (0035) : Auth y écrit, par un   ║
-- ║  déclencheur, le mot de passe et l'application ; la base y écrivait    ║
-- ║  déjà le reste. UN déclencheur du journal décide de l'e-mail et de la  ║
-- ║  pause. Avant que le compte existe (l'inscription), rien ne part.      ║
-- ╚════════════════════════════════════════════════════════════════════════╝

insert into parametres (cle, valeur) values ('securite', '{"pause_retraits_heures": 24}')
on conflict (cle) do nothing;

alter table comptes add column if not exists securite_changee_le timestamptz;

-- deux événements de plus au journal (0036 + ceux d'Auth)
alter table journal_securite drop constraint if exists journal_securite_evenement_check;
alter table journal_securite add constraint journal_securite_evenement_check check (evenement in (
  'codes_generes', 'codes_confirmes', 'code_de_secours_utilise', 'code_de_secours_refuse', 'deux_facteurs_retires',
  'reinitialisation_demandee', 'reinitialisation_echouee', 'verification_mdp_indisponible',
  'mot_de_passe_change', 'application_ajoutee'));

-- ─────────────────── 1 · ce qu'Auth change, écrit au journal ────────────────
-- Un mot de passe qui CHANGE : pas le premier (un compte Google le choisit après coup, de '' à quelque chose).
create or replace function _auth_mot_de_passe_change() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if coalesce(old.encrypted_password, '') <> '' and new.encrypted_password is distinct from old.encrypted_password then
    perform _journal_securite(new.id, 'mot_de_passe_change', null, null);
  end if;
  return null;
end $$;
revoke all on function _auth_mot_de_passe_change() from public, anon, authenticated;

-- Une application d'authentification qui devient VÉRIFIÉE : un nouveau téléphone, ou le même réenrôlé.
create or replace function _auth_application_ajoutee() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
    perform _journal_securite(new.user_id, 'application_ajoutee', null, jsonb_build_object('type', new.factor_type));
  end if;
  return null;
end $$;
revoke all on function _auth_application_ajoutee() from public, anon, authenticated;

do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'drop trigger if exists glisil_mot_de_passe_change on auth.users';
    execute 'create trigger glisil_mot_de_passe_change after update of encrypted_password on auth.users
             for each row execute function public._auth_mot_de_passe_change()';
  end if;
  if to_regclass('auth.mfa_factors') is not null then
    execute 'drop trigger if exists glisil_application_ajoutee on auth.mfa_factors';
    execute 'create trigger glisil_application_ajoutee after insert or update of status on auth.mfa_factors
             for each row execute function public._auth_application_ajoutee()';
  end if;
end $$;

-- ──────────────── 2 · le journal décide : l'e-mail, la pause ────────────────
create or replace function _apres_evenement_de_securite() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_pause boolean := new.evenement in ('mot_de_passe_change', 'application_ajoutee', 'deux_facteurs_retires');
  v_alerte text := case new.evenement when 'mot_de_passe_change' then 'mot_de_passe'
                                      when 'application_ajoutee' then 'application'
                                      when 'codes_confirmes' then 'codes' end;
  v_jusqua timestamptz;
begin
  -- l'inscription (le compte n'existe pas encore) et la maison ne déclenchent rien
  if not exists (select 1 from comptes where id = new.utilisateur_id and not maison) then return null; end if;
  if v_pause then
    update comptes set securite_changee_le = new.cree_le where id = new.utilisateur_id;
    v_jusqua := new.cree_le + make_interval(hours => coalesce((parametre('securite') ->> 'pause_retraits_heures')::int, 24));
  end if;
  -- l'application retirée a déjà son e-mail (deux_facteurs_retires, 0035)
  if v_alerte is not null then
    perform _envoyer_courriel(new.utilisateur_id, 'alerte_securite',
      jsonb_build_object('evenement', v_alerte, 'quand', new.cree_le, 'pause_jusqua', v_jusqua, 'lien', '/compte/securite'),
      'alerte_securite:' || new.id::text);
  end if;
  return null;
end $$;
revoke all on function _apres_evenement_de_securite() from public, anon, authenticated;
drop trigger if exists apres_evenement_de_securite on journal_securite;
create trigger apres_evenement_de_securite after insert on journal_securite
  for each row execute function _apres_evenement_de_securite();

-- ───────────────────────────── 3 · la pause ────────────────────────────────
create or replace function _retraits_en_pause_jusqua(p_compte uuid) returns timestamptz
language sql stable set search_path = public, extensions, pg_temp as $$
  select c.securite_changee_le + make_interval(hours => coalesce((parametre('securite') ->> 'pause_retraits_heures')::int, 24))
    from comptes c
   where c.id = p_compte and c.securite_changee_le is not null
     and c.securite_changee_le + make_interval(hours => coalesce((parametre('securite') ->> 'pause_retraits_heures')::int, 24)) > now()
$$;
revoke all on function _retraits_en_pause_jusqua(uuid) from public, anon, authenticated;

-- Le même verrou que 0047, sur ce qui fait SORTIR l'argent : la sortie MoMo, le retrait crypto, et leur code.
create or replace function _verrou_de_pause() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
declare v_jusqua timestamptz;
begin
  if tg_table_name = 'verifications' then
    if new.operation not in ('sortie_momo', 'retrait_crypto') then return new; end if;
  end if;
  v_jusqua := _retraits_en_pause_jusqua(new.compte_id);
  if v_jusqua is not null then
    raise exception 'retraits en pause après un changement de sécurité'
      using detail = to_char(v_jusqua at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  return new;
end $$;
revoke all on function _verrou_de_pause() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['sorties', 'retraits_crypto', 'verifications'] loop
    execute format('drop trigger if exists verrou_de_pause on %I', t);
    execute format('create trigger verrou_de_pause before insert on %I for each row execute function _verrou_de_pause()', t);
  end loop;
end $$;

-- ─────────────────────── 4 · ce que voit le client ─────────────────────────
-- 0047, plus « retraits_pause_jusqua » : l'écran dit la pause AVANT un montant tapé.
create or replace function _compte_json(c comptes) returns jsonb
language sql stable set search_path = public, extensions, pg_temp as $$
  select jsonb_build_object('id', c.id, 'telephone', c.telephone, 'nom', c.nom, 'entreprise', c.entreprise, 'palier', c.palier,
                            'email', c.email, 'prenom', c.prenom, 'nom_de_famille', c.nom_de_famille,
                            'date_naissance', c.date_naissance, 'ville', c.ville, 'pays', c.pays,
                            'langue', c.langue,
                            'verification_en_cours', c.verification_en_cours,
                            'conditions_version', c.conditions_version, 'conditions_acceptees_le', c.conditions_acceptees_le,
                            'conditions_a_jour', c.maison or c.conditions_version is not distinct from (parametre('conditions') ->> 'version'),
                            'ferme_le', c.ferme_le, 'desactive', c.desactive_le is not null,
                            'approuve', c.maison or c.approuve_le is not null or not _approbation_manuelle(),
                            'approuve_le', c.approuve_le,
                            'retraits_pause_jusqua', _retraits_en_pause_jusqua(c.id),
                            -- ce qui est déjà entré aujourd'hui : l'écran montre ce qui RESTE du plafond, pas le plafond
                            'entre_du_jour', (select coalesce(sum(montant), 0) from depot_declarations
                                               where compte_id = c.id and etat = 'credite' and credite_le >= debut_du_jour()))
$$;
revoke all on function _compte_json(comptes) from public, anon, authenticated;
