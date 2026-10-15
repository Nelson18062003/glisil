do $$ declare c text := 'c0000000-0000-0000-0000-' || lpad((1 + floor(random()*30))::int::text, 12, '0'); begin
  perform set_config('xafe.compte', c, true);
  perform demander_sortie((array[2000, 30000, 120000])[1 + floor(random()*3)::int],
                          (select id from numeros where compte_id = c::uuid and verifie_le is not null and retire_le is null limit 1));
exception when sqlstate 'P0001' then null; end $$;
