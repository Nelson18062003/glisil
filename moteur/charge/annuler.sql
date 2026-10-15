do $$ declare c text := 'c0000000-0000-0000-0000-' || lpad((1 + floor(random()*30))::int::text, 12, '0'); begin
  perform set_config('xafe.compte', c, true);
  perform annuler_ordre((select id from ordres where compte_id = c::uuid and etat in ('ouvert','partiel') order by random() limit 1));
exception when sqlstate 'P0001' then null; end $$;
