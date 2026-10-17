(() => {
 'use strict';
 const pad=n=>String(n).padStart(2,'0');
 const iso=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
 function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1000)return false;
  const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&iso(date)===value;
 }
 function today(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
 }
 function range(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1001||Number(month.slice(0,4))>9998)throw Error('有効な対象月を選択してください。');
  const [y,m]=month.split('-').map(Number),start=new Date(Date.UTC(y,m-2,21)),end=new Date(Date.UTC(y,m-1,21)),days=[];
  for(const date=new Date(start);date<end;date.setUTCDate(date.getUTCDate()+1))days.push(iso(date));
  return {start:iso(start),endExclusive:iso(end),end:days.at(-1),days};
 }
 function shift(month,delta){range(month);const [y,m]=month.split('-').map(Number);return iso(new Date(Date.UTC(y,m-1+delta,1))).slice(0,7);}
 function closingMonth(date=today()){if(!validDate(date))throw Error('日付が不正です。');return Number(date.slice(-2))>=21?shift(date.slice(0,7),1):date.slice(0,7);}
 function initialDate(search,now=today()){
  const params=new URLSearchParams(search),values=params.getAll('date');if(!values.length)return now;
  if(values.length!==1||!validDate(values[0])||values[0]>now)throw Error('URLの日付が不正、または未来日です。一覧から今日以前の日付を選び直してください。');
  return values[0];
 }
 window.DrivingReportPeriod={validDate,today,range,shift,closingMonth,initialDate};
})();
