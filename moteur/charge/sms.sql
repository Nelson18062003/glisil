do $$ begin
  perform totem_sms_recu((array['akwa-1','hasard-2'])[1 + floor(random()*2)::int], 600000 + floor(random()*300)::bigint, 'mtn',
    (array['677000000','677000555'])[1 + floor(random()*2)::int], '6789100' || lpad((1 + floor(random()*30))::int::text, 2, '0'),
    (array[5000, 20000, 150000])[1 + floor(random()*3)::int], 'C' || lpad(floor(random()*400)::int::text, 7, '0'), '…', now());
exception when sqlstate 'P0001' then null; end $$;
