const enc = new TextEncoder();
export const safeName = value => String(value || '未設定').normalize('NFKC').replace(/[\x00-\x1f\x7f/\\:*?"<>|.]/g, '_').slice(0,70) || '未設定';
export const csvCell = value => '"' + String(value ?? '').replace(/^(?:\s*[=+\-@]|[\t\r\n])/, x => "'"+x).replaceAll('"','""') + '"';
export function csv(rows, paths) {
 const data=[['給油日','社員名','車両','給油量（L）','給油時メーター（km）','原本受領状態','原本受領日','原本受領担当者','添付ファイル名'],
 ...rows.map(r=>[r.fuel_date,r.employee_name,r.vehicle,r.liters,r.odometer_km,r.received?'受領済み':'未受領',r.received_at,r.received_by,paths.get(r.receipt_id)||''])];
 return enc.encode('\ufeff'+data.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
}
export function filePaths(job) {
 const paths=new Map();
 for(const file of job.manifest.files){
  const row=job.manifest.rows.find(r=>r.receipt_id===file.id);
  const ext=file.mime==='application/pdf'?'pdf':file.mime==='image/png'?'png':'jpg';
  paths.set(file.id,`${job.month.slice(0,7)}/${safeName(row.employee_name)}_${row.employee_id}/${row.fuel_date}_領収書_${file.id}.${ext}`);
 }
 return paths;
}
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function pack(size, values){const b=new Uint8Array(size),v=new DataView(b.buffer);for(const [at,value,width] of values)width===2?v.setUint16(at,value,true):v.setUint32(at,value,true);return b;}
// STORE ZIP: one file buffered at a time, central directory only grows with file count.
export async function* zip(files){
 const directory=[];let offset=0;
 for await(const file of files){
  const name=enc.encode(file.name),bytes=file.bytes,crc=crc32(bytes);
  if(bytes.length>0xffffffff||offset+bytes.length>0xffffffff||directory.length>=65535)throw Error('ZIP容量制限を超えました。');
  const header=pack(30,[[0,0x04034b50,4],[4,20,2],[6,0x800,2],[12,33,2],[14,crc,4],[18,bytes.length,4],[22,bytes.length,4],[26,name.length,2]]);
  const central=pack(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[14,33,2],[16,crc,4],[20,bytes.length,4],[24,bytes.length,4],[28,name.length,2],[42,offset,4]]);
  directory.push(central,name);yield header;yield name;yield bytes;offset+=header.length+name.length+bytes.length;
 }
 const start=offset;for(const block of directory){yield block;offset+=block.length;}
 yield pack(22,[[0,0x06054b50,4],[8,directory.length/2,2],[10,directory.length/2,2],[12,offset-start,4],[16,start,4]]);
}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function detectType(b){
 if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n))return 'image/png';
 if(new TextDecoder().decode(b.slice(0,5))==='%PDF-')return 'application/pdf';
 throw Error('JPEG・PNG・PDFのファイルを選択してください。');
}
