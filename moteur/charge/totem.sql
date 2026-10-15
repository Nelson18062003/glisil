do $$ declare k commandes; begin
  select * into k from commandes where etat = 'en_attente' order by random() limit 1;
  if k.id is null then return; end if;
  k := totem_reclamer_commande(k.id, k.terminal);
  perform totem_resultat_commande(k.id, k.terminal, random() < 0.7, 'charge', null, k.reprises);
exception when sqlstate 'P0001' then null; end $$;
