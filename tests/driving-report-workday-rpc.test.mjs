// Authoritative monthly RPC results, offline only.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context={window:{},DrivingReportPeriod:{validDate:()=>true}};
vm.createContext(context);vm.runInContext(await readFile(new URL('../driving-report-workday.js',import.meta.url),'utf8'),context);
const assess=(extra={},report)=>context.window.DrivingReportWorkday.fromCheck({date:'2026-10-18',required:false,reason:'company_holiday',issue:null,...extra},'2026-10-21',report).state;
assert.equal(assess(),'exempt');
assert.equal(assess({reason:'approved_full_leave'}),'exempt');
assert.equal(assess({required:true,reason:'calendar_workday',issue:'report_missing'}),'unsubmitted');
assert.equal(assess({required:true,reason:'active_holiday_work',issue:'report_missing'}),'unsubmitted');
assert.equal(assess({required:true},{status:'submitted'}),'complete');
assert.equal(assess({required:true},{status:'draft'}),'unsubmitted');
for(const issue of ['work_unconfirmed','work_leave_conflict','half_or_ambiguous_leave','holiday_work_attendance_conflict','calendar_unconfirmed'])assert.equal(assess({issue}),'unknown');
assert.equal(assess({required:undefined}),'unknown');
assert.equal(assess({reason:null}),'unknown');
assert.equal(assess({date:'2026-10-21'}),'today');
assert.equal(assess({date:'2026-10-22'}),'future');
console.log('PASS monthly assessment: RPC work/holiday/full leave/half leave/conflict/unknown/today/future; no independent exemption or network.');
