do $$ declare r jsonb; begin
  perform set_config('xafe.compte', 'c0000000-0000-0000-0000-' || lpad((1 + floor(random()*30))::int::text, 12, '0'), true);
  r := devis_rapide((array['achat','vente'])[1 + floor(random()*2)::int], (array[8000, 30000, 15, 40])[1 + floor(random()*4)::int]);
  perform executer_devis((r ->> 'id')::uuid);
exception when sqlstate 'P0001' then null; end $$;
