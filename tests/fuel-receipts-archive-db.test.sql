-- Isolated fixture DB, real service_role connection; first receipt aged by owner fixture.
\set ON_ERROR_STOP on
do $$
declare job jsonb; proof jsonb; c jsonb; actor uuid:='00000000-0000-0000-0000-000000000003';
begin
 perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','reserve','{"id":"20000000-0000-0000-0000-000000000002","refuel_id":2,"mime":"application/pdf","bytes":100,"name":"b.pdf","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
 perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','finalize','{"id":"20000000-0000-0000-0000-000000000002"}');
 job:=public.fuel_receipt_command(actor,'export_start','{"month":"2026-10"}');
 if jsonb_array_length(job->'manifest'->'files')<>2 then raise exception 'wrong export files'; end if;
 begin perform public.fuel_receipt_command(actor,'archive_begin',jsonb_build_object('id','10000000-0000-0000-0000-000000000001','export_id',job->>'id'));raise exception 'archive allowed without backup';exception when others then if sqlerrm<>'archive_preconditions_not_met' then raise;end if;end;
 raise notice 'PASS cannot delete before download + verified backup + approval';
 begin perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','remove_done','{"id":"10000000-0000-0000-0000-000000000001"}');raise exception 'completion without begin allowed';exception when others then if sqlerrm<>'delete_not_started' then raise;end if;end;
 raise notice 'PASS cannot complete draft deletion before begin';
 perform public.fuel_receipt_command(actor,'export_generated',jsonb_build_object('export_id',job->>'id'));
 perform public.fuel_receipt_command(actor,'export_downloaded',jsonb_build_object('export_id',job->>'id'));
 begin perform public.fuel_receipt_command(actor,'backup',jsonb_build_object('export_id',job->>'id','location','company/share','legal_checked',true,'verified_files','[]'::jsonb));raise exception 'bad manifest allowed';exception when others then if sqlerrm<>'backup_manifest_mismatch' then raise;end if;end;
 raise notice 'PASS checksum / count mismatch rejected';
 select jsonb_agg(jsonb_build_object('id',x->>'id','sha256',x->>'sha256')) into proof from jsonb_array_elements(job->'manifest'->'files') x;
 perform public.fuel_receipt_command(actor,'backup',jsonb_build_object('export_id',job->>'id','location','company/share','legal_checked',true,'verified_files',proof));
 begin perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000002','approve',jsonb_build_object('export_id',job->>'id'));raise exception 'accounting approved delete';exception when others then if sqlerrm<>'archive_approval_denied' then raise;end if;end;
 raise notice 'PASS accounting cannot approve deletion';
 perform public.fuel_receipt_command(actor,'approve',jsonb_build_object('export_id',job->>'id'));
 begin perform public.fuel_receipt_command(actor,'archive_begin',jsonb_build_object('id','20000000-0000-0000-0000-000000000002','export_id',job->>'id'));raise exception 'young file deleted';exception when others then if sqlerrm<>'archive_preconditions_not_met' then raise;end if;end;
 raise notice 'PASS under-one-year file cannot be deleted';
 c:=public.fuel_receipt_command(actor,'archive_begin',jsonb_build_object('id','10000000-0000-0000-0000-000000000001','export_id',job->>'id'));
 if c->>'state'<>'deleting' or c->>'deletion_kind'<>'archive' then raise exception 'delete state';end if;
 begin perform public.fuel_receipt_command('00000000-0000-0000-0000-000000000001','remove_begin',jsonb_build_object('id',c->>'id'));raise exception 'archive switched to draft deletion';exception when others then if sqlerrm<>'receipt_locked' then raise;end if;end;
 begin perform public.fuel_receipt_command(actor,'export_failed',jsonb_build_object('export_id',job->>'id','error','concurrent change'));raise exception 'changed confirmation during delete';exception when others then if sqlerrm<>'archive_in_progress' then raise;end if;end;
 begin perform public.fuel_receipt_command(actor,'backup',jsonb_build_object('export_id',job->>'id'));raise exception 'changed backup during delete';exception when others then if sqlerrm<>'archive_in_progress' then raise;end if;end;
 raise notice 'PASS deleting operation binds archive mode/ZIP and freezes backup confirmation';
 -- A Storage failure leaves the record in deleting, not archived; retry is idempotent.
 perform public.fuel_receipt_command(actor,'file_failure',jsonb_build_object('id',c->>'id','error','mock storage failure'));
 c:=public.fuel_receipt_command(actor,'archive_begin',jsonb_build_object('id',c->>'id','export_id',job->>'id'));
 c:=public.fuel_receipt_command(actor,'archive_done',jsonb_build_object('id',c->>'id','export_id',job->>'id'));
 if c->>'state'<>'archived' or (c->>'refuel_id')::bigint<>1 then raise exception 'archive changed fuel relationship';end if;
 raise notice 'PASS one-year backed-up approved file archives; failure/retry keeps audit and fuel link';
end$$;
