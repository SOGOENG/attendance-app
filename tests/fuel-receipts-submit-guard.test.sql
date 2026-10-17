-- Connect directly as authenticated, complete report1 fixture and pending receipt provided.
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin
 begin perform public.submit_driving_report(1);raise exception 'pending receipt submission allowed';exception when others then if sqlerrm<>'receipt_upload_pending' then raise;end if;end;
 if (select status from public.driving_reports where id=1)<>'draft' then raise exception 'failed submission changed report';end if;
 raise notice 'PASS existing submit RPC rejects pending uploads and preserves draft';
end$$;
