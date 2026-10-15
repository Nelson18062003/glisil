-- La charge part de comptes approvisionnés : 30 clients avec XAFe et USDT, numéros vérifiés.
\set ON_ERROR_STOP on
\set QUIET on
do $$
declare i int; c uuid;
begin
  update terminaux set vu_le = now();
  for i in 1 .. 30 loop
    c := ('c0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    insert into comptes (id, telephone, nom, palier) values (c, '6789100' || lpad(i::text, 2, '0'), 'Charge ' || i, (i - 1) % 3) on conflict do nothing;
    insert into numeros (compte_id, operateur, numero, verifie_le, actif_des)
    values (c, 'mtn', '6789100' || lpad(i::text, 2, '0'), now() - interval '2 days', now() - interval '1 day') on conflict do nothing;
    perform crediter_crypto(c, 'USDT', 'bep20', 5000, '0xcharge' || i, 'x');
    -- des XAFe par la voie normale : un dossier, un ID, son SMS
    perform set_config('xafe.compte', c::text, true);
    perform declarer_transaction((ouvrir_depot('mtn', 'k-charge') ->> 'reference'), 'CHARGE' || lpad(i::text, 6, '0'));
    perform totem_sms_recu('akwa-1', 700000 + i, 'mtn', '677000000', '6789100' || lpad(i::text, 2, '0'), 400000, 'CHARGE' || lpad(i::text, 6, '0'), '…', now());
  end loop;
end $$;
