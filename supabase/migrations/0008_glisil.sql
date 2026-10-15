-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║  Glisil · 0008 · le nom                                                ║
-- ║  « XAFe Exchange » devient Glisil : le marché s'appelle Glisil, XAFe   ║
-- ║  reste le nom du stablecoin. Deux choses le portent dans la base : le  ║
-- ║  compte de la maison, et le SMS du code de vérification.               ║
-- ╚════════════════════════════════════════════════════════════════════════╝

update comptes set nom = 'Glisil'
 where id = '00000000-0000-0000-0000-000000000001' and maison and nom = 'XAFe Exchange';

create or replace function _envoyer_code_numero(p_n numeros) returns void
language plpgsql as $$
declare
  v_code  text := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_float floats;
begin
  if exists (select 1 from numeros_codes where numero_id = p_n.id and envoye_le > now() - interval '1 minute') then
    raise exception 'un code vient de partir' using detail = 'attendez une minute avant d''en demander un autre';
  end if;
  if (select count(*) from messages_sortants where numero = p_n.numero and cree_le > now() - interval '1 hour') >= 5 then
    raise exception 'trop de codes demandés pour ce numéro' using detail = 'réessayez dans une heure';
  end if;
  insert into numeros_codes (numero_id, empreinte, expire_le)
  values (p_n.id, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), now() + interval '10 minutes')
  on conflict (numero_id) do update set empreinte = excluded.empreinte, expire_le = excluded.expire_le, essais = 0, envoye_le = now();
  -- le SMS part d'un float de cet opérateur, par TOTEM
  select f.* into v_float from floats f join terminaux t on t.id = f.terminal
   where f.operateur = p_n.operateur and f.actif order by t.vu_le desc nulls last, f.id limit 1;
  insert into messages_sortants (terminal, operateur, numero, texte, cle, expire_le)
  values (v_float.terminal, p_n.operateur, p_n.numero,
          format('Glisil : votre code est %s. Il vaut 10 minutes. Ne le partagez avec personne.', v_code),
          'num-' || p_n.id::text || '-' || extract(epoch from clock_timestamp())::bigint::text, now() + interval '10 minutes');
end $$;
