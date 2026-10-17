-- Isolated fixture DB; connect directly as anon.
\set ON_ERROR_STOP on
do $$ begin
 if session_user<>'anon' or current_user<>'anon' then raise exception 'connect as anon'; end if;
 begin
  perform public.previous_vehicle_end_odometer(1,current_date);
 exception when insufficient_privilege then
  raise notice 'PASS actual anon connection => RPC permission denied';
  return;
 end;
 raise exception 'anon unexpectedly executed RPC';
end $$;
