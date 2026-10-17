(() => {
 'use strict';
 const endpoint=()=>`${PORTAL_SUPABASE_URL}/functions/v1/fuel-receipts`;
 const states=new WeakMap();
 async function api(action,data={}){
  const response=await portalFetch(endpoint(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'領収書を処理できません。');return result;
 }
 function message(s,text,error=false){s.notice.textContent=text;s.notice.classList.toggle('is-error',error);}
 function changed(row){row.dispatchEvent(new Event('input',{bubbles:true}));}
 async function compress(file){
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
   if(file.size>8388608)throw Error('PDFは8MB以下にしてください。');return file;
  }
  if(file.size>20*1024*1024)throw Error('元の画像は20MB以下にしてください。');
  if(!/^(image\/(jpeg|png|heic|heif))$/i.test(file.type)&&!(/\.(jpe?g|png|heic|heif)$/i.test(file.name)))throw Error('JPEG・PNG・HEIC・PDFを選択してください。');
  const url=URL.createObjectURL(file),img=new Image();
  try{img.src=url;await img.decode();}catch{throw Error('このブラウザでは画像を読み込めません。HEICはJPEGへ変換するか、iPhoneの「互換性優先」で撮影してください。');}finally{URL.revokeObjectURL(url);}
  if(!img.naturalWidth||img.naturalWidth*img.naturalHeight>60000000)throw Error('画像の解像度が大きすぎます。撮影サイズを小さくしてください。');
  const scale=Math.min(1,2400/img.naturalWidth,Math.sqrt(16000000/(img.naturalWidth*img.naturalHeight)));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  let blob;for(const quality of [.92,.89,.86]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(!blob)throw Error('画像の圧縮に失敗しました。');if(blob.size<=200*1024)break;}
  if(file.type==='image/png'){const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(png&&png.size<blob.size)blob=png;}
  canvas.width=canvas.height=1;
  if(blob.size>8388608)throw Error('圧縮後も8MBを超えます。画像を確認してください。');
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+(blob.type==='image/png'?'.png':'.jpg'),{type:blob.type});
 }
 function clearPreview(s){if(s.localUrl){URL.revokeObjectURL(s.localUrl);s.localUrl=null;}s.preview.replaceChildren();}
 function preview(s,url,mime){
  s.preview.replaceChildren();const button=document.createElement('button');button.type='button';button.className='driving-secondary receipt-preview-button';
  if(mime.startsWith('image/')){const img=document.createElement('img');img.src=url;img.alt='領収書プレビュー（押すと拡大）';button.append(img);}else button.textContent='領収書PDFを開く';
  // Preview remains available on submitted reports (fieldset disables buttons).
  const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','領収書を拡大表示');link.append(...button.childNodes);if(mime.startsWith('image/')){const caption=document.createElement('span');caption.textContent='拡大表示';link.append(caption);}s.preview.append(link);
 }
 function captureLabels(s){
  const attached=!!s.pending||(!s.remove&&s.items.some(c=>c.state==='active'));
  s.row.querySelector('[data-receipt="camera"]').textContent=attached?'標準カメラで再撮影':'標準カメラで撮影';
  s.row.querySelector('[data-receipt="choose"]').textContent=attached?'写真・ファイルを差し替え':'写真・ファイルから選択';
 }
 async function renderSaved(s){
  if(s.pending||s.remove||s.disposed)return;
  clearPreview(s);
  captureLabels(s);
  const active=s.items.find(c=>c.state==='active');
  if(active){const signed=await api('view',{id:active.id});preview(s,signed.url,active.mime);s.preview.querySelector('a').onclick=event=>{event.preventDefault();const win=window.open('about:blank','_blank');if(win)win.opener=null;api('view',{id:active.id}).then(fresh=>{if(win)win.location=fresh.url;else message(s,'ブラウザのポップアップを許可して再度お試しください。',true);}).catch(error=>{win?.close();message(s,error.message,true);});};message(s,'領収書添付済み（閲覧URLは60秒間有効）。再表示で更新できます。');}
  else if(s.items.some(c=>c.state==='archived'))message(s,'領収書画像はアーカイブ済み');
  else if(s.items.some(c=>['pending','deleting'].includes(c.state)))message(s,'未完了の添付操作があります。「添付を削除」で整理してから再添付してください。',true);
  else message(s,'領収書は未添付です。添付は提出必須ではありません。');
 }
 function attach(row,refuelId=null){
  const box=document.createElement('div');box.className='receipt-attachment';
  box.innerHTML='<p><strong>給油領収書</strong></p><div class="receipt-actions"><button type="button" data-receipt="camera" class="driving-secondary">標準カメラで撮影</button><button type="button" data-receipt="choose" class="driving-secondary">写真・ファイルから選択</button><button type="button" data-receipt="remove" class="driving-secondary">添付を削除</button><button type="button" data-receipt="refresh" class="driving-secondary">添付を再表示</button></div><input type="file" data-receipt="camera-input" accept="image/*" capture="environment" hidden><input type="file" data-receipt="file-input" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf,.heic,.heif" hidden><p class="driving-help">「標準カメラで撮影」は端末の撮影機能を開きます。写真ライブラリからの選択や、PCでの画像・PDF添付もできます。JPEG・PNG・HEIC（対応ブラウザ）・PDF、保存時8MBまで。領収書全体を撮影し、圧縮後の画像を拡大して日付・金額・明細が読めるか確認してください。読みにくい場合は再撮影・差し替えできます。</p><p data-receipt="notice" class="driving-help" role="status"></p><div data-receipt="preview" class="receipt-preview"></div>';
  row.append(box);const q=key=>box.querySelector(`[data-receipt="${key}"]`);
  const s={row,refuelId,items:[],pending:null,remove:false,processing:false,revision:0,disposed:false,preview:q('preview'),notice:q('notice'),localUrl:null};states.set(row,s);
  q('camera').onclick=()=>q('camera-input').click();q('choose').onclick=()=>q('file-input').click();
  const select=async event=>{
   const file=event.target.files?.[0];if(!file)return;const revision=++s.revision;s.processing=true;changed(row);
   try{const compressed=await compress(file);if(revision!==s.revision||s.disposed)return;s.pending={id:crypto.randomUUID(),file:compressed};s.remove=false;clearPreview(s);s.localUrl=URL.createObjectURL(s.pending.file);preview(s,s.localUrl,s.pending.file.type);captureLabels(s);message(s,`保存待ち：${Math.ceil(s.pending.file.size/1024)}KB。文字の判読性を確認してください。`);}
   catch(error){if(revision===s.revision&&!s.disposed)message(s,error.message,true);}finally{if(revision===s.revision)s.processing=false;event.target.value='';}
  };
  q('camera-input').onchange=select;q('file-input').onchange=select;
  q('remove').onclick=()=>{++s.revision;s.processing=false;s.pending=null;s.remove=true;clearPreview(s);captureLabels(s);message(s,'添付を削除して保存します。');changed(row);};
  q('refresh').onclick=()=>{if(s.pending)return;s.ready=load().catch(error=>message(s,error.message,true));};
  async function load(){if(!s.refuelId){message(s,'領収書は未添付です。');return;}s.items=await api('get',{refuel_id:s.refuelId});await renderSaved(s);}
  s.ready=load().catch(error=>{message(s,'領収書を読み込めませんでした。既存添付は変更しません。 '+error.message,true);});
  return s;
 }
 async function save(row,refuelId){
  const s=states.get(row);if(!s)return;await s.ready;s.refuelId=refuelId;
  if(s.processing)throw Error('領収書を圧縮中です。完了してから保存してください。');
  if(s.remove){
   const items=await api('get',{refuel_id:refuelId});
   for(const item of items.filter(c=>['pending','active','deleting'].includes(c.state)))await api('remove',{id:item.id});
   s.remove=false;s.items=[];message(s,'添付を削除しました。');
  }
  if(s.pending){
   const form=new FormData();form.set('refuel_id',refuelId);form.set('id',s.pending.id);form.set('file',s.pending.file);
   const response=await portalFetch(endpoint(),{method:'POST',body:form}),result=await response.json();
   if(!response.ok)throw Error(result.error||'領収書のアップロードに失敗しました。入力と添付は残しています。');
   s.items=[result];s.pending=null;await renderSaved(s);
  }
 }
 async function removeForRefuel(id){const items=await api('get',{refuel_id:id});for(const item of items.filter(c=>['active','pending','deleting'].includes(c.state)))await api('remove',{id:item.id});}
 async function missing(rows){let count=0;for(const row of rows){const s=states.get(row);if(!s)continue;await s.ready;if(s.processing)throw Error('領収書を圧縮中です。');if(!s.pending&&(s.remove||!s.items.some(c=>c.state==='active')))count++;}return count;}
 function dispose(row){const s=states.get(row);if(s){s.disposed=true;++s.revision;clearPreview(s);}}
 window.FuelReceipts={attach,save,removeForRefuel,missing,dispose,api,compress};
})();
