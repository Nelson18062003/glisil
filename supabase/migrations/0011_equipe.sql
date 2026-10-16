-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0011 · l'équipe                                              ║
-- ║  Le super administrateur voit qui administre, qui est invité, quand    ║
-- ║  chacun est venu pour la dernière fois ; il invite, retire une         ║
-- ║  invitation, change un rôle, met en pause. Tout par le droit           ║
-- ║  « administrateurs », et jamais sur soi-même.                          ║
-- ╚════════════════════════════════════════════════════════════════════════╝

create or replace function admin_equipe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  return jsonb_build_object(
    'administrateurs', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', a.id, 'email', a.email, 'nom', a.nom, 'role', a.role, 'actif', a.actif, 'cree_le', a.cree_le,
                          'derniere_connexion', _derniere_connexion(a.id), 'moi', a.id = auth.uid())
                        order by a.actif desc, a.cree_le), '[]'::jsonb) from administrateurs a),
    'invitations', (select coalesce(jsonb_agg(jsonb_build_object('email', i.email, 'nom', i.nom, 'role', i.role, 'invite_le', i.invite_le)
                        order by i.invite_le desc), '[]'::jsonb) from administrateurs_invites i));
end $$;

create or replace function admin_retirer_invitation(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform _exiger_droit('administrateurs');
  delete from administrateurs_invites where email = lower(trim(coalesce(p_email, '')));
  if not found then raise exception 'invitation inconnue'; end if;
  perform _journaliser('invitation_retiree', lower(trim(p_email)));
  return jsonb_build_object('ok', true);
end $$;

-- Changer le rôle d'un autre : jamais le sien (on ne s'enlève pas ses propres droits
-- par mégarde, et le dernier super administrateur reste super administrateur).
create or replace function admin_changer_role(p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_avant text;
begin
  perform _exiger_droit('administrateurs');
  if p_id = auth.uid() then raise exception 'on ne change pas son propre rôle'; end if;
  if p_role not in ('super_admin', 'operateur', 'tresorier', 'support') then raise exception 'rôle inconnu'; end if;
  select role into v_avant from administrateurs where id = p_id for update;
  if not found then raise exception 'administrateur inconnu'; end if;
  update administrateurs set role = p_role where id = p_id;
  perform _journaliser('changer_role', p_id::text, jsonb_build_object('avant', v_avant, 'apres', p_role));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function admin_equipe(), admin_retirer_invitation(text), admin_changer_role(uuid, text) from public, anon, authenticated;
grant execute on function admin_equipe(), admin_retirer_invitation(text), admin_changer_role(uuid, text) to authenticated, service_role;
