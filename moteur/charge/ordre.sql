do $$ begin
  perform set_config('xafe.compte', 'c0000000-0000-0000-0000-' || lpad((1 + floor(random()*30))::int::text, 12, '0'), true);
  perform placer_ordre((array['achat','vente'])[1 + floor(random()*2)::int], (array['limite','limite','marche'])[1 + floor(random()*3)::int],
                       round((10 + random()*40)::numeric, 2), round((598 + floor(random()*80) * 0.05)::numeric, 2));
exception when sqlstate 'P0001' then null; end $$;
