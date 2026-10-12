-- Synthetic historical records and completed operation UUIDs, before applying CASA 3.2.
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select public.casa_save_purchase('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',null,null,'Historical manual','2026-10-01',10,'[{"name":"Historical product","quantity":1,"line_total":10}]');
select public.casa_save_receipt('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',null,null,'Historical receipt','2026-10-01',11,'[{"name":"Historical gross product","quantity":1,"line_total":12}]','[{"kind":"discount","description":"Historical promotion","amount_cents":-100,"item_index":null}]',null);
reset role;
