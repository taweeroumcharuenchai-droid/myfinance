/* ═══════════════════════════════════════════════════════════════════════
   เงินของฉัน — Personal Finance App  (single-file, offline, localStorage)
   ───────────────────────────────────────────────────────────────────────
   HOW THIS FILE IS ORGANISED (for future edits):

   1. DATA & STATE      — seed data, localStorage keys, load/save
   2. SHARED NUMBERS    — ⭐ the 6 cross-tab figures, defined ONCE.
                          If a number looks wrong everywhere, fix it HERE:
                            getPortfolioValue()  getInvestmentCash()
                            getHouseDebt()       getCardDebt()
                            getNetWorth()        getPeriodTotals()
   3. FORMAT HELPERS    — fmt(), dates, etc.
   4. TAB SECTIONS      — each tab's own display code (separate, independent):
                          Add · List · Analysis · NetWorth · Portfolio ·
                          Debt · Loan · Health
   5. VALIDATION        — cross-checks the shared numbers 2 ways (trust check)
   6. INIT              — startup

   GOLDEN RULE: a number used by >1 tab lives in SHARED NUMBERS only.
   Tabs CALL those functions; they never recompute the same value themselves.
   This is what prevents two tabs from disagreeing.

   COMMON EDITS:
   - Change FX rate ........... search: const FX
   - Change loan interest ..... Loan tab (editable in UI) or LOAN object
   - Add/adjust a budget ...... Analysis tab → "ตั้งแผน" button
   - Fix a card balance ....... Debt tab → baseline + cut-point date
   - Set a wallet's real cash . List tab → pick wallet → "ตั้งยอดจริง"
   ═══════════════════════════════════════════════════════════════════════ */

// ============ DATA ============
// SEED_DATA comes from data.js
// META comes from data.js
// HOLDINGS_SEED comes from data.js

let txData = [];
let holdings = [];      // investment holdings with units/price/type/region
let cashBalances = {};  // cash sitting in investment accounts
let cardBalances = {};  // credit card baseline balances
const LS_TX = 'myfinance_tx_v4_0628';
const LS_HOLD = 'myfinance_holdings_v5_names';

// ╔══════════════════════════════════════════════════════════════════╗
// ║  ACCOUNT REGISTRY — every account's type & duty, defined ONCE      ║
// ║  Shared functions find accounts BY TYPE, not by hardcoded name.    ║
// ║  Add a new account here (or via UI) and it flows everywhere.       ║
// ║  Types: bank · credit_card · mortgage · investment · purchase_log  ║
// ╚══════════════════════════════════════════════════════════════════╝
// ACCOUNTS is PERSONAL CONFIG — loaded from your private data (Drive), not hardcoded here.
// Public code contains NO account names, numbers, or balances.
let ACCOUNTS = (typeof ACCOUNTS_SEED !== 'undefined' && Object.keys(ACCOUNTS_SEED).length) ? ACCOUNTS_SEED : {};

// Helpers to query the registry by type

// Rebuild everything that derives from ACCOUNTS/LOAN — called after config loads from Drive

// Re-seed card baselines from ACCOUNTS config (called after config loads from Drive)
function seedCardBaselines(){
  accountsByType('credit_card').forEach(id=>{
    if(ACCOUNTS[id].baseline && !cardBalances[id]) cardBalances[id] = ACCOUNTS[id].baseline;
  });
}

function rebuildDerived(){
  INVEST_WALLETS = accountsByType('investment').concat(accountsByType('purchase_log'));
  WALLET_PORTS = {};
  accountsByType('investment').forEach(name=>{ const p=accountPorts(name); if(p.length) WALLET_PORTS[name]=p; });
  PURCHASE_LOG_WALLETS = accountsByType('purchase_log');
  DEBTS = [];
  accountsByType('credit_card').forEach(id=>DEBTS.push({id, name:ACCOUNTS[id].name||id, type:'card'}));
  accountsByType('mortgage').forEach(id=>DEBTS.push({id, name:ACCOUNTS[id].name||id, type:'loan'}));
  if(LOAN && LOAN.actualPayments && LOAN.actualPayments.length){
    LAST_ACTUAL = LOAN.actualPayments[LOAN.actualPayments.length-1];
  }
  if(typeof cardBalances!=='undefined') seedCardBaselines();
}

function accountsByType(t){ return Object.keys(ACCOUNTS).filter(k=>ACCOUNTS[k].type===t); }
function accountType(name){ return (ACCOUNTS[name]||{}).type || 'bank'; }
function accountPorts(name){ return (ACCOUNTS[name]||{}).ports || []; }

let INVEST_WALLETS = accountsByType('investment').concat(accountsByType('purchase_log'));  // derived from ACCOUNTS registry
const FX = (HOLDINGS_SEED && HOLDINGS_SEED.fxRate) || 32.42;

function loadData(){
  const t = localStorage.getItem(LS_TX);
  txData = t ? JSON.parse(t) : [...SEED_DATA];
  const h = localStorage.getItem(LS_HOLD);
  if(h){ holdings = JSON.parse(h); }
  else { holdings = buildSeedHoldings(); }
  const cb = localStorage.getItem('myfinance_cardbal_v2');
  if(cb){ cardBalances = JSON.parse(cb); }
  else {
    // seed from ACCOUNTS registry (each credit_card's baseline)
    cardBalances = {};
    accountsByType('credit_card').forEach(id=>{ if(ACCOUNTS[id].baseline) cardBalances[id]=ACCOUNTS[id].baseline; });
  }
  // carry over cash balances from backup if present
  if(META.cash) Object.keys(META.cash).forEach(k=>{ if(INVEST_WALLETS.includes(k)) cashBalances[k]=META.cash[k]; });
  loadNW();
  if(!t) saveTxData();
  if(!h) saveHoldings();
}
function saveTxData(){ localStorage.setItem(LS_TX, JSON.stringify(txData)); }
function saveHoldings(){ localStorage.setItem(LS_HOLD, JSON.stringify(holdings)); }

function buildSeedHoldings(){
  // v4: backup holdings is already a flat array in final form
  if(Array.isArray(HOLDINGS_SEED)) return JSON.parse(JSON.stringify(HOLDINGS_SEED));
  // legacy nested seed structure
  const out = [];
  HOLDINGS_SEED.usStocks.forEach(h=>out.push({...h, port:'us'}));
  HOLDINGS_SEED.etfs.forEach(h=>out.push({...h, port:'etf'}));
  HOLDINGS_SEED.thaiStocks.forEach(h=>out.push({...h, port:'thai'}));
  HOLDINGS_SEED.funds.forEach(h=>out.push({
    name:h.name, type:h.type, region:h.region, ccy:'THB', port:'fund',
    lump:true, lumpCost:h.lumpCost, lumpValue:h.lumpValue
  }));
  return out;
}

// ============ CATEGORY CLASSIFICATION ============
// These are rebuilt after META.cats loads from Drive (public data.js has empty cats)
let INCOME_CATS = [], TRANSFER_CATS = [], EXPENSE_CATS = [];
function rebuildCategories(){
  INCOME_CATS = META.cats.filter(c => /Salary|Income|Interest|Selling|Award/.test(c));
  TRANSFER_CATS = META.cats.filter(c => /transfer|Withdrawal/.test(c));
  EXPENSE_CATS = META.cats.filter(c => !INCOME_CATS.includes(c) && c!=='Investment' && !TRANSFER_CATS.includes(c));
}
rebuildCategories();  // initial (empty until Drive loads)

function txType(t){
  if(t.ty) return t.ty;  // explicit type on new records
  if(INCOME_CATS.includes(t.c)) return 'income';
  if(t.c==='Investment') return 'invest';
  if(TRANSFER_CATS.includes(t.c)) return 'transfer';
  return 'expense';
}
// for analysis: invest_card and debt should NOT count as normal expense/income
function isRealExpense(t){ const ty=txType(t); return ty==='expense' && t.a<0; }
function isRealIncome(t){ const ty=txType(t); return ty==='income' && t.a>0; }

// ============ FORMAT ============
const fmt = n => '฿' + Math.round(n).toLocaleString('th-TH');
const fmtK = n => { const a=Math.abs(n); if(a>=1e6) return (n/1e6).toFixed(2)+'M'; if(a>=1e3) return Math.round(n/1e3)+'K'; return Math.round(n).toString(); };
const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const today = () => new Date().toISOString().slice(0,10);


// ╔══════════════════════════════════════════════════════════════════╗
// ║  SHARED NUMBERS — single source of truth                           ║
// ║  Every cross-tab figure is defined ONCE here. All tabs call these. ║
// ║  To change how a number is calculated, edit it HERE only.          ║
// ║  This prevents the same value being computed differently per tab.  ║
// ╚══════════════════════════════════════════════════════════════════╝

// 1) Total investment portfolio value (market value of all holdings, THB)
function getPortfolioValue(){
  let v=0; holdings.forEach(h=>{ v += holdingValue(h).val; }); return v;
}
// 1b) Total cost basis of all holdings (THB)
function getPortfolioCost(){
  let c=0; holdings.forEach(h=>{ c += holdingValue(h).cost; }); return c;
}
// 2) Cash sitting in investment accounts, waiting to invest (THB)
//    backward calc: money in − holdings cost, per investment wallet
function getInvestmentCash(){
  let sum=0; Object.keys(WALLET_PORTS).forEach(w=>{ sum += walletCashReserve(w); }); return sum;
}
// 3) House loan outstanding balance (THB)
function getHouseDebt(){ return accountsByType('mortgage').reduce((s,id)=>s+getDebtBalance(id),0); }
// 4) Total credit card debt (THB)
function getCardDebt(){
  return accountsByType('credit_card').reduce((sum,id)=>sum+getDebtBalance(id), 0);
}
// 5) Net worth = assets − liabilities (uses computeNetWorth for the full breakdown)
function getNetWorth(){ return computeNetWorth().networth; }
// 6) Income / expense totals for a period (year 'YYYY', month 0-11 or 'all')
function getPeriodTotals(yr, mo){
  let income=0, expense=0;
  txData.forEach(t=>{
    if(t.d.slice(0,4)!==yr) return;
    if(mo!=='all' && new Date(t.d).getMonth()!=mo) return;
    const ty=txType(t);
    if(ty==='income' && t.a>0) income+=t.a;
    else if(ty==='expense' && t.a<0) expense+=Math.abs(t.a);
  });
  return { income, expense, net: income-expense };
}

// ============ TAB NAV ============
function goTab(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelector('.tab[data-page="'+page+'"]').classList.add('active');
  window.scrollTo(0,0);
  if(page==='list') renderList();
  if(page==='analysis') renderAnalysis();
  if(page==='port') renderPort();
  if(page==='loan') renderLoan();
  if(page==='health'){ renderHealth(); renderValidation(); }
  if(page==='debt') renderDebt();
  if(page==='networth'){ initDivYear(); renderNetWorth(); renderDividends(); }
  if(page==='add'){
    // self-heal: repopulate the entry dropdowns every time you open the add tab,
    // so they're never left empty by sync timing. Cheap and safe.
    if(typeof rebuildCategories==='function') rebuildCategories();
    if(typeof rebuildDerived==='function') rebuildDerived();
    if(typeof fillWallets==='function') fillWallets();
    if(typeof fillCategories==='function') fillCategories();
    if(typeof fillDebtTargets==='function') fillDebtTargets();
  }
}

// ============ ADD FORM ============
let curType = 'expense';
function setType(type){
  curType = type;
  ['expense','income','transfer','invest','debt'].forEach(t=>{
    const el=document.getElementById('tb-'+t);
    if(el) el.className = 'type-btn' + (t===type ? ' sel-'+t : '');
  });
  // amount field: shown for expense/income/transfer/card-debt; hidden for invest (has own fields)
  // for debt, updateDebtForm() decides (card=amount, loan=principal+interest)
  document.getElementById('grp-amount').style.display = (type==='invest'||type==='debt') ? 'none' : 'block';
  document.getElementById('grp-category').style.display = (type==='expense'||type==='income') ? 'block' : 'none';
  document.getElementById('grp-wallet').style.display = (type==='expense'||type==='income') ? 'block' : 'none';
  document.getElementById('grp-transfer').style.display = (type==='transfer') ? 'block' : 'none';
  document.getElementById('grp-invest').style.display = (type==='invest') ? 'block' : 'none';
  document.getElementById('grp-debt').style.display = (type==='debt') ? 'block' : 'none';
  if(type==='expense'||type==='income') fillCategories();
  if(type==='debt'){ fillDebtTargets(); updateDebtForm(); }
}

// Refresh all UI lists after data/config loads from Drive
function refreshAfterLoad(){
  // SELF-HEAL: if META is empty (old-format data with no meta), rebuild it from transactions
  if((!META.wallets || META.wallets.length===0) && txData.length>0){
    META.wallets = [...new Set(txData.map(t=>t.w).filter(Boolean))].sort();
    console.log('Rebuilt META.wallets from transactions:', META.wallets.length);
  }
  if((!META.cats || META.cats.length===0) && txData.length>0){
    META.cats = [...new Set(txData.map(t=>t.c).filter(Boolean))].sort();
    console.log('Rebuilt META.cats from transactions:', META.cats.length);
  }
  // SELF-HEAL: if ACCOUNTS registry empty, rebuild a basic one from wallets so types work
  if((!ACCOUNTS || Object.keys(ACCOUNTS).length===0) && META.wallets.length>0){
    ACCOUNTS = {};
    META.wallets.forEach(w=>{
      let type='bank';
      if(/credit card|บัตรเครดิต/i.test(w)) type='credit_card';
      else if(/ลงทุน|หุ้น|inovestx|innovestx|แม่ทองสุข/i.test(w)) type='investment';
      else if(/กองทุน/i.test(w)) type='purchase_log';
      ACCOUNTS[w] = {type};
    });
    // add ports to known investment wallets
    if(ACCOUNTS['ลงทุนหุ้นไทย']) ACCOUNTS['ลงทุนหุ้นไทย'].ports=['thai'];
    if(ACCOUNTS['หุ้นตปท IGLOBAL+Inovestx']) ACCOUNTS['หุ้นตปท IGLOBAL+Inovestx'].ports=['us','etf'];
    if(ACCOUNTS['แม่ทองสุข']) ACCOUNTS['แม่ทองสุข'].ports=['gold'];
    console.log('Rebuilt ACCOUNTS registry from wallets:', Object.keys(ACCOUNTS).length);
  }
  rebuildCategories();
  if(typeof rebuildDerived==='function') rebuildDerived();
  if(typeof fillWallets==='function') fillWallets();
  if(typeof fillCategories==='function') fillCategories();
  if(typeof initPeriodSelectors==='function') initPeriodSelectors();
  if(typeof initDivYear==='function') initDivYear();
}

function fillCategories(){
  const sel = document.getElementById('f-category');
  let cats = curType==='income' ? INCOME_CATS : EXPENSE_CATS;
  sel.innerHTML = cats.map(c=>`<option value="${c}">${c}</option>`).join('');
}
function fillWallets(){
  const opts = META.wallets.map(w=>{const ic=accountIcon(w);return `<option value="${w}">${ic.e} ${w}</option>`;}).join('') + '<option value="__ADD__">➕ เพิ่มบัญชีใหม่...</option>';
  ['f-wallet','f-from','f-to','f-inv-wallet'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML = opts; });
  const names = [...new Set(holdings.map(h=>h.name))];
  const sl=document.getElementById('sec-list'); if(sl) sl.innerHTML = names.map(n=>`<option value="${n}">`).join('');
  fillDebtTargets();
  buildNoteSuggestions();
  // attach add-account handler
  ['f-wallet','f-from','f-to','f-inv-wallet'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.onchange=function(){ if(this.value==='__ADD__'){ addNewAccount(this); } };
  });
}
function addNewAccount(selectEl){
  const name=prompt('ชื่อบัญชีใหม่:');
  if(name && name.trim()){
    META.wallets.push(name.trim());
    META.wallets.sort();
    fillWallets();
    selectEl.value=name.trim();
  } else {
    selectEl.value=META.wallets[0];
  }
}

function updateInvCalc(){
  const units = parseFloat(document.getElementById('f-inv-units').value)||0;
  const price = parseFloat(document.getElementById('f-inv-price').value)||0;
  const ccy = document.getElementById('f-inv-ccy').value;
  const total = units*price;
  const thb = ccy==='USD' ? total*FX : total;
  const action = document.getElementById('f-inv-action').value;
  document.getElementById('inv-total-display').innerHTML =
    `มูลค่ารวม: ${ccy==='USD'?'$'+total.toFixed(2)+' ≈ ':''}${fmt(thb)} <span style="color:var(--txt3);font-size:12px">(${action==='buy'?'ซื้อ':'ขาย'})</span>`;
}

function saveTx(){
  const date = document.getElementById('f-date').value;
  const note = document.getElementById('f-note').value;
  const editIdx = parseInt(document.getElementById('edit-index').value);

  // DEBT PAYMENT
  if(curType==='debt'){
    const target = document.getElementById('f-debt-target').value;
    const from = document.getElementById('f-debt-from').value;
    const debt = DEBTS.find(d=>d.id===target);
    if(debt.type==='card'){
      // credit card: single amount, pure transfer bank -> card (clears debt)
      const amt = parseFloat(document.getElementById('f-amount').value);
      if(!amt||amt<=0){ toast('กรุณาใส่จำนวนเงิน'); return; }
      txData.unshift({ d:date, c:'Debt payment', a:-amt, w:from, n:'จ่ายบิล '+debt.name+(note?' · '+note:''), ty:'debt', debt:target });
    } else {
      // loan (house): principal + interest entered separately from the statement
      const principal = parseFloat(document.getElementById('f-principal').value)||0;
      const interest  = parseFloat(document.getElementById('f-interest').value)||0;
      if(principal<=0 && interest<=0){ toast('กรุณาใส่เงินต้นและ/หรือดอกเบี้ย'); return; }
      // interest = expense; principal = debt reduction. Tagged with prin/int for the Loan table.
      if(interest>0)
        txData.unshift({ d:date, c:'Loan interest', a:-interest, w:from, n:'ดอกเบี้ย '+debt.name, ty:'expense', debt:target, interest:interest });
      if(principal>0)
        txData.unshift({ d:date, c:'Debt payment', a:-principal, w:from, n:'เงินต้น '+debt.name+(note?' · '+note:''), ty:'debt', debt:target, principal:principal, interest:interest });
    }
    saveTxData();
    const _a=document.getElementById('f-amount'); if(_a) _a.value='';
    document.getElementById('f-note').value='';
    const _ie=document.getElementById('f-interest'); if(_ie) _ie.value='';
    const _pr=document.getElementById('f-principal'); if(_pr) _pr.value='';
    toast('บันทึกการจ่ายหนี้แล้ว ✓');
    return;
  }

  if(curType==='invest'){
    const name = document.getElementById('f-inv-name').value.trim();
    const units = parseFloat(document.getElementById('f-inv-units').value)||0;
    const price = parseFloat(document.getElementById('f-inv-price').value)||0;
    const ccy = document.getElementById('f-inv-ccy').value;
    const itype = document.getElementById('f-inv-type').value;
    const region = document.getElementById('f-inv-region').value;
    const wallet = document.getElementById('f-inv-wallet').value;
    const action = document.getElementById('f-inv-action').value;
    if(!name || units<=0 || price<=0){ toast('กรอกชื่อ จำนวนหน่วย และราคาให้ครบ'); return; }
    const thbTotal = (ccy==='USD'?units*price*FX:units*price);

    // record transaction (shows in list, negative = money used to buy)
    txData.unshift({ d:date, c:'Investment', a: action==='buy'?-thbTotal:thbTotal, w:wallet, n:(action==='buy'?'ซื้อ ':'ขาย ')+name+' '+units+'@'+price+(note?' · '+note:''), ty:'invest' });
    saveTxData();

    // update holdings
    updateHolding(name, itype, region, ccy, units, price, action, date);
    // adjust cash in that wallet
    cashBalances[wallet] = (cashBalances[wallet]||0) + (action==='buy'?-thbTotal:thbTotal);

    document.getElementById('f-inv-units').value='';
    document.getElementById('f-inv-price').value='';
    document.getElementById('f-inv-name').value='';
    document.getElementById('f-note').value='';
    updateInvCalc();
    toast('บันทึกการลงทุนแล้ว ✓');
    return;
  }

  if(curType==='transfer'){
    const amt = parseFloat(document.getElementById('f-amount').value);
    if(!amt||amt<=0){ toast('กรุณาใส่จำนวนเงิน'); return; }
    const from = document.getElementById('f-from').value;
    const to = document.getElementById('f-to').value;
    if(from===to){ toast('บัญชีต้นทาง/ปลายทางซ้ำกัน'); return; }
    // two-leg transfer
    txData.unshift({ d:date, c:'Outgoing transfer', a:-amt, w:from, n:'โอนไป '+to+(note?' · '+note:''), ty:'transfer' });
    txData.unshift({ d:date, c:'Incoming transfer', a:amt, w:to, n:'รับจาก '+from+(note?' · '+note:''), ty:'transfer' });
    // if destination is an investment account, add to its cash
    if(INVEST_WALLETS.includes(to)) cashBalances[to]=(cashBalances[to]||0)+amt;
    if(INVEST_WALLETS.includes(from)) cashBalances[from]=(cashBalances[from]||0)-amt;
    saveTxData();
    document.getElementById('f-amount').value='';
    document.getElementById('f-note').value='';
    toast('บันทึกการโอนแล้ว ✓');
    return;
  }

  // income / expense
  const amt = parseFloat(document.getElementById('f-amount').value);
  if(!amt||amt<=0){ toast('กรุณาใส่จำนวนเงิน'); return; }
  const cat = document.getElementById('f-category').value;
  const wallet = document.getElementById('f-wallet').value;
  const sign = curType==='income' ? 1 : -1;
  const rec = { d:date, c:cat, a:amt*sign, w:wallet, n:note, ty:curType };
  // VALIDATION GATE: block malformed records
  const _v = validateTx(rec);
  if(!_v.ok){ toast('❌ บันทึกไม่ได้: '+_v.msg); return; }
  if(editIdx>=0){
    txData[editIdx]=rec;
    document.getElementById('edit-index').value=-1;
    document.getElementById('cancel-edit-btn').style.display='none';
    toast('แก้ไขแล้ว ✓');
  } else {
    txData.unshift(rec);
    toast('บันทึกแล้ว ✓');
  }
  saveTxData();
  document.getElementById('f-amount').value='';
  document.getElementById('f-note').value='';
  buildNoteSuggestions();
}

function updateHolding(name, type, region, ccy, units, price, action, txDate){
  const today = txDate || document.getElementById('f-date').value || new Date().toISOString().slice(0,10);
  let h = holdings.find(x=>x.name===name && !x.lump);
  if(action==='sell'){
    if(h){ h.units -= units; h.asof = today; if(h.units<=0.0001) holdings = holdings.filter(x=>x!==h); saveHoldings(); }
    return;
  }
  if(h){
    // weighted average cost
    const totalCost = h.units*h.avgCost + units*price;
    h.units += units;
    h.avgCost = totalCost/h.units;
    if(!h.curPrice) h.curPrice = price;
    h.asof = today;  // stamp: last updated from a logged transaction
  } else {
    const port = region==='Thailand' ? (type==='Stock'||type==='REIT'?'thai':'fund') : (type==='ETF'?'etf':type==='Mutual Fund'?'fund':'us');
    holdings.push({ name, type, region, ccy, units, avgCost:price, curPrice:price, port, asof:today });
  }
  saveHoldings();
}

// ============ TRANSACTION LIST ============
let listFilter='all';
function renderListFilters(){
  const fl=[['all','ทั้งหมด'],['expense','รายจ่าย'],['income','รายได้'],['invest','ลงทุน'],['transfer','โอน'],['debt','จ่ายหนี้']];
  document.getElementById('list-filters').innerHTML = fl.map(([k,l])=>`<button class="filter-chip ${k===listFilter?'active':''}" onclick="setListFilter('${k}')">${l}</button>`).join('');
}
function setListFilter(f){ listFilter=f; renderListFilters(); renderList(); }
function renderList(){
  renderListFilters();
  renderWalletFilter();
  renderWalletSummary();
  renderSelectedWalletBalance();
  let data = listFilter==='all' ? txData : txData.filter(t=>txType(t)===listFilter);
  if(listWalletFilter && listWalletFilter!=='all') data = data.filter(t=>t.w===listWalletFilter);
  data = data.slice(0,400);
  const byDay={}; data.forEach(t=>{(byDay[t.d]=byDay[t.d]||[]).push(t);});
  const days=Object.keys(byDay).sort().reverse();
  if(!days.length){ document.getElementById('tx-list').innerHTML='<div class="empty">ไม่มีรายการ</div>'; return; }
  const colors={income:'var(--income)',expense:'var(--expense)',invest:'var(--invest)',transfer:'var(--transfer)',debt:'#fb923c',invest_card:'var(--invest)'};
  const icons={income:'↓',expense:'↑',invest:'★',transfer:'⇄',debt:'⊖',invest_card:'★'};
  let html='';
  for(const day of days){
    const items=byDay[day];
    const dt=new Date(day);
    const lbl=dt.getDate()+' '+TH_MONTHS[dt.getMonth()]+' '+(dt.getFullYear()+543);
    html+=`<div class="tx-day"><div class="tx-day-head"><span>${lbl}</span></div>`;
    for(const t of items){
      const ty=txType(t); const gi=txData.indexOf(t);
      const ic=accountIcon(t.w);
      html+=`<div class="tx" onclick="editTx(${gi})"><div class="tx-icon" style="background:${colors[ty]||'#888'}22;color:${colors[ty]||'#888'}">${icons[ty]||'•'}</div>
        <div class="tx-body"><div class="tx-cat">${t.c}</div><div class="tx-meta">${ic.e} ${t.w}${t.n?' · '+t.n:''}</div></div>
        <div class="tx-amt ${t.a>=0?'pos':'neg'}">${t.a>=0?'+':''}${fmt(t.a)}</div>
        <button class="tx-del" onclick="event.stopPropagation();delTx(${gi})">×</button></div>`;
    }
    html+='</div>';
  }
  document.getElementById('tx-list').innerHTML=html;
}
function delTx(i){ if(confirm('ลบรายการนี้?')){ txData.splice(i,1); saveTxData(); renderList(); } }
function editTx(i){
  const t=txData[i];
  const ty=txType(t);
  if(ty==='invest'||ty==='invest_card'||ty==='debt'||ty==='transfer'){ toast('รายการประเภทนี้แก้ไขไม่ได้ ลบแล้วเพิ่มใหม่'); return; }
  goTab('add');
  setType(ty==='income'?'income':'expense');
  document.getElementById('f-amount').value=Math.abs(t.a);
  fillCategories();
  document.getElementById('f-category').value=t.c;
  document.getElementById('f-wallet').value=t.w;
  document.getElementById('f-date').value=t.d;
  document.getElementById('f-note').value=t.n||'';
  document.getElementById('edit-index').value=i;
  document.getElementById('cancel-edit-btn').style.display='block';
  toast('กำลังแก้ไข — บันทึกเพื่อยืนยัน');
}
function cancelEdit(){
  document.getElementById('edit-index').value=-1;
  document.getElementById('cancel-edit-btn').style.display='none';
  document.getElementById('f-amount').value='';
  document.getElementById('f-note').value='';
  toast('ยกเลิกแล้ว');
}

// ============ ANALYSIS ============
function initPeriodSelectors(){
  const years=[...new Set(txData.map(t=>t.d.slice(0,4)))].sort().reverse();
  document.getElementById('a-year').innerHTML=years.map(y=>`<option value="${y}">${parseInt(y)+543}</option>`).join('');
  document.getElementById('a-month').innerHTML='<option value="all">ทั้งปี</option>'+TH_MONTHS.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
}
function renderAnalysis(){
  const yr=document.getElementById('a-year').value, mo=document.getElementById('a-month').value;
  let data=txData.filter(t=>t.d.slice(0,4)===yr);
  if(mo!=='all') data=data.filter(t=>new Date(t.d).getMonth()==mo);
  const expCats={},incCats={};
  for(const t of data){
    const ty=txType(t);
    if(ty==='income'){incCats[t.c]=(incCats[t.c]||0)+t.a;}
    else if(ty==='expense'){expCats[t.c]=(expCats[t.c]||0)+Math.abs(t.a);}
  }
  // totals from SHARED NUMBERS (single source of truth)
  const _pt=getPeriodTotals(yr,mo); const income=_pt.income, expense=_pt.expense, net=_pt.net;
  document.getElementById('a-income').textContent=fmt(income);
  document.getElementById('a-expense').textContent=fmt(expense);
  document.getElementById('a-net').textContent=(net>=0?'+':'')+fmt(net);
  document.getElementById('a-net').className='mv '+(net>=0?'pos':'neg');
  document.getElementById('a-rate').textContent=income>0?Math.round(net/income*100)+'%':'—';
  document.getElementById('a-expense-breakdown').innerHTML=renderBars(expCats,'var(--expense)');
  document.getElementById('a-income-breakdown').innerHTML=renderBars(incCats,'var(--income)');
  renderTrend(yr);
  renderCatDetail(yr, mo);
  renderPlanActual(yr, mo);
}
function renderBars(obj,color){
  const items=Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if(!items.length) return '<div class="empty">ไม่มีข้อมูล</div>';
  const max=items[0][1];
  return items.map(([k,v])=>`<div class="bar-row"><div class="bar-label">${k}</div><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%;background:${color}"></div></div><div class="bar-val">${fmt(v)}</div></div>`).join('');
}
let trendChart=null;
function renderTrend(yr){
  const inc=Array(12).fill(0),exp=Array(12).fill(0);
  txData.filter(t=>t.d.slice(0,4)===yr).forEach(t=>{
    const m=new Date(t.d).getMonth(),ty=txType(t);
    if(ty==='income')inc[m]+=t.a; else if(ty==='expense')exp[m]+=Math.abs(t.a);
  });
  if(trendChart)trendChart.destroy();
  trendChart=new Chart(document.getElementById('trendChart'),{type:'bar',
    data:{labels:TH_MONTHS,datasets:[{label:'รายได้',data:inc,backgroundColor:'#4ade80'},{label:'รายจ่าย',data:exp,backgroundColor:'#f87171'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0ab',font:{size:11}}}},
    scales:{x:{ticks:{color:'#6b7280',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#6b7280',font:{size:10},callback:v=>fmtK(v)},grid:{color:'#2c3140'}}}}});
}

// ============ PORTFOLIO ============
let portTab='all';
const PORT_LABELS={all:'ทั้งหมด',thai:'หุ้นไทย',us:'หุ้น US',etf:'ETF',fund:'กองทุน'};
function holdingValue(h){
  if(h.lump) return {cost:h.lumpCost, val:h.lumpValue};
  const mult = h.ccy==='USD'?FX:1;
  const price = h.curPrice || h.nav || h.avgCost;  // funds use nav, stocks use curPrice
  return {cost:h.units*h.avgCost*mult, val:h.units*price*mult};
}
function renderPortTabs(){
  document.getElementById('port-tabs').innerHTML=Object.entries(PORT_LABELS).map(([k,l])=>`<button class="port-tab ${k===portTab?'active':''}" onclick="setPortTab('${k}')">${l}</button>`).join('');
}
function setPortTab(t){ portTab=t; renderPort(); }
function renderPort(){
  renderPortTabs();
  let totalCost=0,totalVal=0;
  const byType={},byRegion={};
  holdings.forEach(h=>{
    const {cost,val}=holdingValue(h);
    totalCost+=cost; totalVal+=val;
    byType[h.type]=(byType[h.type]||0)+val;
    byRegion[h.region]=(byRegion[h.region]||0)+val;
  });
  const gain=totalVal-totalCost;
  document.getElementById('p-total').textContent=fmt(totalVal);
  document.getElementById('p-cost').textContent='ต้นทุน '+fmt(totalCost);
  document.getElementById('p-gain').textContent=(gain>=0?'+':'')+fmt(gain);
  document.getElementById('p-gain').className='mv '+(gain>=0?'pos':'neg');
  document.getElementById('p-gainpct').textContent=(gain>=0?'+':'')+(gain/totalCost*100).toFixed(1)+'%';

  document.getElementById('p-by-type').innerHTML=renderAllocBars(byType,totalVal);
  document.getElementById('p-by-region').innerHTML=renderAllocBars(byRegion,totalVal);

  // holdings list
  let list = portTab==='all'?holdings:holdings.filter(h=>h.port===portTab);
  list = list.map((h,i)=>({h, gi:holdings.indexOf(h)})).sort((a,b)=>holdingValue(b.h).val-holdingValue(a.h).val);
  document.getElementById('port-holdings').innerHTML = list.length?list.map(({h,gi})=>{
    const {cost,val}=holdingValue(h);
    const g=val-cost, pct=cost>0?(g/cost*100).toFixed(1):'0';
    const priceDisplay = h.lump ? '—' : (h.curPrice||h.avgCost).toLocaleString(undefined,{maximumFractionDigits:2});
    const asofTag = h.asof ? ` · <span style="color:var(--income)">อัพเดต ${h.asof.slice(5)}</span>` : '';
    return `<div class="holding">
      <div class="h-name">${h.name}<div style="font-size:11px;color:var(--txt3);font-weight:400">${h.type} · ${h.region}${h.lump?'':' · '+h.units+' หน่วย'}${asofTag}</div></div>
      <div class="h-val">
        <div class="h-mkt">${fmt(val)}</div>
        <div class="h-pct ${g>=0?'pos':'neg'}">${g>=0?'+':''}${pct}%</div>
        ${h.lump?'':`<div class="h-price" onclick="editPrice(${gi})">ราคา: ${priceDisplay} ✎</div>`}
      </div>
    </div>`;
  }).join('') : '<div class="empty">ไม่มีรายการ</div>';

  // cash reserve per investment wallet (backward calc: money in - holdings cost)
  const invWallets = Object.keys(WALLET_PORTS);
  const cashRows = invWallets.map(w=>({w, bal:walletCashReserve(w)})).filter(x=>Math.abs(x.bal)>1);
  document.getElementById('port-cash').innerHTML = cashRows.length?cashRows.map(({w,bal})=>{
    const ic=accountIcon(w);
    const isOv=walletOverrides[w]!==undefined;
    return `<div class="holding"><div style="display:flex;align-items:center;gap:10px;flex:1"><div class="ws-icon" style="background:${ic.c}22;color:${ic.c}">${ic.e}</div><div class="h-name">${w}${isOv?' ✎':''}</div></div><div class="h-val"><div class="h-mkt ${bal>=0?'':'neg'}">${fmt(bal)}</div></div></div>`;
  }).join('')
    : '<div class="empty" style="padding:16px">ยังไม่มีเงินสดรอลงทุน</div>';

  // per-port summary
  const ports={};
  holdings.forEach(h=>{const{cost,val}=holdingValue(h);if(!ports[h.port])ports[h.port]={c:0,v:0};ports[h.port].c+=cost;ports[h.port].v+=val;});
  document.getElementById('port-annual').innerHTML=Object.entries(ports).map(([k,o])=>{
    const g=o.v-o.c,pct=(g/o.c*100).toFixed(1);
    return `<div class="holding"><div class="h-name">${PORT_LABELS[k]||k}</div><div class="h-val"><div class="h-mkt ${g>=0?'pos':'neg'}">${g>=0?'+':''}${fmt(g)}</div><div class="h-pct ${g>=0?'pos':'neg'}">${g>=0?'+':''}${pct}%</div></div></div>`;
  }).join('');
}
function renderAllocBars(obj,total){
  const items=Object.entries(obj).sort((a,b)=>b[1]-a[1]);
  const colors=['#60a5fa','#a78bfa','#4ade80','#fbbf24','#f87171','#34d399','#f472b6'];
  return items.map(([k,v],i)=>`<div class="bar-row"><div class="bar-label">${k}</div><div class="bar-track"><div class="bar-fill" style="width:${v/total*100}%;background:${colors[i%colors.length]}"></div></div><div class="bar-val">${(v/total*100).toFixed(1)}%</div></div>`).join('');
}
function editPrice(gi){
  const h=holdings[gi];
  const cur=h.curPrice||h.avgCost;
  const np=prompt(`ราคาปัจจุบันของ ${h.name} (${h.ccy}/หน่วย)\nต้นทุนเฉลี่ย: ${h.avgCost.toFixed(2)}`, cur);
  if(np!==null){ const v=parseFloat(np); if(v>0){ h.curPrice=v; h.asof=new Date().toISOString().slice(0,10); saveHoldings(); renderPort(); toast('อัปเดตราคาแล้ว ✓'); } }
}

// ============ SYNC ============
function openSync(){ document.getElementById('sync-modal').classList.add('show'); }
function closeSync(){ document.getElementById('sync-modal').classList.remove('show'); }
function exportCSV(){
  let csv='Date,Category,Amount,Currency,Wallet,Note,Type\n';
  txData.forEach(t=>{const e=s=>'"'+String(s||'').replace(/"/g,'""')+'"';csv+=[t.d,e(t.c),t.a,'THB',e(t.w),e(t.n),t.ty||''].join(',')+'\n';});
  download(csv,'myfinance_'+today()+'.csv','text/csv'); closeSync();
}
function exportJSON(){
  download(JSON.stringify({tx:txData,holdings:holdings,cash:cashBalances}),'myfinance_backup_'+today()+'.json','application/json'); closeSync();
}
function importFile(e){
  const file=e.target.files[0]; if(!file)return;
  const r=new FileReader();
  r.onload=ev=>{try{
    const txt=ev.target.result;
    if(file.name.endsWith('.json')){
      const obj=JSON.parse(txt);
      if(obj.accounts && Object.keys(obj.accounts).length){ ACCOUNTS=obj.accounts; rebuildDerived(); }
      if(obj.loan){ LOAN=obj.loan; rebuildDerived(); }
      if(obj.meta){ if(obj.meta.cats) META.cats=obj.meta.cats; if(obj.meta.wallets) META.wallets=obj.meta.wallets; }
      if(obj.tx){ txData=obj.tx; holdings=obj.holdings||holdings; cashBalances=obj.cash||{}; }
      else if(Array.isArray(obj)){ txData=obj; }
      refreshAfterLoad();
      if(confirm('นำเข้าข้อมูลสำเร็จ? (แทนที่ของเดิม)')){ saveTxData(); saveHoldings(); toast('นำเข้าแล้ว ✓'); closeSync(); refreshAfterLoad(); renderList(); }
    } else {
      const imported=parseCSV(txt);
      if(confirm('นำเข้า '+imported.length+' รายการ?')){ txData=imported; saveTxData(); toast('นำเข้าแล้ว ✓'); closeSync(); initPeriodSelectors(); renderList(); }
    }
  }catch(err){ toast('ผิดพลาด: '+err.message); }};
  r.readAsText(file); e.target.value='';
}
function parseCSV(txt){
  const lines=txt.split(/\r?\n/).filter(l=>l.trim()); const out=[];
  for(let i=1;i<lines.length;i++){const c=splitCSV(lines[i]);if(c.length<3)continue;out.push({d:c[0],c:c[1],a:parseFloat(c[2])||0,w:c[4]||'',n:c[5]||'',ty:c[6]||undefined});}
  return out;
}
function splitCSV(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===','&&!q){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;}
function download(content,filename,type){const b=new Blob([content],{type});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=filename;a.click();URL.revokeObjectURL(u);}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}

// (init moved to end of combined script)


// ============ ACCOUNT ICONS ============
function accountIcon(name){
  const n = (name||'').toLowerCase();
  if(n.includes('credit card')||n.includes('บัตร')) return {e:'💳',c:'#f87171'};
  if(n.includes('กู้บ้าน')||n.includes('loan')) return {e:'🏠',c:'#fbbf24'};
  // กสิกร savings account (receives dividends) — is a BANK, not an investment port
  if(n.includes('กสิกร')) return {e:'🏦',c:'#4ade80'};
  // actual investment ports
  if(n.includes('iglobal')||n.includes('inovestx')||n.includes('ลงทุนหุ้นไทย')||n.includes('แม่ทองสุข')||n.includes('กองทุน')||n.includes('ลงทุนอื่น')) return {e:'📈',c:'#60a5fa'};
  if(n.includes('ฉุกเฉิน')||n.includes('travel')||n.includes('ภาษี')||n.includes('ประกัน')) return {e:'🎯',c:'#a78bfa'};
  if(n.includes('dime')||n.includes('uob')||n.includes('bbl')||n.includes('kbank')||n.includes('ไทยพานิช')||n.includes('kt ')||n.includes('ttb')||n.includes('e-kbank')) return {e:'🏦',c:'#4ade80'};
  return {e:'💵',c:'#9aa0ab'};
}

// ============ DEBT DEFINITIONS ============
let DEBTS = (function(){  // derived from ACCOUNTS registry
  const out = [];
  accountsByType('credit_card').forEach(id=>out.push({id, name:ACCOUNTS[id].name||id, type:'card'}));
  accountsByType('mortgage').forEach(id=>out.push({id, name:ACCOUNTS[id].name||id, type:'loan'}));
  return out;
})();

// Default cut-point for the mortgage baseline (editable in the Debt tab)
let MORTGAGE_BASE_DATE = localStorage.getItem('myfinance_mortgage_base_date') || '2026-06-01';
function setMortgageBaseDate(d){
  MORTGAGE_BASE_DATE = d;
  localStorage.setItem('myfinance_mortgage_base_date', d);
  accountsByType('mortgage').forEach(id=>{
    if(!ACCOUNTS[id].baseline) ACCOUNTS[id].baseline = {};
    ACCOUNTS[id].baseline.date = d;
    if(typeof ACCOUNTS[id].baseline.amount!=='number') ACCOUNTS[id].baseline.amount = LAST_ACTUAL.balance;
  });
  if(typeof markLocalChange==='function') markLocalChange();
  renderDebt(); renderNetWorth();
}
function setMortgageBaseAmount(amt){
  const v = parseFloat(amt); if(isNaN(v)) return;
  accountsByType('mortgage').forEach(id=>{
    if(!ACCOUNTS[id].baseline) ACCOUNTS[id].baseline = {};
    ACCOUNTS[id].baseline.amount = v;
    if(!ACCOUNTS[id].baseline.date) ACCOUNTS[id].baseline.date = MORTGAGE_BASE_DATE;
  });
  if(typeof markLocalChange==='function') markLocalChange();
  renderDebt(); renderNetWorth();
}

function getDebtBalance(debtId){
  // ── MORTGAGE: dated-baseline model (same pattern as credit cards) ──
  // balance = baseline balance − principal repaid AFTER the baseline date
  if(accountType(debtId)==='mortgage'){
    const acc = ACCOUNTS[debtId] || {};
    const base = acc.baseline || {};
    const baseAmount = (typeof base.amount==='number') ? base.amount : LAST_ACTUAL.balance;
    const baseDate = base.date || MORTGAGE_BASE_DATE;
    let principalPaid = 0;
    txData.forEach(t=>{
      if(t.ty==='debt' && t.debt===debtId && t.d > baseDate) principalPaid += Math.abs(t.a);
    });
    return Math.max(0, baseAmount - principalPaid);
  }
  // Credit card dated-baseline model:
  // balance = baseline debt (read from bank app) + new charges AFTER baseline date - payments AFTER baseline date
  // Pre-baseline transactions stay as records but don't affect debt (already settled).
  const cb = cardBalances[debtId];
  const baseAmount = (cb && typeof cb==='object') ? cb.amount : (cb||0);
  const baseDate = (cb && typeof cb==='object') ? cb.date : '2026-06-08';
  let charges=0, payments=0;
  txData.forEach(t=>{
    if(t.d <= baseDate) return; // on/before baseline = settled, skip
    if(t.w===debtId && t.a<0) charges += -t.a;     // new charges after baseline
    if(t.debt===debtId) payments += -t.a;           // payments after baseline (a is negative)
  });
  return baseAmount + charges - payments;
}

function fillDebtTargets(){
  const sel=document.getElementById('f-debt-target');
  if(sel) sel.innerHTML = DEBTS.map(d=>`<option value="${d.id}">${d.name}</option>`).join('');
  const fromSel=document.getElementById('f-debt-from');
  if(fromSel) fromSel.innerHTML = META.wallets.filter(w=>!w.includes('Credit Card')).map(w=>`<option value="${w}">${w}</option>`).join('');
}

function updateDebtForm(){
  const target=document.getElementById('f-debt-target').value;
  const debt=DEBTS.find(d=>d.id===target);
  const bal=getDebtBalance(target);
  const info=document.getElementById('debt-split-info');
  const loanFields=document.getElementById('loan-fields');
  const amtGrp=document.getElementById('grp-amount');

  if(!debt){ if(info) info.innerHTML=''; return; }

  if(debt.type==='card'){
    // credit card: single amount field, no principal/interest split
    if(loanFields) loanFields.style.display='none';
    if(amtGrp) amtGrp.style.display='block';
    info.innerHTML=`<div class="debt-bal">ยอดค้างปัจจุบัน: <b>${fmt(bal)}</b></div><div class="debt-note">บัตรเครดิต = โอนล้างหนี้ทั้งหมด (ไม่มีดอกเบี้ยถ้าจ่ายเต็ม)</div>`;
  } else {
    // loan (house): principal + interest fields; hide the single amount field
    if(loanFields) loanFields.style.display='block';
    if(amtGrp) amtGrp.style.display='none';
    const principal=parseFloat(document.getElementById('f-principal').value)||0;
    const interest=parseFloat(document.getElementById('f-interest').value)||0;
    const total=principal+interest;
    const prev=document.getElementById('loan-total-preview');
    if(prev) prev.textContent=fmt(total);
    const newBal = bal - principal;
    info.innerHTML=`<div class="debt-bal">ยอดหนี้คงเหลือ: <b>${fmt(bal)}</b></div>`+
      (total>0?`<div class="debt-note">หลังจ่ายงวดนี้: เงินต้น ${fmt(principal)} → หนี้เหลือ <b>${fmt(newBal)}</b> · ดอกเบี้ย ${fmt(interest)} (บันทึกเป็นค่าใช้จ่าย)</div>`:
      `<div class="debt-note">ใส่เงินต้นและดอกเบี้ยจากใบแจ้งหนี้</div>`);
  }
}

// ============ DEBT PAGE ============
function renderDebt(){
  let total=0;
  const items=DEBTS.map(d=>{
    const bal=getDebtBalance(d.id);
    total+=bal;
    return {...d, bal};
  });
  document.getElementById('debt-total').textContent=fmt(total);
  document.getElementById('debt-count').textContent=items.filter(i=>i.bal>0).length+' รายการที่มียอดค้าง';
  document.getElementById('debt-list').innerHTML=items.map(d=>{
    const ic=accountIcon(d.id);
    return `<div class="holding"><div style="display:flex;align-items:center;gap:10px;flex:1">
      <div class="acc-icon" style="background:${ic.c}22;color:${ic.c}">${ic.e}</div>
      <div class="h-name">${d.name}<div style="font-size:11px;color:var(--txt3);font-weight:400">${d.type==='card'?'บัตรเครดิต':'สินเชื่อ'}</div></div></div>
      <div class="h-val"><div class="h-mkt ${d.bal>0?'neg':''}">${fmt(d.bal)}</div></div></div>`;
  }).join('');
  const scbB=cardBalances['Credit Card SCB']; const sb=document.getElementById('bal-scb');
  if(sb) sb.value=(scbB&&typeof scbB==='object')?scbB.amount:(scbB||0);
  const ktcB=cardBalances['Credit Card KTC']; const kb=document.getElementById('bal-ktc');
  if(kb) kb.value=(ktcB&&typeof ktcB==='object')?ktcB.amount:(ktcB||0);
  const sd=document.getElementById('bal-scb-date'); if(sd) sd.value=(scbB&&typeof scbB==='object')?scbB.date:today();
  const kd=document.getElementById('bal-ktc-date'); if(kd) kd.value=(ktcB&&typeof ktcB==='object')?ktcB.date:today();
  // mortgage baseline fields
  const mId = accountsByType('mortgage')[0];
  if(mId){
    const mb = (ACCOUNTS[mId] && ACCOUNTS[mId].baseline) || {};
    const hb=document.getElementById('bal-house');
    if(hb) hb.value = (typeof mb.amount==='number') ? mb.amount : Math.round(LAST_ACTUAL.balance);
    const hd=document.getElementById('bal-house-date');
    if(hd) hd.value = mb.date || MORTGAGE_BASE_DATE;
  }
}
function adjustCardBalance(card,val){
  const dateId = card==='Credit Card SCB' ? 'bal-scb-date' : 'bal-ktc-date';
  const dateEl = document.getElementById(dateId);
  const date = (dateEl && dateEl.value) ? dateEl.value : today();
  cardBalances[card]={amount:parseFloat(val)||0, date:date};
  localStorage.setItem('myfinance_cardbal_v2',JSON.stringify(cardBalances));
  renderDebt();
}
function adjustCardDate(card,dateVal){
  const cur=cardBalances[card];
  const amount=(cur&&typeof cur==='object')?cur.amount:(cur||0);
  cardBalances[card]={amount:amount, date:dateVal||today()};
  localStorage.setItem('myfinance_cardbal_v2',JSON.stringify(cardBalances));
  renderDebt();
}

// ============ AUTOSUGGEST NOTES ============
function buildNoteSuggestions(){
  const counts={};
  txData.forEach(t=>{ if(t.n && t.n.length>1){ counts[t.n]=(counts[t.n]||0)+1; } });
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,80).map(([n])=>n);
  const dl=document.getElementById('note-list');
  if(dl) dl.innerHTML=top.map(n=>`<option value="${n.replace(/"/g,'&quot;')}">`).join('');
}

// ============ WALLET FILTER (transaction list) ============
let listWalletFilter = 'all';
function renderWalletFilter(){
  const el = document.getElementById('list-wallet-filter');
  if(!el) return;
  const walletsInUse = [...new Set(txData.map(t=>t.w).filter(Boolean))];
  walletsInUse.sort();
  el.innerHTML = '<option value="all">ทุกบัญชี</option>' +
    walletsInUse.map(w=>{const ic=accountIcon(w);return `<option value="${w}">${ic.e} ${w}</option>`;}).join('');
  el.value = listWalletFilter;
}
function setListWalletFilter(v){ listWalletFilter = v; renderList(); }

// ============ NET WORTH DASHBOARD ============
const LS_NW = 'myfinance_networth_v1';
let nwInputs = { condo: 0, cashManual: 0, useManualCash: false };
let nwHistory = [];  // [{date, networth}]

function loadNW(){
  const s = localStorage.getItem(LS_NW);
  if(s){ const o=JSON.parse(s); nwInputs=o.inputs||nwInputs; nwHistory=o.history||[]; }
}
function saveNW(){ localStorage.setItem(LS_NW, JSON.stringify({inputs:nwInputs, history:nwHistory})); }

function computeNetWorth(){
  // NOTE: this is the breakdown hub. The SHARED NUMBERS functions wrap these
  // individual pieces. We compute inline here (can't call getInvestmentCash etc.
  // without recursion via getNetWorth), but the formulas match exactly.
  let portVal = 0;
  holdings.forEach(h=>{ portVal += holdingValue(h).val; });
  let investCash = 0;
  Object.keys(WALLET_PORTS).forEach(w=>{ investCash += walletCashReserve(w); });
  const cash = nwInputs.useManualCash ? nwInputs.cashManual : (nwInputs.cashManual||0);
  const condo = nwInputs.condo||0;
  let cardDebt = 0;
  accountsByType('credit_card').forEach(c=>{ cardDebt += getDebtBalance(c); });
  const houseDebt = getDebtBalance('House KTB');
  const assets = portVal + cash + condo + investCash;
  const liabilities = cardDebt + houseDebt;
  return { portVal, cash, condo, investCash, cardDebt, houseDebt, assets, liabilities, networth: assets-liabilities };
}

function renderNetWorth(){
  const nw = computeNetWorth();
  document.getElementById('nw-total').textContent = fmt(nw.networth);
  document.getElementById('nw-assets').textContent = fmt(nw.assets);
  document.getElementById('nw-liab').textContent = fmt(nw.liabilities);
  autoSnapshotNW(nw.networth);
  // delta vs previous snapshot
  const dEl=document.getElementById('nw-delta');
  if(dEl){
    if(nwHistory.length>=1){
      const prev=nwHistory[nwHistory.length-1];
      const curMonth=today().slice(0,7);
      let base=null;
      if(prev.month===curMonth && nwHistory.length>=2) base=nwHistory[nwHistory.length-2];
      else if(prev.month!==curMonth) base=prev;
      if(base){
        const delta=nw.networth-base.networth;
        const pct=base.networth!==0?(delta/Math.abs(base.networth)*100):0;
        dEl.innerHTML=`<span class="${delta>=0?'pos':'neg'}">${delta>=0?'▲ +':'▼ '}${fmt(delta)} (${delta>=0?'+':''}${pct.toFixed(1)}%)</span> <span style="color:var(--txt3);font-size:12px">จากเดือนก่อน</span>`;
      } else dEl.innerHTML='<span style="color:var(--txt3);font-size:12px">เดือนแรกที่บันทึก</span>';
    } else dEl.innerHTML='';
  }

  // asset breakdown
  const assetRows = [
    {label:'💵 เงินสด/เงินฝาก', val:nw.cash, editable:true, id:'nw-cash-input'},
    {label:'📈 พอร์ตลงทุน', val:nw.portVal},
    {label:'📈 เงินสดรอลงทุน', val:nw.investCash},
    {label:'🏠 คอนโด (มูลค่าตลาด)', val:nw.condo, editable:true, id:'nw-condo-input'},
  ];
  document.getElementById('nw-asset-list').innerHTML = assetRows.map(r=>{
    return `<div class="nw-row"><span class="nw-label">${r.label}</span><span class="nw-val pos">${fmt(r.val)}</span></div>`;
  }).join('');

  const liabRows = [
    {label:'🏠 สินเชื่อบ้าน KTB', val:nw.houseDebt},
    {label:'💳 บัตรเครดิต', val:nw.cardDebt},
  ];
  document.getElementById('nw-liab-list').innerHTML = liabRows.map(r=>
    `<div class="nw-row"><span class="nw-label">${r.label}</span><span class="nw-val neg">−${fmt(r.val)}</span></div>`).join('');

  // sync input fields
  const ci=document.getElementById('nw-condo'); if(ci) ci.value = nwInputs.condo||0;
  const cs=document.getElementById('nw-cash'); if(cs) cs.value = nwInputs.cashManual||0;

  renderNWChart();
}
function updateNWInput(){
  nwInputs.condo = parseFloat(document.getElementById('nw-condo').value)||0;
  nwInputs.cashManual = parseFloat(document.getElementById('nw-cash').value)||0;
  saveNW();
  renderNetWorth();
}
function autoSnapshotNW(networth){
  // auto-record once per month on first open
  const month=today().slice(0,7);
  const exists=nwHistory.find(h=>h.month===month);
  if(!exists){
    nwHistory.push({month, networth:Math.round(networth)});
    nwHistory.sort((a,b)=>a.month.localeCompare(b.month));
    saveNW();
  }
}
function snapshotNW(){
  const nw = computeNetWorth();
  const month = today().slice(0,7);
  // replace if same month exists
  nwHistory = nwHistory.filter(h=>h.month!==month);
  nwHistory.push({month, networth:Math.round(nw.networth)});
  nwHistory.sort((a,b)=>a.month.localeCompare(b.month));
  saveNW();
  renderNWChart();
  toast('บันทึก snapshot เดือนนี้แล้ว ✓');
}
let nwChart=null;
function renderNWChart(){
  const cv=document.getElementById('nwChart');
  if(!cv) return;
  if(nwHistory.length===0){
    cv.parentElement.innerHTML='<div class="empty">ยังไม่มีประวัติ<br><span style="font-size:11px">กดปุ่ม "บันทึก snapshot" เพื่อเริ่มเก็บแนวโน้มความมั่งคั่งรายเดือน</span></div>';
    return;
  }
  if(nwChart)nwChart.destroy();
  const labels=nwHistory.map(h=>{const[y,m]=h.month.split('-');return TH_MONTHS[parseInt(m)-1]+' '+(parseInt(y)+543).toString().slice(2);});
  nwChart=new Chart(cv,{type:'line',
    data:{labels,datasets:[{label:'Net Worth',data:nwHistory.map(h=>h.networth),borderColor:'#4ade80',backgroundColor:'rgba(74,222,128,0.1)',borderWidth:2,fill:true,tension:0.3,pointRadius:3,pointBackgroundColor:'#4ade80'}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:'#6b7280',font:{size:10}},grid:{display:false}},y:{ticks:{color:'#6b7280',font:{size:10},callback:v=>fmtK(v)},grid:{color:'#2c3140'}}}}});
}


// ============ LOAN MODULE ============
// LOAN is PERSONAL CONFIG — loaded from your private data (Drive), not hardcoded here.
let LOAN = (typeof LOAN_SEED !== 'undefined' && LOAN_SEED) ? LOAN_SEED : {vongern:0, actualPayments:[]};
let LAST_ACTUAL = (LOAN.actualPayments && LOAN.actualPayments.length) ? LOAN.actualPayments[LOAN.actualPayments.length-1] : {p:0,balance:0,rate:0,principal:0,interest:0,total:0};

function getRates(){
  return {
    r1: parseFloat(document.getElementById('rate-1').value)/100 || 0.025,
    r2: parseFloat(document.getElementById('rate-2').value)/100 || 0.057
  };
}

// Simulate from current balance forward
function simulateLoan(monthlyPayment){
  const {r1,r2} = getRates();
  let bal = (typeof getHouseDebt==='function') ? getHouseDebt() : LAST_ACTUAL.balance;  // live balance
  const logged = (typeof getLoggedLoanPayments==='function') ? getLoggedLoanPayments().length : 0;
  let period = LAST_ACTUAL.p + logged + 1;
  let totalInterest = 0;
  const schedule = [];
  while(bal > 0.01 && period <= 360){
    const rate = period <= 24 ? r1 : r2;
    const monthlyInt = bal * rate / 12;
    let principal = monthlyPayment - monthlyInt;
    if(principal <= 0) return {payoffPeriod:null, totalInterest:Infinity, schedule:[]};
    if(principal > bal) principal = bal;
    const pay = principal + monthlyInt;
    bal -= principal;
    totalInterest += monthlyInt;
    schedule.push({p:period, rate:rate*100, principal, interest:monthlyInt, total:pay, balance:Math.max(0,bal)});
    period++;
  }
  return {payoffPeriod: period-1, totalInterest, schedule};
}

function recalcLoan(){ runSim(); renderAmort(); renderLoanVsInvest(); }

function runSim(){
  const pay = parseFloat(document.getElementById('sim-payment').value) || 56300;
  const sim = simulateLoan(pay);
  const remaining = sim.payoffPeriod ? sim.payoffPeriod - 17 : null;
  let html = '';
  if(sim.payoffPeriod){
    html = `
      <div class="sim-box"><div class="sl">ผ่อนหมดอีก</div><div class="sv">${remaining} งวด</div><div class="sl">(${(remaining/12).toFixed(1)} ปี)</div></div>
      <div class="sim-box"><div class="sl">ดอกเบี้ยที่เหลือ</div><div class="sv neg">฿${Math.round(sim.totalInterest).toLocaleString()}</div></div>`;
  } else {
    html = `<div class="sim-box" style="grid-column:1/3"><div class="sv neg">ผ่อนไม่หมด!</div><div class="sl">เงินงวดน้อยกว่าดอกเบี้ย ต้องเพิ่มขึ้น</div></div>`;
  }
  document.getElementById('sim-result').innerHTML = html;
  renderAmort(sim.schedule);
}

// Pull your REAL logged house-loan payments (after the statement history),
// pairing each principal payment with its interest (same date).
function getLoggedLoanPayments(){
  const mortgageIds = accountsByType('mortgage');
  const baseDate = MORTGAGE_BASE_DATE;
  // principal rows (ty='debt' with a mortgage debt id), after baseline date
  const prinRows = txData.filter(t=> t.ty==='debt' && mortgageIds.includes(t.debt) && t.d > baseDate);
  return prinRows.map(t=>{
    const principal = t.principal || Math.abs(t.a);
    // find the matching interest row (same date, Loan interest) if interest not tagged
    let interest = t.interest || 0;
    if(!interest){
      const intRow = txData.find(x=> x.c==='Loan interest' && x.d===t.d && mortgageIds.includes(x.debt));
      if(intRow) interest = Math.abs(intRow.a);
    }
    return { date:t.d, principal, interest };
  }).sort((a,b)=> a.date < b.date ? -1 : 1);
}

function renderAmort(estSchedule){
  if(!estSchedule){
    const pay = parseFloat(document.getElementById('sim-payment').value) || 56300;
    estSchedule = simulateLoan(pay).schedule;
  }
  const fmt0 = n => Math.round(n).toLocaleString();
  let rows = '<tr><th>งวด</th><th>วันที่</th><th>ดอกเบี้ย%</th><th>เงินต้น</th><th>ดอกเบี้ย</th><th>ยอดชำระ</th><th>คงเหลือ</th></tr>';

  // 1) statement history (the 17 periods from the bank) — kept as-is
  let lastBal = 0, lastP = 0;
  for(const p of LOAN.actualPayments){
    rows += `<tr class="actual"><td>${p.p}</td><td>-</td><td>${p.rate.toFixed(2)}%</td><td>${fmt0(p.principal)}</td><td>${fmt0(p.interest)}</td><td>${fmt0(p.total)}</td><td>${fmt0(p.balance)}</td></tr>`;
    lastBal = p.balance; lastP = p.p;
  }

  // 2) YOUR real logged payments after the statement — appended, table grows as you pay
  const realPays = getLoggedLoanPayments();
  for(const rp of realPays){
    lastP += 1;
    lastBal = lastBal - rp.principal;
    const ratePct = rp.interest>0 && lastBal>0 ? (rp.interest*12/(lastBal+rp.principal)*100) : 0;
    rows += `<tr class="actual" style="background:rgba(80,200,120,0.08)"><td>${lastP} ✓</td><td>${rp.date.slice(5)}</td><td>${ratePct?ratePct.toFixed(2)+'%':'-'}</td><td>${fmt0(rp.principal)}</td><td>${fmt0(rp.interest)}</td><td>${fmt0(rp.principal+rp.interest)}</td><td>${fmt0(lastBal)}</td></tr>`;
  }

  // 3) estimated future schedule (simulator projection)
  let prevRate = 2.50;
  for(const p of estSchedule){
    const rateChanged = p.rate !== prevRate;
    rows += `<tr class="estimate ${rateChanged?'rate-change':''}"><td>${p.p}</td><td>-</td><td>${p.rate.toFixed(2)}%</td><td>${fmt0(p.principal)}</td><td>${fmt0(p.interest)}</td><td>${fmt0(p.total)}</td><td>${fmt0(p.balance)}</td></tr>`;
    prevRate = p.rate;
  }
  document.getElementById('amort-table').innerHTML = rows;
}

function renderLoanVsInvest(){
  const {r2} = getRates();
  const loanRate = r2*100;
  const balance = (typeof getHouseDebt==='function') ? getHouseDebt() : LAST_ACTUAL.balance;
  const items = [
    {label:'ดอกเบี้ยหนี้คอนโด (หลังงวด 25)', val:loanRate.toFixed(1)+'%', desc:'ผลตอบแทน "การันตี" จากการโปะ', color:'var(--expense)'},
    {label:'Dividend yield หุ้นปัจจุบัน', val:'5-7%', desc:'มีความเสี่ยง แต่ได้ปันผลสม่ำเสมอ', color:'var(--transfer)'},
    {label:'เป้าผลตอบแทนลงทุน', val:'7-15%', desc:'ถ้าทำได้ จะชนะดอกเบี้ยหนี้', color:'var(--income)'},
  ];
  let html = items.map(i=>`
    <div class="holding">
      <div class="h-name" style="font-size:13px">${i.label}<div style="font-size:11px;color:var(--txt3);font-weight:400">${i.desc}</div></div>
      <div class="h-val"><div class="h-mkt" style="color:${i.color}">${i.val}</div></div>
    </div>`).join('');
  html += `<p class="help-text" style="margin-top:12px">💡 ถ้าดอกเบี้ยหนี้ (${loanRate.toFixed(1)}%) สูงกว่าผลตอบแทนลงทุนที่มั่นใจได้ → โปะหนี้คุ้มกว่า (เพราะ risk-free) แต่ถ้ามั่นใจว่าลงทุนได้เกิน ${loanRate.toFixed(1)}% → ลงทุนต่อได้</p>`;
  document.getElementById('loan-vs-invest').innerHTML = html;
}

function renderLoan(){
  if(!LOAN.actualPayments || !LOAN.actualPayments.length) return;  // no loan config yet (before Drive login)
  // Use the DYNAMIC balance (statement baseline − principal you've logged since),
  // so this matches the Debt tab exactly. getHouseDebt() is the single source of truth.
  const liveBalance = getHouseDebt();
  document.getElementById('l-balance').textContent = fmt(liveBalance);
  document.getElementById('l-progress').textContent = 'ลดเงินต้นแล้ว '+((LOAN.vongern-liveBalance)/LOAN.vongern*100).toFixed(1)+'%';
  // "paid" = statement history + your logged real payments
  const logged = getLoggedLoanPayments();
  const loggedPrin = logged.reduce((s,p)=>s+p.principal,0);
  const loggedInt = logged.reduce((s,p)=>s+p.interest,0);
  const totalPaid = LOAN.actualPayments.reduce((s,p)=>s+p.total,0) + loggedPrin + loggedInt;
  const totalPrin = LOAN.actualPayments.reduce((s,p)=>s+p.principal,0) + loggedPrin;
  const totalInt = LOAN.actualPayments.reduce((s,p)=>s+p.interest,0) + loggedInt;
  document.getElementById('l-paid').textContent = fmt(totalPaid);
  document.getElementById('l-paidbreak').textContent = 'เงินต้น '+fmt(totalPrin)+' · ดอก '+fmt(totalInt);
  runSim();
  renderLoanVsInvest();
}

// ============ HEALTH / FINANCIAL RATIOS ============
function renderHealth(){
  const liquid = parseFloat(document.getElementById('h-liquid').value)||0;
  const income = parseFloat(document.getElementById('h-income').value)||1;
  const expense = parseFloat(document.getElementById('h-expense').value)||0;
  const essential = parseFloat(document.getElementById('h-essential').value)||1;
  const debtPay = parseFloat(document.getElementById('h-debt-pay').value)||0;

  // Total assets & liabilities — use SHARED NUMBERS (single source of truth)
  const portMkt = getPortfolioValue();
  const totalAssets = portMkt + liquid; // + condo value would add here
  const totalLiab = getHouseDebt() + getCardDebt();  // dynamic house debt + cards
  const netWorth = totalAssets - totalLiab;

  const annualIncome = income*12;
  const savings = income - expense - debtPay;

  // Define ratios with standard benchmarks
  const ratios = [
    {
      name:'Savings Rate (อัตราการออม)',
      formula:'(รายได้ − รายจ่าย − ผ่อนหนี้) ÷ รายได้',
      value: savings/income*100, unit:'%',
      bands:[[20,'good','≥20% = super saver'],[15,'ok','15-20% = ดี'],[0,'bad','<15% = ควรเพิ่ม']],
      target:'เป้า ≥ 15-20%', higherBetter:true, max:50
    },
    {
      name:'Emergency Fund Ratio (เงินสำรองฉุกเฉิน)',
      formula:'เงินสด ÷ รายจ่ายจำเป็น/เดือน',
      value: liquid/essential, unit:' เดือน',
      bands:[[6,'good','≥6 เดือน = แข็งแกร่ง'],[3,'ok','3-6 เดือน = พอใช้'],[0,'bad','<3 เดือน = เสี่ยง']],
      target:'เป้า 3-6 เดือน', higherBetter:true, max:12
    },
    {
      name:'Liquidity Ratio (สภาพคล่อง)',
      formula:'สินทรัพย์สภาพคล่อง ÷ รายจ่ายรวม/เดือน',
      value: liquid/expense, unit:' เดือน',
      bands:[[6,'good','≥6 = คล่องตัวสูง'],[3,'ok','3-6 = พอใช้'],[0,'bad','<3 = ตึง']],
      target:'เป้า ≥ 3-6 เดือน', higherBetter:true, max:12
    },
    {
      name:'Debt-to-Income (DTI) (ภาระหนี้ต่อรายได้)',
      formula:'ค่าผ่อนหนี้/เดือน ÷ รายได้/เดือน',
      value: debtPay/income*100, unit:'%',
      bands:[[36,'bad','>36% = สูงเกิน'],[28,'ok','28-36% = พอรับได้'],[0,'good','<28% = ดีมาก']],
      target:'เป้า < 36% (ดีสุด <28%)', higherBetter:false, max:60, reverseBar:true
    },
    {
      name:'Debt-to-Asset (หนี้ต่อสินทรัพย์)',
      formula:'หนี้รวม ÷ สินทรัพย์รวม',
      value: totalLiab/totalAssets*100, unit:'%',
      bands:[[100,'bad','>100% = หนี้ท่วม'],[50,'ok','50-100% = พอรับได้'],[0,'good','<50% = แข็งแรง']],
      target:'เป้า < 50%', higherBetter:false, max:120, reverseBar:true
    },
    {
      name:'Net Worth-to-Income (ความมั่งคั่งต่อรายได้)',
      formula:'ความมั่งคั่งสุทธิ ÷ รายได้ต่อปี',
      value: netWorth/annualIncome, unit:'x',
      bands:[[3,'good','≥3x = สะสมได้ดี'],[1,'ok','1-3x = กำลังสร้าง'],[0,'bad','<1x = เริ่มต้น']],
      target:'เป้าโตตามอายุ (เช่น อายุ×รายได้÷10)', higherBetter:true, max:6
    },
    {
      name:'Investment-to-Net-Worth (สัดส่วนเงินลงทุน)',
      formula:'มูลค่าพอร์ตลงทุน ÷ ความมั่งคั่งสุทธิ',
      value: portMkt/netWorth*100, unit:'%',
      bands:[[50,'good','≥50% = เงินทำงานหนัก'],[25,'ok','25-50% = ใช้ได้'],[0,'bad','<25% = น้อยไป']],
      target:'เป้า ≥ 50% (เงินงอกเงย)', higherBetter:true, max:100
    },
  ];

  // Calculate overall score (0-100)
  let totalScore = 0;
  const scored = ratios.map(r=>{
    let status, statusText;
    for(const [threshold, st, txt] of r.bands){
      if(r.higherBetter ? r.value >= threshold : r.value <= threshold){
        status = st; statusText = txt; break;
      }
    }
    if(!status){ const last = r.bands[r.bands.length-1]; status=last[1]; statusText=last[2]; }
    const pts = status==='good'?100 : status==='ok'?65 : 30;
    totalScore += pts;
    return {...r, status, statusText};
  });
  const avgScore = Math.round(totalScore/ratios.length);
  document.getElementById('h-score').textContent = avgScore;
  const grade = avgScore>=85?'A':avgScore>=70?'B':avgScore>=55?'C':avgScore>=40?'D':'F';
  const gradeColor = avgScore>=70?'var(--income)':avgScore>=55?'var(--transfer)':'var(--expense)';
  const gEl = document.getElementById('h-grade'); gEl.textContent=grade; gEl.style.color=gradeColor;
  document.getElementById('h-score').style.color = gradeColor;

  // Render ratio cards
  const statusColors = {good:'var(--income)',ok:'var(--transfer)',bad:'var(--expense)'};
  const statusLabels = {good:'ดี',ok:'พอใช้',bad:'ควรปรับปรุง'};
  document.getElementById('ratios-list').innerHTML = scored.map(r=>{
    const color = statusColors[r.status];
    let barW = Math.min(100, Math.abs(r.value)/r.max*100);
    const valStr = (r.unit==='x'||r.unit===' เดือน') ? r.value.toFixed(1)+r.unit : r.value.toFixed(1)+r.unit;
    return `<div class="ratio-card">
      <div class="ratio-head">
        <div><div class="ratio-name">${r.name}</div><div class="ratio-formula">${r.formula}</div></div>
        <div class="ratio-value" style="color:${color}">${valStr}</div>
      </div>
      <div class="ratio-bar"><div class="ratio-bar-fill" style="width:${barW}%;background:${color}"></div></div>
      <div class="ratio-status status-${r.status}"><span class="status-dot" style="background:${color}"></span>${statusLabels[r.status]} — ${r.statusText}</div>
      <div class="ratio-target">${r.target}</div>
    </div>`;
  }).join('');
}



// ============ WALLET BALANCES (computed from full history) ============
// Maps investment wallets to the holdings ports they fund
let WALLET_PORTS = (function(){  // derived from ACCOUNTS registry
  const wp = {};
  accountsByType('investment').forEach(name=>{ const p=accountPorts(name); if(p.length) wp[name]=p; });
  return wp;
})();
// wallets that are pure purchase-logs (no cash reserve, no running balance shown)
let PURCHASE_LOG_WALLETS = accountsByType('purchase_log');  // derived from ACCOUNTS registry
let walletOverrides = {}; // manual balance corrections per wallet

function loadWalletOverrides(){
  const s=localStorage.getItem('myfinance_wallet_override_v2');
  walletOverrides = s ? JSON.parse(s) : (META.walletOverridesSeed||{});
}
function saveWalletOverrides(){ localStorage.setItem('myfinance_wallet_override_v2',JSON.stringify(walletOverrides)); }

// raw running balance = sum of all transactions for that wallet
function walletRawBalance(wallet){
  let bal=0;
  txData.forEach(t=>{ if(t.w===wallet) bal+=t.a; });
  return bal;
}

// holdings cost basis for an investment wallet
function walletHoldingsCost(wallet){
  const ports = WALLET_PORTS[wallet];
  if(!ports) return 0;
  let cost=0;
  holdings.forEach(h=>{ if(ports.includes(h.port)) cost += holdingValue(h).cost; });
  return cost;
}

// override = dated baseline {amount, date}: balance = amount + sum(tx after date)
function overrideBalance(wallet){
  const ov = walletOverrides[wallet];
  if(ov===undefined) return null;
  // backward compat: if override is a plain number, treat as amount with no date (frozen)
  if(typeof ov==='number') return ov;
  let sum = ov.amount;
  txData.forEach(t=>{ if(t.w===wallet && t.d > ov.date) sum += t.a; });
  return sum;
}

// cash reserve for an investment wallet = net money in - holdings deployed
function walletCashReserve(wallet){
  if(walletOverrides[wallet]!==undefined) return overrideBalance(wallet);
  const ports = WALLET_PORTS[wallet];
  if(ports){
    // backward: money in (net) - holdings cost
    let inflow=0, outflow=0;
    txData.forEach(t=>{ if(t.w===wallet){ if(t.a>0) inflow+=t.a; else outflow+=-t.a; } });
    return inflow - outflow - walletHoldingsCost(wallet);
  }
  // non-investment wallet = raw running balance
  return walletRawBalance(wallet);
}

// full balance for ANY wallet (for the list-tab summary)
function walletBalance(wallet){
  if(walletOverrides[wallet]!==undefined) return overrideBalance(wallet);
  if(PURCHASE_LOG_WALLETS.includes(wallet)) return null; // purchase log = no balance concept
  // credit card = show the ACTUAL debt owed (negative), using the dated baseline —
  // NOT the raw sum of every charge ever logged (which ignores past bill payments)
  if(accountType(wallet)==='credit_card') return -getDebtBalance(wallet);
  if(WALLET_PORTS[wallet]) return walletCashReserve(wallet);
  return walletRawBalance(wallet);
}

// ============ WALLET SUMMARY (transaction list tab) ============
let walletSummaryExpanded = false;
function renderWalletSummary(){
  const el=document.getElementById('wallet-summary');
  if(!el) return;
  const walletsInUse=[...new Set(txData.map(t=>t.w).filter(Boolean))];
  const balances = walletsInUse.map(w=>({w, bal:walletBalance(w)}))
    .sort((a,b)=>{ if(a.bal===null)return 1; if(b.bal===null)return -1; return Math.abs(b.bal)-Math.abs(a.bal); });
  const shown = walletSummaryExpanded ? balances : balances.slice(0,5);
  let html='<div class="ws-grid">';
  shown.forEach(({w,bal})=>{
    const ic=accountIcon(w);
    const isOverride = walletOverrides[w]!==undefined;
    const balDisplay = bal===null ? '<span style="font-size:12px;color:var(--txt3)">บันทึกการซื้อ</span>' : `<span class="ws-bal ${bal>=0?'pos':'neg'}">${fmt(bal)}${isOverride?' ✎':''}</span>`;
    html+=`<div class="ws-item" onclick="setListWalletFilter('${w.replace(/'/g,"\\'")}');document.getElementById('list-wallet-filter').value='${w.replace(/'/g,"\\'")}'">
      <div class="ws-icon" style="background:${ic.c}22;color:${ic.c}">${ic.e}</div>
      <div class="ws-info"><div class="ws-name">${w}</div>${balDisplay}</div>
    </div>`;
  });
  html+='</div>';
  if(balances.length>5){
    html+=`<button class="ws-expand" onclick="walletSummaryExpanded=!walletSummaryExpanded;renderWalletSummary()">${walletSummaryExpanded?'▲ ย่อ':'▼ ดูทั้งหมด ('+balances.length+' บัญชี)'}</button>`;
  }
  el.innerHTML=html;
}

// when a wallet is filtered, show its balance prominently + override option
function renderSelectedWalletBalance(){
  const el=document.getElementById('selected-wallet-bal');
  if(!el) return;
  if(!listWalletFilter || listWalletFilter==='all'){ el.innerHTML=''; return; }
  const bal=walletBalance(listWalletFilter);
  const ic=accountIcon(listWalletFilter);
  const isInvest = WALLET_PORTS[listWalletFilter];
  const isOverride = walletOverrides[listWalletFilter]!==undefined;
  if(bal===null){ el.innerHTML='<div class="swb-card"><div style="display:flex;align-items:center;gap:10px"><div class="ws-icon" style="background:'+ic.c+'22;color:'+ic.c+';width:40px;height:40px;font-size:20px">'+ic.e+'</div><div><div style="font-size:13px;color:var(--txt2)">บัญชีบันทึกการซื้อกองทุน</div><div style="font-size:13px;color:var(--txt3)">สั่งซื้อสำเร็จทันที ไม่มีเงินสดค้าง</div></div></div></div>'; return; }
  el.innerHTML=`<div class="swb-card">
    <div style="display:flex;align-items:center;gap:10px">
      <div class="ws-icon" style="background:${ic.c}22;color:${ic.c};width:40px;height:40px;font-size:20px">${ic.e}</div>
      <div><div style="font-size:13px;color:var(--txt2)">${isInvest?'เงินสดรอลงทุน':'ยอดคงเหลือ'}</div>
      <div style="font-size:22px;font-weight:700" class="${bal>=0?'pos':'neg'}">${fmt(bal)}</div></div>
    </div>
    <button class="swb-edit" onclick="overrideWalletBalance('${listWalletFilter.replace(/'/g,"\\'")}')">${isOverride?'แก้ยอด ✎':'ตั้งยอดจริง'}</button>
  </div>${isInvest?`<div class="help-text" style="margin-top:6px">คำนวณจาก: เงินเข้าสุทธิ − ต้นทุนหุ้นที่ถือ (${fmt(walletHoldingsCost(listWalletFilter))})</div>`:''}`;
}
function overrideWalletBalance(wallet){
  const cur=walletBalance(wallet);
  const v=prompt(`ตั้งยอดเงินจริงของ "${wallet}"\n(จาก statement/แอปธนาคาร)\nยอดที่คำนวณได้: ${Math.round(cur).toLocaleString()}`, Math.round(cur));
  if(v!==null){
    const n=parseFloat(v);
    if(!isNaN(n)){ walletOverrides[wallet]={amount:n, date:today()}; saveWalletOverrides(); renderWalletSummary(); renderSelectedWalletBalance(); renderList(); toast('ตั้งยอด ณ วันนี้แล้ว ✓ (รายการหลังจากนี้จะคำนวณต่อ)'); }
  }
}



// ============ DIVIDEND TRACKER ============
function initDivYear(){
  const sel=document.getElementById('div-year');
  if(!sel) return;
  const years=[...new Set(txData.filter(t=>t.c==='Interest Money').map(t=>t.d.slice(0,4)))].sort().reverse();
  sel.innerHTML=years.map(y=>`<option value="${y}">${parseInt(y)+543}</option>`).join('');
}
function renderDividends(){
  const sel=document.getElementById('div-year');
  if(!sel) return;
  const yr=sel.value;
  const divs=txData.filter(t=>t.c==='Interest Money' && t.d.slice(0,4)===yr && t.a>0);
  const total=divs.reduce((s,t)=>s+t.a,0);
  document.getElementById('div-total').textContent=fmt(total);
  // yield on portfolio value
  let portVal=0; holdings.forEach(h=>{portVal+=holdingValue(h).val;});
  document.getElementById('div-yield').textContent=portVal>0?(total/portVal*100).toFixed(1)+'%':'—';
  // breakdown by source (from note)
  const bySource={};
  divs.forEach(t=>{
    let src=(t.n||'').replace(/ปันผล/gi,'').trim()||'อื่นๆ (ดอกเบี้ย/ไม่ระบุ)';
    bySource[src]=(bySource[src]||0)+t.a;
  });
  const items=Object.entries(bySource).sort((a,b)=>b[1]-a[1]).slice(0,12);
  const max=items.length?items[0][1]:1;
  document.getElementById('div-breakdown').innerHTML=items.map(([k,v])=>
    `<div class="bar-row"><div class="bar-label">${k}</div><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%;background:var(--income)"></div></div><div class="bar-val">${fmt(v)}</div></div>`).join('');
}


// ============ BUDGET / PLAN vs ACTUAL ============
const LS_BUDGET = 'myfinance_budgets_v1';
let budgets = {};  // {category: monthlyTarget}
const DEFAULT_BUDGETS = {
  'Food & Beverage':10000,'Petrol':5000,'Transportation':2000,'Travel':20000,
  'Entertainment':700,'Phone Bill':1500,'Gifts':10000,'Shopping':5000
};
function loadBudgets(){
  const s=localStorage.getItem(LS_BUDGET);
  budgets = s ? JSON.parse(s) : {...DEFAULT_BUDGETS};
}
function saveBudgetsLS(){ localStorage.setItem(LS_BUDGET, JSON.stringify(budgets)); }

function openBudgetEditor(){
  // list all expense categories used + any with a budget set
  const cats = [...new Set([...EXPENSE_CATS, ...Object.keys(budgets)])].sort();
  document.getElementById('budget-editor-list').innerHTML = cats.map(c=>
    `<div class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <label style="flex:1;margin:0">${c}</label>
      <input type="number" data-cat="${c.replace(/"/g,'&quot;')}" value="${budgets[c]||''}" placeholder="0" style="width:120px" />
    </div>`).join('');
  document.getElementById('budget-modal').classList.add('show');
}
function closeBudgetEditor(){ document.getElementById('budget-modal').classList.remove('show'); }
function saveBudgets(){
  const inputs = document.querySelectorAll('#budget-editor-list input[data-cat]');
  budgets = {};
  inputs.forEach(inp=>{ const v=parseFloat(inp.value); if(v>0) budgets[inp.getAttribute('data-cat')]=v; });
  saveBudgetsLS();
  closeBudgetEditor();
  renderAnalysis();
  toast('บันทึกแผนแล้ว ✓');
}

function renderPlanActual(yr, mo){
  const el=document.getElementById('a-plan-actual');
  if(!el) return;
  if(Object.keys(budgets).length===0){
    el.innerHTML='<div class="empty" style="padding:16px">ยังไม่ได้ตั้งแผน<br><span style="font-size:11px">กดปุ่ม "ตั้งแผน" เพื่อกำหนดงบแต่ละหมวด</span></div>';
    return;
  }
  // actual spending per category for the period
  let data=txData.filter(t=>t.d.slice(0,4)===yr);
  let monthCount=1;
  if(mo!=='all'){ data=data.filter(t=>new Date(t.d).getMonth()==mo); }
  else { monthCount=12; } // year view: compare to annual = monthly*12
  const actual={};
  data.forEach(t=>{ if(txType(t)==='expense'&&t.a<0) actual[t.c]=(actual[t.c]||0)+Math.abs(t.a); });

  const rows=Object.entries(budgets).sort((a,b)=>b[1]-a[1]).map(([cat,monthlyTarget])=>{
    const target=monthlyTarget*monthCount;
    const act=actual[cat]||0;
    const pct=target>0?Math.round(act/target*100):0;
    const over=act>target;
    const barColor=pct<=85?'var(--income)':pct<=100?'var(--transfer)':'var(--expense)';
    return `<div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span style="color:var(--txt2)">${cat}</span>
        <span><b class="${over?'neg':''}">${fmt(act)}</b> <span style="color:var(--txt3)">/ ${fmt(target)}</span></span>
      </div>
      <div class="ratio-bar"><div class="ratio-bar-fill" style="width:${Math.min(100,pct)}%;background:${barColor}"></div></div>
      <div style="font-size:11px;color:${barColor};margin-top:2px">${pct}% ${over?'⚠ เกินงบ '+fmt(act-target):'· เหลือ '+fmt(target-act)}</div>
    </div>`;
  }).join('');
  el.innerHTML=rows;
}

// ============ CATEGORY DETAIL TABLE (amount + %) ============
function renderCatDetail(yr, mo){
  const el=document.getElementById('a-cat-detail');
  if(!el) return;
  let data=txData.filter(t=>t.d.slice(0,4)===yr);
  if(mo!=='all') data=data.filter(t=>new Date(t.d).getMonth()==mo);
  const cats={}; let total=0;
  data.forEach(t=>{ if(txType(t)==='expense'&&t.a<0){ const a=Math.abs(t.a); cats[t.c]=(cats[t.c]||0)+a; total+=a; } });
  const items=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  if(!items.length){ el.innerHTML='<div class="empty">ไม่มีข้อมูล</div>'; return; }
  let html=`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--txt3);padding:6px 0;border-bottom:1px solid var(--border);font-weight:600"><span>หมวด</span><span>จำนวน · %</span></div>`;
  items.forEach(([c,v])=>{
    const pct=(v/total*100).toFixed(1);
    html+=`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:0.5px solid var(--border);font-size:13px">
      <span style="color:var(--txt2)">${c}</span>
      <span><b>${fmt(v)}</b> <span style="color:var(--txt3)">· ${pct}%</span></span></div>`;
  });
  html+=`<div style="display:flex;justify-content:space-between;padding:10px 0 2px;font-size:14px;font-weight:700"><span>รวม</span><span>${fmt(total)}</span></div>`;
  el.innerHTML=html;
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  VALIDATION — cross-check shared numbers two independent ways      ║
// ║  For SECURITY/trust, not display. Flags divergence so you can      ║
// ║  catch missing or misclassified transactions early.               ║
// ╚══════════════════════════════════════════════════════════════════╝
function renderValidation(){
  const el=document.getElementById('validation-list');
  if(!el) return;
  const checks=[];

  // CHECK 1: Investment cash — backward calc (money in − holdings cost)
  //          vs forward calc (sum of cash in/out transactions per wallet)
  Object.keys(WALLET_PORTS).forEach(w=>{
    const backward = walletCashReserve(w); // money in − holdings cost
    let forward=0; // raw sum of all transactions in wallet
    txData.forEach(t=>{ if(t.w===w) forward+=t.a; });
    // forward includes holdings-buys as negatives, so forward ≈ cash only if holdings tracked separately
    // We compare backward to (forward + holdings cost) which should ≈ money in
    const holdCost=walletHoldingsCost(w);
    const expectedMoneyIn = backward + holdCost;
    const actualNetFlow = forward + holdCost; // net flow + what's deployed
    const diff = Math.abs(backward - (forward + holdCost - holdCost)); // simplified
    // Simpler meaningful check: does backward calc ≈ raw flow? (only if no untracked deposits)
    checks.push({
      name:'เงินสด '+w,
      a:'คำนวณถอยหลัง: '+fmt(backward),
      b:'ผลรวมรายการ: '+fmt(forward),
      ok: Math.abs(backward-forward) < 50000, // tolerance
      gap: backward-forward
    });
  });

  // CHECK 2: Net worth assets = sum of parts
  const nw=computeNetWorth();
  const partsSum = nw.portVal + nw.cash + nw.condo + nw.investCash;
  checks.push({
    name:'สินทรัพย์รวม = ผลบวกส่วนย่อย',
    a:'assets: '+fmt(nw.assets),
    b:'ผลบวก: '+fmt(partsSum),
    ok: Math.abs(nw.assets-partsSum)<1,
    gap: nw.assets-partsSum
  });

  // CHECK 3: Portfolio value via two paths
  const pv1=getPortfolioValue();
  let pv2=0; ['thai','us','etf','fund','gold'].forEach(p=>{ holdings.filter(h=>h.port===p).forEach(h=>pv2+=holdingValue(h).val); });
  checks.push({
    name:'มูลค่าพอร์ต (รวม vs แยก port)',
    a:'รวมตรง: '+fmt(pv1),
    b:'แยก port: '+fmt(pv2),
    ok: Math.abs(pv1-pv2)<1,
    gap: pv1-pv2
  });

  // CHECK 4: Card debt non-negative
  accountsByType('credit_card').forEach(c=>{
    const bal=getDebtBalance(c);
    checks.push({
      name:c+' ไม่ติดลบ',
      a:'ยอดหนี้: '+fmt(bal),
      b: bal>=0?'ปกติ':'⚠ ติดลบ',
      ok: bal>=0,
      gap: bal<0?bal:0
    });
  });

  // Add data health scan as a check
  const problems = scanDataHealth();
  checks.push({
    name:'ความสมบูรณ์ข้อมูล ('+txData.length+' รายการ)',
    a: problems.length===0 ? 'ทุกรายการถูกต้อง' : problems.length+' รายการมีปัญหา',
    b: problems.length===0 ? 'ปกติ' : 'ดูด้านล่าง',
    ok: problems.length===0,
    gap: 0
  });

  el.innerHTML = checks.map(c=>{
    const color=c.ok?'var(--income)':'var(--transfer)';
    const icon=c.ok?'✓':'⚠';
    return `<div style="padding:10px 0;border-bottom:0.5px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--txt2)">${c.name}</span>
        <span style="color:${color};font-weight:700">${icon}</span>
      </div>
      <div style="font-size:11px;color:var(--txt3);margin-top:2px">${c.a} · ${c.b}${!c.ok&&c.gap?' · ต่าง '+fmt(Math.abs(c.gap)):''}</div>
    </div>`;
  }).join('');

  // If there are data problems, list them
  if(problems.length>0){
    el.innerHTML += '<div style="margin-top:12px;padding:10px;background:var(--surface2);border-radius:8px">'+
      '<div style="font-size:12px;font-weight:700;color:var(--transfer);margin-bottom:6px">รายการที่ต้องตรวจสอบ:</div>'+
      problems.slice(0,20).map(p=>`<div style="font-size:11px;color:var(--txt3);padding:3px 0">• ${p.tx.d||'?'} | ${p.tx.c||'?'} | ${fmt(p.tx.a||0)} — <span style="color:var(--transfer)">${p.reason}</span></div>`).join('')+
      (problems.length>20?`<div style="font-size:11px;color:var(--txt3);margin-top:4px">...และอีก ${problems.length-20} รายการ</div>`:'')+
      '</div>';
  }

  // DUPLICATE DETECTION — show for review, never auto-delete
  const dups = findDuplicates();
  const dupExtra = dups.reduce((s,g)=>s+(g.count-1),0);
  el.innerHTML += `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;color:var(--txt2)">รายการที่อาจซ้ำ</span>
      <span style="color:${dupExtra>0?'var(--transfer)':'var(--income)'};font-weight:700">${dupExtra>0?'⚠ '+dupExtra:'✓'}</span>
    </div>
    <div style="font-size:11px;color:var(--txt3);margin-top:2px">${dupExtra>0? dups.length+' กลุ่มที่มีรายการเหมือนกัน (วันเดียวกัน ยอดเท่ากัน) — ตรวจว่าใช่รายการซ้ำหรือไม่':'ไม่พบรายการซ้ำ'}</div>
  </div>`;
  if(dups.length>0){
    el.innerHTML += '<div style="margin-top:8px">'+
      dups.slice(0,15).map(g=>{
        const t=g.tx;
        return `<div style="padding:8px;margin-bottom:6px;background:var(--surface2);border-radius:8px">
          <div style="font-size:12px;color:var(--txt2)">${t.d} · ${t.c} · <b>${fmt(t.a)}</b> · ${g.count} รายการเหมือนกัน</div>
          <div style="font-size:11px;color:var(--txt3)">${t.w}${t.n?' · '+t.n:''}</div>
          <button onclick="removeDuplicate(${g.indices[g.indices.length-1]})" style="margin-top:4px;font-size:11px;padding:3px 10px;background:var(--transfer);color:#0a0d12;border-radius:6px;font-weight:600">ลบ 1 รายการซ้ำ</button>
        </div>`;
      }).join('')+
      (dups.length>15?`<div style="font-size:11px;color:var(--txt3)">...และอีก ${dups.length-15} กลุ่ม</div>`:'')+
      '<div style="font-size:10px;color:var(--txt3);margin-top:6px;font-style:italic">หมายเหตุ: การซื้อของซ้ำในวันเดียวกัน (เช่น กาแฟ 2 แก้ว) อาจไม่ใช่รายการซ้ำจริง — ตรวจก่อนลบ</div>'+
      '</div>';
  }
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  DATA VALIDATION — the gatekeeper. Every save passes through this. ║
// ║  Blocks malformed transactions before they corrupt calculations.  ║
// ╚══════════════════════════════════════════════════════════════════╝
const VALID_TYPES = ['expense','income','transfer','invest','invest_card','debt'];

// Validate a single transaction record. Returns {ok:true} or {ok:false, msg:'...'}
function validateTx(t){
  // amount must be a valid number, not zero, not NaN
  if(typeof t.a !== 'number' || isNaN(t.a) || t.a === 0){
    return {ok:false, msg:'จำนวนเงินไม่ถูกต้อง'};
  }
  // date must be real YYYY-MM-DD and parseable
  if(!t.d || !/^\d{4}-\d{2}-\d{2}$/.test(t.d)){
    return {ok:false, msg:'วันที่ไม่ถูกต้อง'};
  }
  const dt = new Date(t.d);
  if(isNaN(dt.getTime()) || t.d.slice(0,4) < '2000' || t.d.slice(0,4) > '2100'){
    return {ok:false, msg:'วันที่ไม่สมเหตุสมผล'};
  }
  // category required
  if(!t.c || String(t.c).trim()===''){
    return {ok:false, msg:'ไม่มีหมวดหมู่'};
  }
  // wallet must be present and known (in ACCOUNTS or META.wallets)
  if(!t.w || String(t.w).trim()===''){
    return {ok:false, msg:'ไม่มีบัญชี/wallet'};
  }
  const known = ACCOUNTS[t.w] || (META.wallets && META.wallets.includes(t.w));
  if(!known){
    return {ok:false, msg:'บัญชี "'+t.w+'" ไม่รู้จัก'};
  }
  // type check (if ty present, must be valid)
  if(t.ty && !VALID_TYPES.includes(t.ty)){
    return {ok:false, msg:'ประเภทรายการไม่ถูกต้อง: '+t.ty};
  }
  // debt payment must reference a debt
  if(t.ty==='debt' && t.debt && !ACCOUNTS[t.debt]){
    return {ok:false, msg:'อ้างอิงหนี้ที่ไม่รู้จัก'};
  }
  return {ok:true};
}

// Detect potential duplicate transactions (same date+amount+wallet+category+note).
// Does NOT auto-delete — many "duplicates" are legit (e.g. two ฿50 coffees same day).
// Returns groups of 2+ identical records for the user to review.
function findDuplicates(){
  const groups = {};
  txData.forEach((t,i)=>{
    const key = [t.d, t.a, t.w, t.c, t.n||''].join('|||');
    if(!groups[key]) groups[key]=[];
    groups[key].push(i);
  });
  return Object.values(groups).filter(idxs=>idxs.length>1)
    .map(idxs=>({ count:idxs.length, indices:idxs, tx:txData[idxs[0]] }))
    .sort((a,b)=>b.count-a.count);
}

// Remove one specific duplicate row by index (user-initiated only)
function removeDuplicate(index){
  if(index>=0 && index<txData.length){
    txData.splice(index,1);
    saveTxData();
    renderValidation();
    if(typeof renderList==='function') renderList();
    toast('ลบรายการซ้ำแล้ว ✓');
  }
}

// Safe add: validate before inserting. Returns true if added, false if blocked.
function addTxSafe(t, atFront){
  const r = validateTx(t);
  if(!r.ok){ toast('❌ บันทึกไม่ได้: '+r.msg); return false; }
  if(atFront) txData.unshift(t); else txData.push(t);
  return true;
}

// Scan ALL existing transactions and report problems (data health check)
function scanDataHealth(){
  const problems = [];
  txData.forEach((t,i)=>{
    const r = validateTx(t);
    if(!r.ok) problems.push({index:i, tx:t, reason:r.msg});
  });
  return problems;
}

// ============ INIT ============
loadData();
loadWalletOverrides();
loadBudgets();
fillWallets();
fillCategories();
document.getElementById('f-date').value=today();
initPeriodSelectors();
setType('expense');
try{ renderLoan(); renderHealth(); renderDebt(); initDivYear(); }catch(e){console.log(e);}
