do $$ declare c text := 'c0000000-0000-0000-0000-' || lpad((1 + floor(random()*30))::int::text, 12, '0'); begin
  perform set_config('xafe.compte', c, true);
  perform declarer_transaction((select reference from depots where compte_id = c::uuid and etat <> 'annule' order by cree_le desc limit 1),
                               'C' || lpad(floor(random()*400)::int::text, 7, '0'));
exception when sqlstate 'P0001' then null; end $$;
