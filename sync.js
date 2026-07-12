// ╔══════════════════════════════════════════════════════════════════╗
// ║  GOOGLE DRIVE SYNC — auto-sync your data to your own Drive         ║
// ║  Data stays in YOUR Google account. No third-party server.        ║
// ║                                                                    ║
// ║  SETUP: paste your OAuth Client ID below (see setup guide).        ║
// ╚══════════════════════════════════════════════════════════════════╝

// ⬇️⬇️⬇️  PASTE YOUR CLIENT ID HERE (from Google Cloud Console)  ⬇️⬇️⬇️
const GOOGLE_CLIENT_ID = '994423650902-oj9cce0vpm18ip0lpmboc17st8u2na0t.apps.googleusercontent.com';
// ⬆️⬆️⬆️  ------------------------------------------------------  ⬆️⬆️⬆️

const DRIVE_FILE_NAME = 'myfinance_data.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'; // only files this app creates

let _gapiInited = false, _gisInited = false, _tokenClient = null;
let _accessToken = null, _driveFileId = null;
let syncEnabled = false, syncing = false, lastSyncTime = null;

// ---- status indicator ----
function setSyncStatus(state, detail){
  const el = document.getElementById('sync-status');
  if(!el) return;
  const map = {
    off:   {t:'☁️ ยังไม่เชื่อม Drive', c:'var(--txt3)'},
    ready: {t:'☁️ เชื่อม Drive แล้ว', c:'var(--income)'},
    syncing:{t:'🔄 กำลัง sync...', c:'var(--transfer)'},
    synced:{t:'✅ sync แล้ว'+(detail?' · '+detail:''), c:'var(--income)'},
    error: {t:'⚠️ sync ผิดพลาด'+(detail?' · '+detail:''), c:'var(--expense)'},
  };
  const s = map[state]||map.off;
  el.textContent = s.t; el.style.color = s.c;
}

// ---- load Google libraries ----
function initGoogleSync(){
  if(GOOGLE_CLIENT_ID.startsWith('PASTE_')){
    setSyncStatus('off');
    console.log('Google Drive sync not configured (no Client ID yet)');
    return;
  }
  // load GAPI
  const s1 = document.createElement('script');
  s1.src = 'https://apis.google.com/js/api.js';
  s1.onload = ()=>gapi.load('client', async ()=>{
    await gapi.client.init({discoveryDocs:['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']});
    _gapiInited = true; maybeEnableSync();
  });
  document.head.appendChild(s1);
  // load GIS (Google Identity Services)
  const s2 = document.createElement('script');
  s2.src = 'https://accounts.google.com/gsi/client';
  s2.onload = ()=>{
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE,
      callback: (resp)=>{
        if(resp.error){
          console.error('OAuth error:', resp);
          setSyncStatus('error', resp.error);
          alert('เชื่อม Google ไม่สำเร็จ\n\nError: '+resp.error+'\n'+(resp.error_description||'')+
                '\n\nสาเหตุที่พบบ่อย:\n'+
                '• origin ไม่ตรง — ต้องใส่ '+window.location.origin+' ใน Google Cloud\n'+
                '• ยังไม่ได้เพิ่มอีเมลตัวเองใน Test users');
          return;
        }
        _accessToken = resp.access_token;
        gapi.client.setToken({access_token:_accessToken});
        syncEnabled = true;
        setSyncStatus('ready');
        // first action: pull latest from Drive
        loadFromDrive(true);
      }
    });
    _gisInited = true; maybeEnableSync();
  };
  document.head.appendChild(s2);
}
function maybeEnableSync(){
  if(_gapiInited && _gisInited){ setSyncStatus('off'); }
}

// ---- user clicks "Connect Drive" ----
function connectDrive(){
  if(GOOGLE_CLIENT_ID.startsWith('PASTE_')){
    alert('ยังไม่ได้ใส่ Google Client ID ในไฟล์ sync.js'); return;
  }
  if(!_tokenClient){
    alert('Google ยังโหลดไม่เสร็จ\n\nกด "ตรวจสอบ" เพื่อดูสาเหตุ\nหรือรอ 5 วินาทีแล้วลองใหม่');
    return;
  }
  _tokenClient.requestAccessToken({prompt: _accessToken ? '' : 'consent'});
}

// ---- find or create the data file in Drive ----
async function findDriveFile(){
  const resp = await gapi.client.drive.files.list({
    q: `name='${DRIVE_FILE_NAME}' and trashed=false`,
    spaces:'drive', fields:'files(id,name,modifiedTime)'
  });
  if(resp.result.files && resp.result.files.length>0){
    _driveFileId = resp.result.files[0].id;
    return resp.result.files[0];
  }
  return null;
}

// ---- gather all app data into one object ----
function gatherAppData(){
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    accounts: ACCOUNTS,          // personal config stays in Drive
    loan: LOAN,                  // personal config stays in Drive
    meta: {cats: META.cats, wallets: META.wallets},
    tx: txData,
    holdings: holdings,
    cardBalances: cardBalances,
    walletOverrides: walletOverrides,
    nw: {inputs: nwInputs, history: nwHistory},
    budgets: budgets,
  };
}

// ---- apply loaded data back into the app ----
function applyAppData(d){
  // PERSONAL CONFIG (accounts, loan, categories) — comes from Drive, not public code
  if(d.accounts && Object.keys(d.accounts).length){
    ACCOUNTS = d.accounts;
    if(typeof rebuildDerived==='function') rebuildDerived();
  }
  if(d.loan){ LOAN = d.loan; if(typeof rebuildDerived==='function') rebuildDerived(); }
  if(d.walletOverrides) walletOverrides = d.walletOverrides;
  if(d.meta){
    if(d.meta.cats) META.cats = d.meta.cats;
    if(d.meta.wallets) META.wallets = d.meta.wallets;
  }
  if(d.tx) txData = d.tx;
  if(d.holdings) holdings = d.holdings;
  if(d.cardBalances) cardBalances = d.cardBalances;
  if(d.walletOverrides) walletOverrides = d.walletOverrides;
  if(d.nw){ nwInputs = d.nw.inputs||nwInputs; nwHistory = d.nw.history||nwHistory; }
  if(d.budgets) budgets = d.budgets;
  // persist locally + refresh
  saveTxData(); saveHoldings();
  localStorage.setItem('myfinance_cardbal_v2', JSON.stringify(cardBalances));
  localStorage.setItem('myfinance_wallet_override_v2', JSON.stringify(walletOverrides));
  saveNW(); saveBudgetsLS();
  // rebuild category lists + wallet dropdowns now that real data is loaded
  if(typeof refreshAfterLoad==='function') refreshAfterLoad();
  if(typeof goTab==='function') goTab(document.querySelector('.page.active')?.id?.replace('page-','')||'add');
}

// ---- SAVE to Drive ----
async function syncToDrive(){
  if(!syncEnabled || syncing) return;
  syncing = true; setSyncStatus('syncing');
  try{
    const data = JSON.stringify(gatherAppData());
    await findDriveFile();
    const metadata = {name:DRIVE_FILE_NAME, mimeType:'application/json'};
    const boundary='-------myfinance'+Date.now();
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`+
      JSON.stringify(metadata)+
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`+
      data+`\r\n--${boundary}--`;
    const method = _driveFileId ? 'PATCH' : 'POST';
    const url = _driveFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${_driveFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const resp = await fetch(url, {
      method, headers:{Authorization:`Bearer ${_accessToken}`, 'Content-Type':`multipart/related; boundary=${boundary}`},
      body
    });
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const result = await resp.json();
    if(result.id) _driveFileId = result.id;
    lastSyncTime = new Date();
    setSyncStatus('synced', lastSyncTime.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}));
  }catch(e){
    console.error('syncToDrive error', e);
    setSyncStatus('error', e.message);
  }finally{ syncing = false; }
}

// ---- LOAD from Drive ----
async function loadFromDrive(isInitial){
  if(!syncEnabled) return;
  setSyncStatus('syncing');
  try{
    const file = await findDriveFile();
    if(!file){
      // nothing in Drive yet — push current data up as the first copy
      await syncToDrive();
      return;
    }
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      {headers:{Authorization:`Bearer ${_accessToken}`}});
    const remote = await resp.json();
    // CONFLICT GUARD on initial load: if remote is newer, offer to use it
    if(isInitial){
      const remoteTime = new Date(remote.savedAt||0).getTime();
      const localTime = parseInt(localStorage.getItem('myfinance_last_local_change')||'0');
      if(remoteTime >= localTime){
        applyAppData(remote);
        setSyncStatus('synced','โหลดจาก Drive');
      }else{
        // local is newer — keep local, push it up
        await syncToDrive();
      }
    }else{
      applyAppData(remote);
      setSyncStatus('synced','โหลดจาก Drive');
    }
  }catch(e){
    console.error('loadFromDrive error', e);
    setSyncStatus('error', e.message);
  }
}

// ---- hook: mark local change + trigger auto-sync (debounced) ----
let _syncTimer = null;
function markLocalChange(){
  localStorage.setItem('myfinance_last_local_change', Date.now().toString());
  if(!syncEnabled) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToDrive, 2500); // debounce: sync 2.5s after last change
}


// ---- DIAGNOSTIC: tells you exactly what's blocking the sync ----
function diagnoseSync(){
  const lines = [];
  const ok = (s)=>'✅ '+s, bad = (s)=>'❌ '+s, warn=(s)=>'⚠️ '+s;

  // 1. Is sync.js even loaded?
  lines.push(ok('sync.js โหลดแล้ว'));

  // 2. Client ID set?
  if(GOOGLE_CLIENT_ID.startsWith('PASTE_')){
    lines.push(bad('ยังไม่ได้ใส่ Client ID ใน sync.js'));
  } else if(!GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')){
    lines.push(bad('Client ID รูปแบบผิด — ต้องลงท้ายด้วย .apps.googleusercontent.com'));
    lines.push('   ที่ใส่ไว้: '+GOOGLE_CLIENT_ID.slice(0,40)+'...');
  } else {
    lines.push(ok('Client ID: ...'+GOOGLE_CLIENT_ID.slice(-30)));
  }

  // 3. Origin — the #1 cause of failure
  lines.push('📍 Origin ของหน้านี้: '+window.location.origin);
  lines.push('   (ค่านี้ต้องตรงกับ Authorized JavaScript origins ใน Google Cloud เป๊ะๆ)');

  // 4. Protocol check
  if(window.location.protocol === 'file:'){
    lines.push(bad('เปิดจากไฟล์ในเครื่อง (file://) — Google ไม่อนุญาต ต้องเปิดจาก URL เว็บ'));
  } else {
    lines.push(ok('เปิดจากเว็บ ('+window.location.protocol+') ถูกต้อง'));
  }

  // 5. Google libraries loaded?
  lines.push(typeof gapi!=='undefined' ? ok('Google API (gapi) โหลดแล้ว') : bad('gapi ยังไม่โหลด — เช็คอินเทอร์เน็ต/ตัวบล็อกโฆษณา'));
  lines.push(typeof google!=='undefined' && google.accounts ? ok('Google Identity โหลดแล้ว') : bad('Google Identity ยังไม่โหลด'));
  lines.push(_gapiInited ? ok('gapi client พร้อม') : warn('gapi client ยังไม่พร้อม (รอสักครู่แล้วลองใหม่)'));
  lines.push(_tokenClient ? ok('Token client พร้อม') : bad('Token client ยังไม่พร้อม'));
  lines.push(syncEnabled ? ok('เชื่อม Drive แล้ว') : warn('ยังไม่ได้เชื่อม Drive (กดปุ่มเชื่อม Drive)'));

  const msg = lines.join('\n');
  console.log(msg);
  alert('=== ตรวจสอบระบบ Sync ===\n\n'+msg);
  return msg;
}

// Initialize on load
if(typeof window!=='undefined'){
  window.addEventListener('load', ()=>{ try{ initGoogleSync(); }catch(e){ console.log(e); } });
}
