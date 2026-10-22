// Only operation UUID/state are persisted. Payload fingerprint excludes secrets.
// Web Locks serializes allocation across same-origin tabs. No unsafe fallback.
window.EmployeeCreationState = (() => {
  async function key(actorId, data) {
    if (!actorId || !navigator.locks || !crypto.subtle) throw Error('登録操作を安全に保存できません。管理者へ確認してください。');
    const normalized=JSON.stringify(Object.keys(data).sort().map(k=>[k,typeof data[k]==='string'?data[k].trim():data[k]]));
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
    return 'employeeCreation.v2.'+actorId+'.'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  }
  return {
    async acquire(actorId,data) {
      const storageKey=await key(actorId,data);
      return navigator.locks.request('employeeCreationLedger',()=>{
        const raw=localStorage.getItem(storageKey);
        let record;
        if(raw){try{record=JSON.parse(raw);}catch{throw Error('登録操作の記録を確認できません。再登録せず管理者へ確認してください。');}}
        else {record={operationId:crypto.randomUUID(),state:'pending'};localStorage.setItem(storageKey,JSON.stringify(record));}
        if(!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(record.operationId||''))throw Error('登録操作IDを確認できません。管理者へ確認してください。');
        return {storageKey,operationId:record.operationId};
      });
    },
    async record(operation,result) {
      return navigator.locks.request('employeeCreationLedger',()=>{
        localStorage.setItem(operation.storageKey,JSON.stringify({operationId:result.operationId||operation.operationId,
          state:result.success===true?'completed':result.recoveryRequired?'recovery_required':'pending'}));
      });
    }
  };
})();
