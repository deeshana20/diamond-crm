/* ============================================================
   DIAMOND INTERNATIONAL LANKA — COMMAND CENTER
   app.js  (extracted + bulletproofed from monolithic index.html)
   All element accesses are null-checked before use.
   ============================================================ */

'use strict';

/* ─────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────── */
const SUPABASE_URL      = "https://euppycxpozqtdwbhxcjy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_21vgnKgrn1yRURN6Rcu-2g_x-b4J9JP";
const EDGE_FN_URL       = "https://euppycxpozqtdwbhxcjy.supabase.co/functions/v1/ai-analyst";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* chart instances */
let velocityChart = null, exposureChart = null, productChart = null;
let snConflictCache = [];

/* ─────────────────────────────────────────────
   STATE
───────────────────────────────────────────── */
let userName        = "Admin User";
let custs           = [];
let cid             = null;
let ccust           = null;
let vmode           = 'table';
let qfilt           = null;
let productFilter   = 'all';
let tableDensity    = 'relaxed';
let awFile          = null;
let kpiDateFilter   = null;
let bulkSelected    = new Set();
let emailTone       = 'formal';
let txEditId        = null;

/* quick-notes in-memory cache */
const qnCache     = {};
let qnOpenId      = null;
let qnEditingId   = null;

/* ─────────────────────────────────────────────
   STAGE CONFIG
───────────────────────────────────────────── */
const SC = {
  'Inquiry':                { bg:'rgba(100,116,139,.2)', color:'#94a3b8', border:'rgba(100,116,139,.4)', darkColor:'#cbd5e1' },
  'Quoted':                 { bg:'rgba(180,83,9,.2)',    color:'#f59e0b', border:'rgba(180,83,9,.4)',    darkColor:'#fbbf24' },
  'PO Received':            { bg:'rgba(30,58,138,.25)',  color:'#60a5fa', border:'rgba(30,58,138,.45)', darkColor:'#93c5fd' },
  'Artwork Approval':       { bg:'rgba(76,29,149,.25)',  color:'#a78bfa', border:'rgba(76,29,149,.45)', darkColor:'#c4b5fd' },
  'Serial Number Approval': { bg:'rgba(185,28,28,.2)',   color:'#f87171', border:'rgba(185,28,28,.4)',  darkColor:'#fca5a5' },
  'Production (PI)':        { bg:'rgba(6,78,59,.25)',    color:'#34d399', border:'rgba(6,78,59,.45)',   darkColor:'#6ee7b7' },
  // ADD THE NEW STAGES HERE:
  'Delivered':              { bg:'rgba(8,145,178,.25)',  color:'#06b6d4', border:'rgba(8,145,178,.45)', darkColor:'#67e8f9' },
  'Closed':                 { bg:'rgba(15,23,42,.5)',    color:'#64748b', border:'rgba(15,23,42,.8)',   darkColor:'#94a3b8' }
};

let STAGES = ['Inquiry', 'Quoted', 'PO Received', 'Artwork Approval', 'Serial Number Approval', 'Production (PI)', 'Delivered', 'Closed'];
let SLBLS  = ['Inquiry', 'Quoted', 'PO Recd', 'Artwork', 'S/N Approval', 'Production', 'Delivered', 'Closed'];
const LC_STEPS = ['Draft PI Received','LC Opened','TT Paid','In Clearing','Completed'];
let SDOTS  = ['#64748b','#f59e0b','#3b82f6','#a78bfa','#ef4444','#22c55e', '#22d3ee', '#475569'];

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }

function ss(id) {
  document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
  const el = $(id);
  if (el) el.classList.add('on');
}

function fmtM(v)  { return `Rs.${(v / 1e6).toFixed(2)}M`; }
function fmtK(v)  { if(v>=1e6) return `Rs.${(v/1e6).toFixed(1)}M`; if(v>=1e3) return `Rs.${Math.round(v/1e3)}K`; return `Rs.${Math.round(v).toLocaleString()}`; }
function fmtRs(v) { return `Rs. ${Math.round(Number(v)||0).toLocaleString()}`; }

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/,/g,'').replace(/[^\d.-]/g,''));
  return Number.isFinite(n) ? n : 0;
}

function ageInDays(createdAt) {
  if (!createdAt) return 0;
  const dt = new Date(createdAt);
  if (Number.isNaN(dt.getTime())) return 0;
  const days = (Date.now() - dt.getTime()) / 86400000;
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function getCustomerValue(c) {
  const direct = toNum(c?.total_value ?? c?.totalValue ?? c?.price ?? c?.amount ?? c?.order_value ?? c?.orderValue ?? c?.value ?? c?.quoted_price ?? 0);
  if (direct > 0) return direct;
  const outstanding = (c?.transactions || []).filter(t => t?.payment_status === 'Outstanding').reduce((s,t) => s + toNum(t?.amount), 0);
  if (outstanding > 0) return outstanding;
  return (c?.transactions || []).reduce((s,t) => s + toNum(t?.amount), 0);
}

function getCustomerStageReferenceDate(c) {
  const latestTx = (c?.transactions || []).map(t => t?.order_date || t?.created_at).filter(Boolean).sort((a,b) => new Date(b)-new Date(a))[0];
  const latestStage = (c?.activity_logs || []).filter(l => String(l?.log_type||'').toLowerCase()==='stage').map(l => l?.created_at || l?.updated_at).filter(Boolean).sort((a,b) => new Date(b)-new Date(a))[0];
  return latestStage || latestTx || c?.updated_at || c?.last_contact || c?.created_at || null;
}

function isActivePipelineStage(status) {
  return [
    'Inquiry', 'Quoted', 'PO Received',
    'Artwork Approval', 'Serial Number Approval', 'Production (PI)'
  ].includes(status);
}

function getCustomerProductLabel(c) {
  const raw = (c?.product_type ?? c?.category ?? c?.product ?? 'Other');
  return String(raw).trim() || 'Other';
}

function getProductThemeColor(label) {
  const key = String(label||'Other').trim().toLowerCase();
  if (key.includes('holo')) return '#d4af37';
  if (key.includes('cert')) return '#60a5fa';
  return '#94a3b8';
}

function ddiff(ds) {
  if (!ds) return null;
  const d = new Date(ds), t = new Date();
  if (isNaN(d)) return null;
  t.setHours(0,0,0,0); d.setHours(0,0,0,0);
  return Math.floor((d - t) / 864e5);
}

function dsince(ds) {
  if (!ds) return null;
  const d = new Date(ds);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 864e5);
}

function badge(s) {
  const c  = SC[s] || SC['Inquiry'];
  const isDark = document.documentElement.classList.contains('dark');
  const color  = isDark ? c.darkColor : c.color;
  return `<span class="badge" style="background:${c.bg};color:${color};border-color:${c.border}">${s}</span>`;
}

function etaBadge(c) {
  const logs = (c.logistics||[]).filter(l => l.lc_status !== 'Completed');
  if (!logs.length) return '<span class="text-slate-600 text-xs">—</span>';
  const l = logs.sort((a,b) => new Date(b.pi_date||0) - new Date(a.pi_date||0))[0];
  if (!l.eta) return `<span class="badge eta-ok">${l.lc_status||'—'}</span>`;
  const d = ddiff(l.eta);
  if (d===0)          return `<span class="badge eta-td">ARRIVING TODAY</span>`;
  if (d>0 && d<=3)   return `<span class="badge eta-ug">URGENT: ${d}d</span>`;
  if (d>3 && d<=5)   return `<span class="badge eta-sn">${d}d</span>`;
  if (d<0)            return `<span class="badge eta-od">OVERDUE ${Math.abs(d)}d</span>`;
  return `<span class="badge eta-ok">${d}d</span>`;
}

function hl(text, q) {
  if (!q) return text;
  return text.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),
    '<mark style="background:rgba(212,175,55,.35);color:#fff;border-radius:2px;padding:0 2px">$1</mark>');
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

let toastTimer;
function toast(m, type='') {
  const t = $('toast');
  if (!t) return;
  t.textContent = m;
  t.className   = type ? `show ${type}` : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2700);
}

function renderAIResponse(el, markdown, withTyping = true) {
  if (!el) return;
  const safe = typeof marked !== 'undefined' ? marked.parse(markdown||'') : (markdown||'');
  el.className = `ai-response-bubble ai-md${withTyping?' ai-typing':''}`;
  el.innerHTML = safe;
}

function parseDateSafe(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameOrBeforeDate(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  da.setHours(0,0,0,0); db.setHours(0,0,0,0);
  return da.getTime() <= db.getTime();
}

/* ─────────────────────────────────────────────
   AUTH & THEME
───────────────────────────────────────────── */
async function login() {
  const emailEl = $('ae'), passEl = $('ap');
  if (!emailEl || !passEl) return;
  const { error } = await sb.auth.signInWithPassword({ email: emailEl.value, password: passEl.value });
  if (error) toast('Login failed: ' + error.message, 'warn');
  else checkAuth();
}

async function checkAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) {
    userName = session.user.email.split('@')[0];
    if (session.user.user_metadata?.full_name) userName = session.user.user_metadata.full_name;
    updateUserProfile();
  }
  ss(session ? 'scr-portal' : 'scr-auth');
}

async function logout() {
  try { await sb.auth.signOut(); } catch(e) { /* ignore */ }
  ss('scr-auth');
}

function openModule() {
  ss('scr-app');
  updateUserProfile();
  loadData();
}

async function getValidClient() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session || !session.user) {
      toast('Session expired. Please login again.', 'warn');
      ss('scr-auth');
      return null;
    }
    return sb;
  } catch(err) {
    console.error('getValidClient error', err);
    toast('Session error. Please login again.', 'warn');
    ss('scr-auth');
    return null;
  }
}

function toggleTheme() {
  toast('Theme toggle coming soon', 'info');
}

function initTheme() {
  const theme  = localStorage.getItem('crmTheme') || 'light';
  const isDark = theme === 'dark';
  if (isDark) document.documentElement.classList.add('dark');
}

/* ─────────────────────────────────────────────
   PIPELINE STAGES
───────────────────────────────────────────── */
async function loadPipelineStages() {
  try {
    const { data, error } = await sb.from('pipeline_stages').select('*').order('order', { ascending: true });
    if (error) console.warn('loadPipelineStages supabase error', error);

    const fallback = [
      { id:'inquiry',    name:'Inquiry',                  label:'Inquiry' },
      { id:'quoted',     name:'Quoted',                   label:'Quoted' },
      { id:'po',         name:'PO Received',              label:'PO Received' },
      { id:'artwork',    name:'Artwork Approval',         label:'Artwork Approval' },
      { id:'sn',         name:'Serial Number Approval',   label:'Serial Number Approval' },
      { id:'production', name:'Production (PI)',          label:'Production (PI)' },
      { id:'delivered',  name:'Delivered',                label:'Delivered' },
      { id:'closed',     name:'Closed',                   label:'Closed' }
    ];

    window.crmStages = (data && data.length) ? data : fallback;

    // BULLETPROOFING: If DB payload succeeded but is missing new stages due to RLS, inject them.
    const dbLabels = window.crmStages.map(s => s.label || s.name || String(s.id));
    if (!dbLabels.includes('Delivered')) window.crmStages.push({ id:'delivered', label:'Delivered' });
    if (!dbLabels.includes('Closed'))    window.crmStages.push({ id:'closed', label:'Closed' });

    STAGES = window.crmStages.map(s => s.label || s.name || String(s.id));
    SLBLS  = STAGES.map(s => s.length > 12 ? s.split(' ')[0] : s);

    const palette = ['#64748b','#f59e0b','#3b82f6','#a78bfa','#ef4444','#22c55e','#06b6d4','#475569'];
    SDOTS  = STAGES.map((_,i) => palette[i % palette.length]);

    const ms = $('ms');
    if (ms) {
      ms.innerHTML = '';
      window.crmStages.forEach(stage => {
        const opt   = document.createElement('option');
        const label = stage.label || stage.name || String(stage.id);
        opt.value       = label;
        opt.textContent = label;
        if (ccust && (ccust.status === label || ccust.status === stage.name)) opt.selected = true;
        ms.appendChild(opt);
      });
    }
  } catch(err) {
    console.error('loadPipelineStages error', err);
    window.crmStages = window.crmStages || [];
  }
}

/* ─────────────────────────────────────────────
   NAV
───────────────────────────────────────────── */
function showView(view) {
  if (view === 'kanban') sv('kanban'); else sv('table');

  document.querySelectorAll('.snav-item').forEach(el => el.classList.remove('active'));
  const snavTarget = $('snav-' + view);
  if (snavTarget) snavTarget.classList.add('active');

  document.querySelectorAll('.bnav-tab').forEach(el => el.classList.remove('active'));
  const bnavTarget = $('bnav-' + view);
  if (bnavTarget) bnavTarget.classList.add('active');
}

function updateUserProfile() {
  const nameEl     = $('sidebar-user-name');
  const initialsEl = $('user-initials');
  if (nameEl)     nameEl.textContent = userName;
  if (initialsEl && userName) {
    initialsEl.textContent = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }
}

/* ─────────────────────────────────────────────
   DATA
───────────────────────────────────────────── */
async function loadData() {
  const tbody  = $('tbody');
  const kboard = $('kboard');
  if (tbody)  tbody.innerHTML  = '<tr><td colspan="8" class="px-4 py-10 text-center text-slate-500">Loading records…</td></tr>';
  if (kboard) kboard.innerHTML = '<div class="kcol"><div style="height:200px;background:rgba(255,255,255,.04);border-radius:8px;margin:8px;animation:etapulse 2s infinite"></div></div>'.repeat(5);

  try {
    const { data, error } = await sb.from('Diamond crM').select('*,transactions(*),activity_logs(*),logistics(*)').order('id');
    if (error) throw error;
    custs = data || [];
  } catch {
    try {
      const { data } = await sb.from('Diamond crM').select('*,transactions(*),activity_logs(*)').order('id');
      custs = (data || []).map(c => ({ ...c, logistics: [] }));
    } catch(e2) {
      toast('DB Error: ' + e2.message, 'warn');
      return;
    }
  }

  updateDashboard(custs);
  updateAnalytics(custs);
  updIntel();
  updKPIs();
  render();
  renderTier1Charts();
  custs.forEach(c => { if (!qnCache[c.id] || !qnCache[c.id].length) fetchRecentNotes(c.id); });
}

/* ─────────────────────────────────────────────
   INTEL & KPIs
───────────────────────────────────────────── */
function updIntel() {
  const staleEl = $('ic-stale');
  if (staleEl) staleEl.textContent = custs.filter(c => { const d = dsince(c.last_contact); return d===null || d>=7; }).length;

  let sc = 0;
  custs.forEach(c => (c.logistics||[]).filter(l => l.lc_status!=='Completed').forEach(l => { const d = ddiff(l.eta); if(d!==null && d>=0 && d<=5) sc++; }));
  const shipEl = $('ic-ship');
  if (shipEl) shipEl.textContent = sc;

  let out = 0;
  custs.forEach(c => (c.transactions||[]).forEach(t => { if(t.payment_status==='Outstanding') out += parseFloat(t.amount)||0; }));
  const riskEl = $('ic-risk');
  if (riskEl) riskEl.textContent = fmtK(out);
}

function updKPIs(df = null) {
  let o=0, m=0, q=0, y=0;
  const now = new Date(), cm = now.getMonth(), cq = Math.floor(cm/3), cy = now.getFullYear();
  const monthRevenue = Array(12).fill(0);
  let txCount = 0;

  custs.forEach(c => (c.transactions||[]).forEach(t => {
    const a  = parseFloat(t.amount)||0;
    const td = new Date(t.order_date);
    if (df) { if(td < df.from || td > df.to) return; }
    if (!isNaN(td)) txCount++;
    if (t.payment_status === 'Outstanding') { o += a; }
    else if (t.payment_status === 'Received') {
      if (!isNaN(td) && td.getFullYear() === cy) {
        y += a;
        monthRevenue[td.getMonth()] += a;
        if (Math.floor(td.getMonth()/3) === cq) q += a;
        if (td.getMonth() === cm) m += a;
      }
    }
  }));

  const setKPI = (id, val) => { const el = $(id); if(el) el.textContent = val; };
  setKPI('kc-o', fmtM(o));
  setKPI('kc-y', fmtM(y));
  setKPI('kc-q', fmtM(q));
  setKPI('kc-m', fmtM(m));

  const monthsElapsed    = Math.max(cm+1,1);
  const avgMonthly       = y / monthsElapsed;
  const yearEndForecast  = avgMonthly * 12;
  const lastMonthRevenue = cm > 0 ? monthRevenue[cm-1] : 0;
  const upward           = (yearEndForecast/12) >= lastMonthRevenue;

  const trendEl = $('kc-ftrend');
  if (trendEl) {
    trendEl.className = `mt-2 text-xs font-semibold flex items-center gap-1 ${upward?'text-emerald-400':'text-rose-400'}`;
    trendEl.textContent = upward ? '▲ Upward Trend' : '⚠ Below Last Month';
  }

  const confidence     = Math.min(100, Math.round((txCount/50)*100));
  const confidenceBand = confidence>=75?'High':confidence>=40?'Medium':'Low';
  setKPI('kc-fcst', fmtM(yearEndForecast));
  setKPI('kc-fconf', `Confidence: ${confidence}% (${confidenceBand}) · ${txCount} tx`);
}

function applyKPIDateFilter() {
  const fromEl = $('kpi-from'), toEl = $('kpi-to');
  if (!fromEl || !toEl) return;
  const from = fromEl.value, to = toEl.value;
  if (!from || !to) { toast('Select both dates','warn'); return; }
  kpiDateFilter = { from: new Date(from), to: new Date(to) };
  updKPIs(kpiDateFilter);
  toast('KPI filter applied','info');
}

function clearKPIDateFilter() {
  kpiDateFilter = null;
  const fromEl = $('kpi-from'), toEl = $('kpi-to');
  if (fromEl) fromEl.value = '';
  if (toEl)   toEl.value   = '';
  updKPIs();
  toast('KPI filter cleared','info');
}

/* ─────────────────────────────────────────────
   AI HUB
───────────────────────────────────────────── */
function toggleAIHub() {
  const c  = $('aiHubContent');
  const ch = $('aiHubChevron');
  const t  = $('aiHubToggleText');
  if (!c) return;
  const open = c.classList.toggle('hidden');
  if (ch) ch.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
  if (t)  t.textContent      = open ? 'Click to Expand' : 'Click to Collapse';
}

/* ─────────────────────────────────────────────
   FILTER & RENDER
───────────────────────────────────────────── */
function updateClearButton() {
  const gSearch    = $('gsearch');
  const hasSearch  = (gSearch?.value||'').trim().length > 0;
  const hasFilter  = !!qfilt || productFilter !== 'all';
  const btn        = $('clrbtn');
  if (btn) btn.style.display = (hasSearch || hasFilter) ? 'inline-flex' : 'none';
}

function onProductFilterChange() {
  const pf = $('product-filter');
  productFilter = pf ? pf.value : 'all';
  updateClearButton();
  render();
}

function qf(f) { qfilt = qfilt===f ? null : f; updateClearButton(); render(); }
function cf() {
  qfilt         = null;
  productFilter = 'all';
  const gs = $('gsearch'); if(gs) gs.value = '';
  const pf = $('product-filter'); if(pf) pf.value = 'all';
  updateClearButton();
  render();
}

function filt(list) {
  const gSearch = $('gsearch');
  const q = (gSearch?.value||'').toLowerCase();
  return list.filter(c => {
    const p = (c.product||'').toLowerCase();
    if (productFilter==='holograms'    && !p.includes('holo'))                               return false;
    if (productFilter==='certificates' && !p.includes('cert'))                               return false;
    if (productFilter==='security_docs'&& !(p.includes('security')||p.includes('doc')))     return false;
    const ms = c.name.toLowerCase().includes(q) || (c.product||'').toLowerCase().includes(q);
    if (!ms) return false;
    if (!qfilt) return true;
    if (qfilt==='stale') { const d = dsince(c.last_contact); return d===null||d>=7; }
    if (qfilt==='eta')   return (c.logistics||[]).some(l => { const d=ddiff(l.eta); return d!==null&&d>=0&&d<=5&&l.lc_status!=='Completed'; });
    return true;
  });
}

function render() {
  if (vmode === 'table') renderTable(); else renderKanban();
  syncDashboard();
}

function sv(v) {
  vmode = v;
  const tClass = 'px-4 py-2 text-xs font-semibold bg-gold-500 text-navy-900 rounded flex items-center gap-1.5';
  const kClass = 'px-4 py-2 text-xs font-medium text-slate-400 rounded hover:bg-slate-700/50 transition-colors flex items-center gap-1.5';
  const vtbT = $('vtb-t'), vtbK = $('vtb-k');
  if (vtbT) vtbT.className = v==='table' ? tClass : kClass;
  if (vtbK) vtbK.className = v==='kanban'? tClass : kClass;
  const vwT = $('vw-t'), vwK = $('vw-k');
  if (vwT) vwT.style.display = v==='table'  ? 'block' : 'none';
  if (vwK) vwK.style.display = v==='kanban' ? 'block' : 'none';
  render();
}

/* ─────────────────────────────────────────────
   EXECUTIVE DASHBOARD
───────────────────────────────────────────── */
function setExecutiveDashboardCollapsed(collapsed) {
  const content  = $('executive-dashboard-content');
  const chevron  = $('executive-dashboard-chevron');
  const toggleBtn= $('executive-dashboard-toggle');
  if (!content || !chevron || !toggleBtn) return;
  if (collapsed) {
    content.classList.add('collapsed');
    chevron.classList.add('rotated');
    toggleBtn.setAttribute('aria-expanded','false');
  } else {
    content.classList.remove('collapsed');
    chevron.classList.remove('rotated');
    toggleBtn.setAttribute('aria-expanded','true');
  }
}

function toggleExecutiveDashboard() {
  const content = $('executive-dashboard-content');
  if (!content) return;
  const collapsed = !content.classList.contains('collapsed');
  setExecutiveDashboardCollapsed(collapsed);
  localStorage.setItem('crmExecutiveDashboardCollapsed', collapsed ? '1' : '0');
}

function initExecutiveDashboardCollapse() {
  const saved = localStorage.getItem('crmExecutiveDashboardCollapsed');
  setExecutiveDashboardCollapsed(saved === '1');
}

/* ─────────────────────────────────────────────
   TABLE DENSITY
───────────────────────────────────────────── */
function updateDensityButtons() {
  const compactOn = tableDensity === 'compact';
  const cBtn = $('density-compact'), rBtn = $('density-relaxed');
  const active   = 'px-3 py-1.5 text-xs font-semibold bg-gold-500 text-navy-900 rounded transition-colors';
  const inactive = 'px-3 py-1.5 text-xs font-medium text-slate-300 rounded hover:bg-navy-700 transition-colors';
  if (cBtn) cBtn.className = compactOn ? active : inactive;
  if (rBtn) rBtn.className = !compactOn ? active : inactive;
}

function setTableDensity(mode) {
  tableDensity = mode === 'compact' ? 'compact' : 'relaxed';
  localStorage.setItem('crmTableDensity', tableDensity);
  updateDensityButtons();
  render();
}

function initTableDensity() {
  const saved = localStorage.getItem('crmTableDensity');
  tableDensity = saved === 'compact' ? 'compact' : 'relaxed';
  updateDensityButtons();
}

/* ─────────────────────────────────────────────
   PDF EXPORT
───────────────────────────────────────────── */
async function generateExecutiveReport() {
  const source = $('executive-overview');
  if (!source) { toast('Executive Overview not found', 'warn'); return; }
  if (typeof window.html2pdf !== 'function') { toast('PDF library not loaded', 'warn'); return; }
  const btn = $('executive-report-btn');
  const oldLabel = btn ? btn.textContent : '';
  try {
    if (btn) { btn.disabled=true; btn.textContent='Generating...'; btn.classList.add('opacity-60','cursor-not-allowed'); }

    const shell = document.createElement('div');
    shell.className = 'pdf-export-shell';

    const wm = document.createElement('div');
    wm.className = 'pdf-watermark';
    wm.textContent = 'CONFIDENTIAL';

    const hdr = document.createElement('div');
    hdr.className = 'pdf-export-header';
    hdr.innerHTML = `<div><div class="pdf-export-title">Executive Overview</div><div class="pdf-export-subtitle">Diamond International Lanka - Security Printing Division</div></div><div class="pdf-export-subtitle">${new Date().toLocaleString()}</div>`;

    const clone = source.cloneNode(true);
    clone.id = 'executive-overview-export';
    clone.style.maxWidth = 'none'; clone.style.margin = '0';
    clone.querySelectorAll('#executive-dashboard-toggle,#executive-report-btn').forEach(el => el.remove());
    const c = clone.querySelector('#executive-dashboard-content');
    if (c) c.classList.remove('collapsed');

    const footer = document.createElement('div');
    footer.className = 'pdf-confidential-footer';
    footer.textContent = 'Confidential - Security Printing Division';

    shell.appendChild(wm); shell.appendChild(hdr); shell.appendChild(clone); shell.appendChild(footer);
    document.body.appendChild(shell);

    await window.html2pdf().set({
      margin: [8,8,10,8],
      filename: `Executive_Overview_${new Date().toISOString().slice(0,10)}.pdf`,
      image: { type:'jpeg', quality:.98 },
      html2canvas: { scale:2, useCORS:true, backgroundColor:'#0a192f' },
      jsPDF: { unit:'mm', format:'a4', orientation:'landscape' },
      pagebreak: { mode:['css','legacy'] }
    }).from(shell).save();

    shell.remove();
    toast('Executive report downloaded','info');
  } catch(e) {
    toast('Failed to generate report','warn');
  } finally {
    document.querySelectorAll('.pdf-export-shell').forEach(n => n.remove());
    if (btn) { btn.disabled=false; btn.textContent=oldLabel||'Generate Executive Report'; btn.classList.remove('opacity-60','cursor-not-allowed'); }
  }
}

/* ─────────────────────────────────────────────
   BULK
───────────────────────────────────────────── */
function toggleBulkCheckbox(id) {
  if (bulkSelected.has(id)) bulkSelected.delete(id); else bulkSelected.add(id);
  updateBulkUI();
}

function toggleAllBulk(checked) {
  filt(custs).forEach(c => { if(checked) bulkSelected.add(c.id); else bulkSelected.delete(c.id); });
  render();
}

function updateBulkUI() {
  const n   = bulkSelected.size;
  const cnt = $('bulk-count'); if (cnt) cnt.textContent = n;
  const tb  = $('bulk-toolbar'); if (tb) tb.style.display = n > 0 ? 'block' : 'none';
}

function clearBulkSelection() { bulkSelected.clear(); updateBulkUI(); render(); }

async function bulkUpdateStatus() {
  const bsEl        = $('bulk-status');
  const targetStage = bsEl ? bsEl.value : '';

  if (!targetStage || !bulkSelected.size) return;

  // ── FINANCIAL GATE FOR BULK ───────────────────────────────────────────────
  if (targetStage === 'Closed') {

    const selectedIds = Array.from(bulkSelected);

    // Issue 2: verify every selected ID exists in local cache BEFORE fetching.
    // If any ID is missing from custs[], abort immediately — do not silently skip.
    const missingLocally = selectedIds.filter(id => !custs.find(c => String(c.id) === String(id)));
    if (missingLocally.length > 0) {
      toast('Bulk update aborted: inconsistent data state detected', 'warn');
      console.error(
        '[Diamond CRM] Bulk abort — IDs not found in local cache:',
        missingLocally
      );
      return;   // hard stop
    }

    // Issue 1 + Issue 3: fresh Supabase fetch for ALL selected IDs at once.
    // Single query — no N+1 problem.
    let financialMap;
    try {
      financialMap = await fetchFreshFinancialData(selectedIds);
    } catch (fetchErr) {
      // Cannot confirm financial state → block entire operation
      toast('Bulk update aborted: inconsistent data state detected', 'warn');
      console.error('[Diamond CRM] Bulk fresh fetch failed:', fetchErr);
      return;
    }

    // Issue 2 (Supabase side): if the map is missing any ID that was requested,
    // the record doesn't exist in the DB — abort rather than assume it's clear.
    const missingInDB = selectedIds.filter(id => !financialMap.has(String(id)));
    if (missingInDB.length > 0) {
      toast('Bulk update aborted: inconsistent data state detected', 'warn');
      console.error(
        '[Diamond CRM] Bulk abort — IDs returned no financial data from DB:',
        missingInDB
      );
      return;   // hard stop
    }

    // Issue 4: normalisation is done inside fetchFreshFinancialData.
    // Collect all records that fail the financial gate.
    const blockedRecords = [];
    for (const id of selectedIds) {
      const financial = financialMap.get(String(id));
      if (financial && financial.hasOutstanding) {
        const record = custs.find(c => String(c.id) === String(id));
        blockedRecords.push({
          name:    record?.name || `ID ${id}`,
          balance: financial.outstandingBalance,
        });
      }
    }

    // If ANY record fails — abort entire operation (no partial updates)
    if (blockedRecords.length > 0) {
      const names = blockedRecords
        .map(r => `${r.name} (Rs. ${r.balance.toLocaleString()})`)
        .join(', ');
      toast('Cannot close deal: outstanding balance exists.', 'warn');
      console.warn(
        `[Diamond CRM] Bulk closure blocked — ${blockedRecords.length} record(s):`,
        names
      );
      return;   // hard stop — zero DB writes
    }
  }
  // ── END FINANCIAL GATE ───────────────────────────────────────────────────

  try {
    // Capture old stages before writing (needed for accurate audit log)
    const oldStages = {};
    for (const id of bulkSelected) {
      const record = custs.find(c => String(c.id) === String(id));
      // At this point we've already confirmed all IDs exist in cache (see above)
      oldStages[id] = record ? record.status : 'Unknown';
    }

    // Write updates
    await Promise.all(
      Array.from(bulkSelected).map(id =>
        sb.from('Diamond crM')
          .update({ status: targetStage })
          .eq('id', id)
      )
    );

    // ── AUDIT LOG ────────────────────────────────────────────────────────────
    const logEntries = Array.from(bulkSelected).map(id => ({
      customer_id:        id,
      change_description: `Bulk stage update: ${oldStages[id]} → ${targetStage}`,
      log_type:           'stage',
      old_value:          oldStages[id] || null,
      new_value:          targetStage,
    }));

    const logRes = await sb.from('activity_logs').insert(logEntries);
    if (logRes.error) {
      // Non-fatal — stage updates already committed
      console.warn('[Diamond CRM] Bulk audit log failed:', logRes.error);
    }
    // ── END AUDIT LOG ────────────────────────────────────────────────────────

    toast(`✔ Updated ${bulkSelected.size} records`, 'info');
    clearBulkSelection();
    loadData();

  } catch (err) {
    console.error('bulkUpdateStatus error:', err);
    toast('Bulk update failed', 'warn');
  }
}

/* ─────────────────────────────────────────────
   QUICK NOTES
───────────────────────────────────────────── */
function toggleQNEditor(customerId) {
  if (qnOpenId !== null && qnOpenId !== customerId) {
    const prev = $('qn-editor-' + qnOpenId);
    if (prev) prev.classList.remove('open');
  }
  const editor = $('qn-editor-' + customerId);
  if (!editor) return;
  const isOpen = editor.classList.toggle('open');
  qnOpenId = isOpen ? customerId : null;
  if (isOpen) {
    const ta = $('qn-input-' + customerId);
    if (ta) { ta.value = ''; ta.focus(); onQNInput(customerId); }
    if (!qnCache[customerId]) fetchRecentNotes(customerId);
  }
}

document.addEventListener('click', function(e) {
  if (qnOpenId === null) return;
  const editorEl = $('qn-editor-' + qnOpenId);
  const cellEl   = $('qn-cell-'   + qnOpenId);
  if (editorEl && cellEl && !cellEl.contains(e.target)) {
    editorEl.classList.remove('open');
    qnOpenId = null;
  }
});

function onQNInput(customerId) {
  const ta      = $('qn-input-'   + customerId);
  const counter = $('qn-counter-' + customerId);
  if (!ta || !counter) return;
  const len = ta.value.length;
  counter.textContent = len + ' / 280';
  counter.classList.remove('warn','over');
  if (len >= 280) counter.classList.add('over');
  else if (len >= 240) counter.classList.add('warn');
}

async function saveQuickNote(customerId) {
  const ta      = $('qn-input-' + customerId);
  const saveBtn = $('qn-btn-'   + customerId);
  if (!ta) return;
  const noteText = ta.value.trim();
  if (!noteText) { toast('Note cannot be empty','warn'); if(ta) ta.focus(); return; }
  if (noteText.length > 280) { toast('Note exceeds 280 characters','warn'); return; }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  const client = await getValidClient();
  if (!client) { if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='Save Note'; } return; }

  /* editing existing */
  if (qnEditingId) {
    const editingId = qnEditingId;
    try {
      const { data, error } = await client.from('quick_notes').update({ note_text:noteText, updated_by:userName||'Admin' }).eq('id', parseInt(String(editingId),10)).select().single();
      if (error) throw error;
      if (qnCache[customerId]) {
        const idx = qnCache[customerId].findIndex(n => String(n.id)===String(editingId));
        if (idx !== -1) qnCache[customerId][idx] = data;
      }
      renderQNBubbles(customerId);
      toast('✔ Note updated');
    } catch(err) {
      console.error('saveQuickNote (edit) error', err);
      if (err?.code==='PGRST303') ss('scr-auth');
      toast('Failed to update note','warn');
    } finally {
      qnEditingId = null;
      if (saveBtn) { saveBtn.disabled=false; saveBtn.textContent='Save Note'; }
      const ed = $('qn-editor-' + customerId); if(ed) ed.classList.remove('open');
      qnOpenId = null;
    }
    return;
  }

  /* new note – optimistic */
  const optimistic = { id:'optimistic-'+Date.now(), customer_id:customerId, note_text:noteText, created_at:new Date().toISOString(), created_by:userName||'Admin', _pending:true };
  if (!qnCache[customerId]) qnCache[customerId] = [];
  qnCache[customerId].unshift(optimistic);
  renderQNBubbles(customerId);
  ta.value = '';
  onQNInput(customerId);
  const editor = $('qn-editor-' + customerId); if(editor) editor.classList.remove('open');
  qnOpenId = null;

  let savedNote = null;
  try {
    const { data, error } = await client.from('quick_notes').insert([{ customer_id:customerId, note_text:noteText, created_by:userName||'Admin' }]).select().single();
    if (error) throw error;
    savedNote = data;
    const idx = qnCache[customerId].findIndex(n => n.id === optimistic.id);
    if (idx !== -1) qnCache[customerId][idx] = savedNote;
    renderQNBubbles(customerId);
    toast('✔ Note saved');
  } catch(err) {
    qnCache[customerId] = qnCache[customerId].filter(n => n.id !== optimistic.id);
    renderQNBubbles(customerId);
    if (err?.code==='PGRST303') ss('scr-auth');
    toast('⚠ Failed to save note','warn');
    if (saveBtn) { saveBtn.disabled=false; saveBtn.textContent='Save Note'; }
    const editorToReopen = $('qn-editor-' + customerId); if(editorToReopen) editorToReopen.classList.add('open');
    const taf = $('qn-input-' + customerId);
    if (taf) { taf.value = noteText; onQNInput(customerId); taf.focus(); }
    return;
  } finally {
    if (saveBtn) { saveBtn.disabled=false; saveBtn.textContent='Save Note'; }
  }

  if (savedNote) callGeminiForSummary(customerId, noteText, savedNote.id);
}

async function fetchRecentNotes(customerId) {
  if (qnCache[customerId] && qnCache[customerId].length > 0) { renderQNBubbles(customerId); return; }
  try {
    const { data, error } = await sb.from('quick_notes').select('id,note_text,created_at,created_by,vibe_summary').eq('customer_id', customerId).order('created_at',{ascending:false}).limit(3);
    if (error) { console.error('[quick_notes] error:', JSON.stringify(error)); qnCache[customerId] = []; return; }
    qnCache[customerId] = data || [];
    renderQNBubbles(customerId);
  } catch(err) {
    console.error('[quick_notes] exception:', err);
    qnCache[customerId] = [];
  }
}

function renderQNBubbles(customerId) {
  const container = $('qn-bubbles-' + customerId);
  const label     = $('qn-label-'   + customerId);
  if (!container) return;
  const notes = (qnCache[customerId] || []).slice(0,3);
  if (label) label.textContent = notes.length ? notes.length + ' note' + (notes.length>1?'s':'') : 'Add note';
  if (!notes.length) { container.innerHTML = ''; return; }
  container.innerHTML = notes.map((n,i) => {
    const full      = n.note_text || '';
    const truncated = full.length > 30 ? full.substring(0,30) + '...' : full;
    const isPending = n._pending === true;
    const vibe      = (i===0 && !isPending && n.vibe_summary) ? `<span class="qn-vibe-badge" title="AI Vibe: ${escapeHTML(n.vibe_summary||'')}">✦ ${escapeHTML(n.vibe_summary||'')}</span>` : '';
    return `
<div class="qn-bubble-wrapper group" style="position:relative;display:flex;flex-direction:column;align-items:flex-start;">
  <div class="qn-bubble-row" style="display:flex;align-items:center;width:100%;">
    <span class="qn-bubble" style="flex-grow:1;" title="${escapeHTML(full)}">${isPending ? '⏳ ' : ''}${escapeHTML(truncated)}</span>
    ${!isPending ? `
    <div class="qn-actions" style="display:none;gap:4px;margin-left:4px;">
      <button onclick="event.stopPropagation();editQuickNote('${escapeHTML(String(n.id))}',${customerId})" style="color:#94a3b8;background:none;border:none;cursor:pointer;font-size:10px;">✎</button>
      <button onclick="event.stopPropagation();deleteQuickNote('${escapeHTML(String(n.id))}',${customerId})" style="color:#ef4444;background:none;border:none;cursor:pointer;font-size:10px;">✕</button>
    </div>` : ''}
  </div>
  ${vibe}
</div>`;
  }).join('');
}

async function deleteQuickNote(noteId, customerId) {
  if (!noteId || !customerId) return;
  if (!confirm('Are you sure?')) return;

  if (String(noteId).startsWith('optimistic-')) {
    if (qnCache[customerId]) qnCache[customerId] = qnCache[customerId].filter(n => String(n.id) !== String(noteId));
    renderQNBubbles(customerId);
    toast('✔ Note removed');
    return;
  }

  const client = await getValidClient();
  if (!client) return;

  try {
    const numericId = Number(noteId);
    const { error } = await client.from('quick_notes').delete().eq('id', Number.isFinite(numericId) ? numericId : noteId);
    if (error) {
      if (error.code === 'PGRST303') { toast('Session expired. Please login again.','warn'); ss('scr-auth'); return; }
      toast('Failed to delete note: ' + (error.message||error.code||'Unknown error'),'warn');
      return;
    }
    if (qnCache[customerId]) qnCache[customerId] = qnCache[customerId].filter(n => String(n.id) !== String(noteId));
    renderQNBubbles(customerId);
    toast('✔ Note deleted');
  } catch(err) {
    console.error('deleteQuickNote error', err);
    if (err?.code==='PGRST303') { toast('Session expired. Please login again.','warn'); ss('scr-auth'); return; }
    toast('Failed to delete note','warn');
  }
}

function editQuickNote(noteId, customerId) {
  const notes = qnCache[customerId] || [];
  const note  = notes.find(n => String(n.id)===String(noteId));
  const editor = $('qn-editor-' + customerId);
  if (editor) editor.classList.add('open');
  const ta = $('qn-input-' + customerId);
  if (ta) ta.value = note ? note.note_text : '';
  onQNInput(customerId);
  qnOpenId    = customerId;
  qnEditingId = noteId;
  setTimeout(() => { const taf = $('qn-input-' + customerId); if(taf) taf.focus(); }, 80);
}

async function callGeminiForSummary(customerId, noteText, noteId) {
  if (!noteText?.trim()) return;
  const prompt = `Read this CRM note and return EXACTLY 5 words (no punctuation, no explanation, no quotes) that capture the sales situation described. Return ONLY the 5 words, nothing else.\n\nNOTE: "${noteText}"`;
  let vibeText = null;
  try {
    const raw   = await callGemini(prompt);
    const words = raw.trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 7) vibeText = words.slice(0,5).join(' ').toLowerCase();
  } catch { vibeText = null; }
  try { await sb.from('quick_notes').update({ vibe_summary:vibeText }).eq('id',noteId); } catch {}
  if (qnCache[customerId]) {
    const n = qnCache[customerId].find(n => String(n.id)===String(noteId));
    if (n) n.vibe_summary = vibeText;
  }
  renderQNBubbles(customerId);
}

/* ─────────────────────────────────────────────
   TABLE & KANBAN
───────────────────────────────────────────── */
function getInitials(name) {
  if (!name) return '??';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0,2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getAvatarColor(name) {
  const sets = [
    { bg:'rgba(212,175,55,.15)', color:'#d4af37' },
    { bg:'rgba(37,99,235,.18)', color:'#60a5fa' },
    { bg:'rgba(16,185,129,.15)', color:'#34d399' },
    { bg:'rgba(139,92,246,.15)', color:'#a78bfa' },
    { bg:'rgba(239,68,68,.15)', color:'#f87171' },
  ];
  const idx = (name||'').charCodeAt(0) % 5;
  return sets[Number.isFinite(idx) ? idx : 0];
}

function relativeContact(dateStr) {
  if (!dateStr) return { label:'Never', stale:true };
  const d = dsince(dateStr);
  if (d === null)        return { label:'Never',      stale:true  };
  if (d >= 0 && d <= 1) return { label:'Today',       stale:false };
  if (d <= 6)            return { label:`${d}d ago`,   stale:false };
  return                        { label:`${d}d ago`,   stale:true  };
}

function getStagePercent(status) {
  const idx = STAGES.indexOf(status);
  if (idx < 0) return 0;
  return Math.round((idx / Math.max(STAGES.length-1,1)) * 100);
}

function renderTable() {
  const list     = filt(custs);
  const gSearch  = $('gsearch');
  const q        = (gSearch?.value||'');
  const rowPad   = tableDensity === 'compact' ? 'px-3 py-2' : 'px-4 py-3.5';

  const staleCount   = list.filter(c => { const d = dsince(c.last_contact); return d===null||d>=7; }).length;
  const overdueCount = list.filter(c => (c.logistics||[]).some(l => { const d=ddiff(l.eta); return d!==null&&d<0&&l.lc_status!=='Completed'; })).length;

  const tbody = $('tbody');
  if (tbody) {
    tbody.innerHTML = list.map(c => {
      const out    = (c.transactions||[]).filter(t => t.payment_status==='Outstanding').reduce((s,t) => s+(parseFloat(t.amount)||0), 0);
      const s      = SC[c.status] || SC['Inquiry'];
      const isDark = document.documentElement.classList.contains('dark');
      const statusColor = isDark ? s.darkColor : s.color;
      const avatar  = getAvatarColor(c.name);
      const initials= getInitials(c.name);
      const rc      = relativeContact(c.last_contact);
      const isStale = dsince(c.last_contact)===null || (dsince(c.last_contact)||0)>=7;
      const leftBorder = c.is_priority===true ? '#d4af37' : isStale ? '#f59e0b' : 'transparent';

      return `<tr data-id="${c.id}" onclick="openModal(${c.id})" class="group transition-colors duration-150 hover:bg-white/[0.03] cursor-pointer border-b border-white/5" style="border-left:3px solid ${leftBorder}">
        <td class="${rowPad}">
          <input type="checkbox" onclick="event.stopPropagation();toggleBulkCheckbox(${c.id})" ${bulkSelected.has(c.id)?'checked':''} class="w-4 h-4 rounded border-gold-500/30 bg-navy-900"/>
        </td>
        <td class="${rowPad}">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="av-circle" style="background:${avatar.bg};color:${avatar.color}">${initials}</div>
            <div>
              <div style="font-weight:700;font-size:13px;color:#e2e8f0">${hl(c.name,q)}</div>
              <div style="font-size:10px;color:#475569;margin-top:1px;display:flex;align-items:center;gap:4px">
                <span style="width:5px;height:5px;border-radius:50%;background:#d4af37;display:inline-block;flex-shrink:0"></span>
                ${c.product||'—'}
              </div>
            </div>
          </div>
        </td>
        <td class="${rowPad}">
          <div>
            <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${s.bg};color:${statusColor};border:1px solid ${s.border}">
              <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
              ${c.status}
            </span>
            <div style="height:2px;background:rgba(255,255,255,.06);border-radius:2px;margin-top:5px;width:80px">
              <div class="stage-prog" style="height:100%;border-radius:2px;background:${statusColor};width:${getStagePercent(c.status)}%"></div>
            </div>
          </div>
        </td>
        <td class="${rowPad} hidden md:table-cell">
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b">
            ${c.contact||'—'}
            <span style="font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;background:${rc.stale?'rgba(245,158,11,.1)':'transparent'};color:${rc.stale?'#f59e0b':'#334155'}">${rc.label}</span>
            ${rc.stale?'<span class="stale-pulse" style="width:7px;height:7px;border-radius:50%;background:#f59e0b;flex-shrink:0;display:inline-block"></span>':''}
          </div>
        </td>
        <td class="${rowPad} hidden lg:table-cell text-xs text-slate-400">${c.next_action||'—'}</td>
        <td class="${rowPad}">
          ${out>0 ? `<span style="font-weight:700;font-size:13px;color:#f87171">${fmtK(out)}</span>`
                  : `<span style="font-weight:600;font-size:11px;color:#166534;background:rgba(16,185,129,.08);padding:2px 8px;border-radius:5px;border:1px solid rgba(16,185,129,.15)">Clear</span>`}
        </td>
        <td class="${rowPad} hidden md:table-cell">${etaBadge(c)}</td>
        <td class="${rowPad} qn-cell hidden xl:table-cell" id="qn-cell-${c.id}">
          <div id="qn-display-${c.id}">
            <button class="qn-trigger-btn" onclick="event.stopPropagation();toggleQNEditor(${c.id})">
              📝 <span id="qn-label-${c.id}">Add note</span>
            </button>
            <div id="qn-bubbles-${c.id}"></div>
          </div>
          <div class="qn-editor-wrap" id="qn-editor-${c.id}" onclick="event.stopPropagation()">
            <textarea class="qn-textarea" id="qn-input-${c.id}" rows="3" maxlength="280" placeholder="Quick note (280 chars max)…" oninput="onQNInput(${c.id})" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();saveQuickNote(${c.id});}"></textarea>
            <div class="qn-char-counter" id="qn-counter-${c.id}">0 / 280</div>
            <button class="qn-save-btn" id="qn-btn-${c.id}" onclick="saveQuickNote(${c.id})">Save Note</button>
          </div>
        </td>
        <td class="${rowPad} hidden xl:table-cell" onclick="event.stopPropagation()">
          <div class="row-act-group" style="display:flex;align-items:center;gap:4px;opacity:0;transition:opacity .12s" id="rag-${c.id}">
            <button onclick="openModal(${c.id})" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#475569" title="Open record">
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 13l6.5-6.5a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z"/></svg>
            </button>
            <button onclick="openModal(${c.id});setTimeout(()=>{const tabs=document.querySelectorAll('.mtab');if(tabs[6])st('tai',tabs[6])},200)" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#475569" title="AI Email draft">
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            </button>
            <button onclick="cid=${c.id};ccust=custs.find(x=>x.id===${c.id});delCust()" style="width:26px;height:26px;border-radius:6px;border:1px solid rgba(239,68,68,.2);background:rgba(239,68,68,.06);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#f87171" title="Delete record">
              <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    document.querySelectorAll('#tbody tr').forEach(tr => {
      const rag = tr.querySelector('.row-act-group');
      if (!rag) return;
      tr.addEventListener('mouseenter', () => rag.style.opacity='1');
      tr.addEventListener('mouseleave', () => rag.style.opacity='0');
    });

    list.forEach(c => {
      if (qnCache[c.id] && qnCache[c.id].length) renderQNBubbles(c.id);
      else fetchRecentNotes(c.id);
    });
  }

  /* footer */
  const tableWrap = document.querySelector('#vw-t .hidden.lg\\:block > div');
  let footer = $('table-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'table-footer';
    if (tableWrap) tableWrap.insertAdjacentElement('afterend', footer);
  }
  if (footer) {
    footer.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid rgba(255,255,255,.06);background:rgba(12,24,41,.8);border-radius:0 0 8px 8px;margin-top:-1px">
        <span style="font-size:11px;color:#334155">
          Showing ${list.length} of ${custs.length} records
          ${staleCount>0 ? '· <span style="color:#f59e0b;font-weight:600">'+staleCount+' stale</span>' : ''}
          ${overdueCount>0 ? '· <span style="color:#ef4444;font-weight:600">'+overdueCount+' overdue ETA</span>' : ''}
        </span>
        <span style="font-size:10px;color:#1e293b">${new Date().toLocaleTimeString('en-LK',{hour:'2-digit',minute:'2-digit'})} · live</span>
      </div>`;
  }

  /* mobile cards */
  const mCards = $('mobile-cards');
  if (mCards) {
    mCards.innerHTML = list.map(c => {
      const out   = (c.transactions||[]).filter(t => t.payment_status==='Outstanding').reduce((s,t) => s+(parseFloat(t.amount)||0),0);
      const s     = SC[c.status] || SC['Inquiry'];
      const isDark= document.documentElement.classList.contains('dark');
      const statusColor = isDark ? s.darkColor : s.color;
      const avatar = getAvatarColor(c.name);
      const initials = getInitials(c.name);
      return `
      <div class="bento-card relative overflow-hidden mb-4 p-5" onclick="openModal(${c.id})">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${statusColor};border-radius:12px 12px 0 0"></div>
        <div class="absolute top-0 left-0 w-1.5 h-full" style="background:${s.color}"></div>
        <div class="flex justify-between items-start mb-4 pl-2">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="av-circle" style="background:${avatar.bg};color:${avatar.color}">${initials}</div>
            <div><h3 class="text-lg font-bold text-white">${c.name}</h3><p class="text-xs text-gold-500/80">${c.product||'Security Printing'}</p></div>
          </div>
          <span class="px-2 py-1 rounded-lg text-[10px] font-bold" style="background:${s.bg};color:${s.color};border:1px solid ${s.border}">${c.status}</span>
        </div>
        <div class="grid grid-cols-2 gap-3 pl-2">
          <div class="bg-black/20 rounded-xl p-3 border border-white/5">
            <p class="text-[9px] text-slate-500 uppercase font-bold">Outstanding</p>
            <p class="text-sm font-bold ${out>0?'text-rose-400':'text-emerald-400'}">${fmtK(out)}</p>
          </div>
          <div class="bg-black/20 rounded-xl p-3 border border-white/5">
            <p class="text-[9px] text-slate-500 uppercase font-bold">Timeline</p>
            <p class="text-sm font-bold text-slate-200">${etaBadge(c)}</p>
          </div>
        </div>
      </div>`;
    }).join('');
  }
}

function renderKanban() {
  const kboard = $('kboard');
  if (!kboard) return;
  const list = filt(custs);
  const gSearch = $('gsearch');
  const q = (gSearch?.value||'');
  kboard.innerHTML = STAGES.map((stage, si) => {
    const cards = list.filter(c => c.status===stage);
    return `<div class="kcol${cards.length?' active':''}">
      <div class="kcol-h">
        <div class="kcol-ht"><div class="kcol-hdot" style="background:${SDOTS[si]}"></div>${SLBLS[si]}</div>
        <span class="kcol-cnt">${cards.length}</span>
      </div>
      <div class="kcards">${cards.length ? cards.map(c => {
        const out = (c.transactions||[]).filter(t => t.payment_status==='Outstanding').reduce((s,t) => s+(parseFloat(t.amount)||0),0);
        const qn  = (c.activity_logs||[]).filter(l => l.log_type==='quicknote').slice(-1)[0];
        return `<div class="kcard" onclick="openModal(${c.id})">
          <div class="kc-n">${hl(c.name,q)}</div>
          <div class="kc-p">${hl(c.product||'—',q)}</div>
          <div class="kc-ft">${etaBadge(c)}<span style="font-size:10px;font-weight:700;color:${out>0?'#f87171':'#334155'}">${out>0?fmtK(out):'Clear'}</span></div>
          ${qn?`<div class="kc-note">${qn.change_description}</div>`:''}
        </div>`;
      }).join('') : '<div class="text-slate-600 text-xs text-center py-5">Empty</div>'}</div>
    </div>`;
  }).join('');
}

/* ─────────────────────────────────────────────
   CSV & COPY
───────────────────────────────────────────── */
function exportCSV() {
  let csv = "Company,Product,Stage,Contact,Current Status,Outstanding,Last Contact\n";
  custs.forEach(c => {
    const out = (c.transactions||[]).filter(t => t.payment_status==='Outstanding').reduce((s,t) => s+(parseFloat(t.amount)||0),0);
    csv += `"${c.name}","${c.product||''}","${c.status}","${c.contact||''}","${c.next_action||''}","${out}","${c.last_contact||''}"\n`;
  });
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
  a.download = `Diamond_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function cpbr(e, id) {
  e.stopPropagation();
  const c = custs.find(x => x.id===id);
  if (!c) return;
  navigator.clipboard.writeText(`${c.name} | ${c.product||'—'} | Current Status: ${c.next_action||'—'}`).then(() => toast('📋 Copied','info'));
}

/* ─────────────────────────────────────────────
   STAGE TRACKER
───────────────────────────────────────────── */
function renderTracker(cur) {
  const mstk = $('mstk');
  if (!mstk) return;
  const idx = STAGES.indexOf(cur);
  mstk.innerHTML = '<div class="stk-line"></div>' + STAGES.map((s,i) => {
    const cls = i < idx ? 'done' : i === idx ? 'active' : '';
    return `<div class="sstep ${cls}"><div class="sdot">${i<idx?'✓':i+1}</div><div class="slbl">${SLBLS[i]}</div></div>`;
  }).join('');
}

/* ─────────────────────────────────────────────
   MODAL
───────────────────────────────────────────── */
function st(id, el) {
  document.querySelectorAll('.tcont').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('.mtab').forEach(t  => t.classList.remove('on'));
  const target = $(id); if(target) target.classList.add('on');
  if(el) el.classList.add('on');
}

function setTB(id, n) {
  const el = $(id); if(!el) return;
  if (n>0) { el.classList.add('show'); el.textContent=n; } else el.classList.remove('show');
}

function openModal(id) {
  cid   = id;
  ccust = custs.find(x => x.id===id);
  if (!ccust) return;

  const setVal = (elId, val) => { const el = $(elId); if(el) el.value = val||''; };
  setVal('mn', ccust.name);   // title (not an input but a heading — handled below)
  const mnEl = $('mn'); if(mnEl) mnEl.textContent = ccust.name||'';
  const mpEl = $('mp'); if(mpEl) mpEl.textContent = ccust.product||'';

  setVal('mc',  ccust.contact);
  setVal('mlc', ccust.last_contact);
  setVal('mna', ccust.next_action);
  setVal('mnotes', ccust.notes);
  setVal('msf', ccust.stakeholder_finance);
  setVal('msa', ccust.stakeholder_artwork);
  setVal('msr', ccust.supplier_ref_no);

  const msEl   = $('ms');   if(msEl)   msEl.value   = ccust.status||'';
  const mpriEl = $('mpri'); if(mpriEl) mpriEl.value = String(ccust.is_priority||'false');

  renderTracker(ccust.status||'Inquiry');

  const txdEl = $('txd'); if(txdEl) txdEl.value = new Date().toISOString().split('T')[0];
  const txWithEnd = (ccust.transactions||[]).filter(t => t.end_serial_no!==null&&t.end_serial_no!==undefined&&t.end_serial_no!=='').sort((a,b) => new Date(b.order_date||b.created_at||0)-new Date(a.order_date||a.created_at||0))[0];
  const nextStart = txWithEnd ? parseInt(txWithEnd.end_serial_no,10) : NaN;
  const snStartEl = $('txsn-start'); if(snStartEl) snStartEl.value = Number.isFinite(nextStart) ? nextStart+1 : '';
  const snEndEl   = $('txsn-end');   if(snEndEl)   snEndEl.value   = '';
  txEditId = null;
  const txSaveBtn = $('tx-save-btn'); if(txSaveBtn) txSaveBtn.textContent = 'Log Transaction';
  const txCancelBtn = $('tx-cancel-edit-btn'); if(txCancelBtn) txCancelBtn.style.display = 'none';
  updateSerialQtyLabel();

  const awdEl = $('awd'); if(awdEl) awdEl.value = new Date().toISOString().split('T')[0];
  awFile = null;
  const awprevEl = $('awprev'); if(awprevEl){ awprevEl.style.display='none'; awprevEl.innerHTML=''; }
  const awfEl = $('awf-inp'); if(awfEl) awfEl.value = '';

  const aiOutEl = $('ai-email-out');
  if(aiOutEl){ aiOutEl.style.fontStyle='italic'; aiOutEl.style.color='#475569'; aiOutEl.className='mt-3 text-xs text-slate-400 italic min-h-[60px]'; aiOutEl.textContent='Select tone and click generate…'; }
  const copyBtnEl = $('copy-btn'); if(copyBtnEl) copyBtnEl.style.display='none';

  const vaultStatusEl = $('vault-status'); if(vaultStatusEl) vaultStatusEl.value = ccust.vault_approval_status||'Drafting';
  const vaultTsEl     = $('vault-ts');     if(vaultTsEl){ vaultTsEl.value=ccust.vault_verified_at?new Date(ccust.vault_verified_at).toLocaleString():''; vaultTsEl.dataset.iso=ccust.vault_verified_at||''; }
  updateVaultSeal();
  updateVaultPreview(ccust.vault_preview_url||null);

  st('td', document.querySelectorAll('.mtab')[0]);
  loadTx(); loadLogi(); loadHistory(); loadAw(); loadVault();

  const modalEl = $('modal'); if(modalEl) modalEl.style.display='flex';
}

function closeModal() {
  const modalEl = $('modal'); if(modalEl) modalEl.style.display='none';
  cid = null;
}

/**
 * Fetches a fresh copy of transactions directly from Supabase for one or more
 * customer IDs. Never trusts the local custs[] cache for financial decisions.
 *
 * Returns: Map<customerId, { outstandingBalance: number, hasOutstanding: boolean }>
 * Throws:  Error if the Supabase query itself fails (caller must handle)
 */
async function fetchFreshFinancialData(customerIds) {
  const ids = Array.isArray(customerIds) ? customerIds : [customerIds];

  const { data, error } = await sb
    .from('transactions')
    .select('customer_id, amount, payment_status')
    .in('customer_id', ids);

  if (error) {
    console.error('[Diamond CRM] fetchFreshFinancialData query failed:', error);
    throw new Error('Financial data fetch failed: ' + (error.message || error.code));
  }

  // Build a result map — one entry per customer ID
  const result = new Map();

  ids.forEach(id => {
    // Filter rows for this customer
    const rows = (data || []).filter(t => String(t.customer_id) === String(id));

    const outstandingBalance = rows
      .filter(t => (t.payment_status || '').trim() === 'Outstanding')
      .reduce((sum, t) => {
        // Normalise: NULL / undefined / non-numeric → 0  (Issue 4)
        const parsed = parseFloat(t.amount);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0);

    result.set(String(id), {
      outstandingBalance,               // always a finite number, never null
      hasOutstanding: outstandingBalance > 0,
    });
  });

  return result;
}

/* ─────────────────────────────────────────────
   SAVE / DELETE
───────────────────────────────────────────── */
async function saveCust() {
  const saveBtn   = document.querySelector('.modal-drawer button[onclick="saveCust()"]');
  const origLabel = saveBtn ? saveBtn.textContent : null;

  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    if (!cid) {
      toast('Record ID missing. Cannot save.', 'warn');
      return;
    }

    const msEl = $('ms');
    const ns   = msEl ? msEl.value : '';   // new stage
    const os   = ccust?.status;            // old stage

    const mpriEl = $('mpri');
    const ip     = mpriEl ? mpriEl.value === 'true' : false;

    // ── FINANCIAL GATE (Closed only) ─────────────────────────────────────────
    if (ns === 'Closed') {

      // Issue 1 + Issue 3: always fetch fresh data; never trust custs[] cache
      let financialMap;
      try {
        financialMap = await fetchFreshFinancialData(cid);
      } catch (fetchErr) {
        // If we cannot confirm financial state, we must block — safe default
        toast('Cannot verify financial status. Please try again.', 'warn');
        console.error('[Diamond CRM] saveCust: fresh fetch failed:', fetchErr);
        return;
      }

      const financial = financialMap.get(String(cid));

      // Issue 4: normalisation already done inside fetchFreshFinancialData
      if (!financial || financial.hasOutstanding) {
        const bal = financial ? financial.outstandingBalance : 0;
        toast('Cannot close deal: outstanding balance exists.', 'warn');
        console.warn(
          `[Diamond CRM] Closure blocked — customer ${cid},`,
          `outstanding: Rs. ${bal.toLocaleString()}`
        );
        return;   // hard stop — zero DB writes
      }
    }
    // ── END FINANCIAL GATE ───────────────────────────────────────────────────

    const getVal = id => { const el = $(id); return el ? el.value : ''; };

    const u = {
      status:               ns,
      contact:              getVal('mc'),
      last_contact:         getVal('mlc'),
      next_action:          getVal('mna'),
      notes:                getVal('mnotes'),
      is_priority:          ip,
      stakeholder_finance:  getVal('msf'),
      stakeholder_artwork:  getVal('msa'),
      supplier_ref_no:      getVal('msr'),
      vault_approval_status: getVal('vault-status'),
      vault_verified_at:    getVal('vault-status') === 'Final Verified'
                              ? ($('vault-ts')?.dataset?.iso || new Date().toISOString())
                              : null,
      vault_preview_url:    $('vault-preview-img')?.style?.display !== 'none'
                              ? $('vault-preview-img')?.src
                              : null,
    };

    const client = await getValidClient();
    if (!client) return;

    const res = await client
      .from('Diamond crM')
      .update(u)
      .eq('id', cid)
      .select()
      .single();

    if (res.error) {
      console.error('saveCust DB error:', res.error);
      if (res.error.code === 'PGRST303') {
        toast('Session expired. Please login again.', 'warn');
        ss('scr-auth');
      } else {
        toast('Save failed: ' + (res.error.message || 'Database error'), 'warn');
      }
      return;
    }

    // ── AUDIT LOG ────────────────────────────────────────────────────────────
    if (os !== ns) {
      const logRes = await client.from('activity_logs').insert([{
        customer_id:        cid,
        change_description: `Stage: ${os} → ${ns}`,
        log_type:           'stage',
        old_value:          os || null,
        new_value:          ns || null,
      }]);
      if (logRes.error) {
        // Non-fatal — stage update already committed
        console.warn('[Diamond CRM] Audit log failed:', logRes.error);
      }
    }
    // ── END AUDIT LOG ────────────────────────────────────────────────────────

    await loadData();
    refreshAnalytics();
    closeModal();
    toast('✔ Saved');

  } catch (err) {
    console.error('saveCust exception:', err);
    if (err?.code === 'PGRST303') {
      toast('Session expired. Please login again.', 'warn');
      ss('scr-auth');
    } else {
      toast('Save failed: ' + (err.message || String(err)), 'warn');
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled    = false;
      saveBtn.textContent = origLabel || 'Save Changes';
    }
  }
}

async function delCust() {
  if (!confirm('Delete this record and all associated data?')) return;
  await sb.from('Diamond crM').delete().eq('id',cid);
  toast('✔ Deleted');
  await loadData();
  refreshAnalytics();
  closeModal();
}

/* ─────────────────────────────────────────────
   TRANSACTIONS
───────────────────────────────────────────── */
function updateSerialQtyLabel() {
  const snStartEl = $('txsn-start'), snEndEl = $('txsn-end'), info = $('txsn-info');
  if (!info) return;
  const s = parseInt(snStartEl?.value||'',10), e = parseInt(snEndEl?.value||'',10);
  if (Number.isFinite(s) && Number.isFinite(e)) {
    const qty = (e-s)+1;
    if (qty > 0) { info.textContent = `S/N quantity: ${qty.toLocaleString()} units`; info.className='text-[10px] text-gold-400 mb-2'; }
    else         { info.textContent = 'S/N quantity: invalid range';                  info.className='text-[10px] text-rose-400 mb-2'; }
    return;
  }
  info.textContent = 'S/N quantity: —'; info.className = 'text-[10px] text-gold-400 mb-2';
}

async function refreshTxForModal() {
  const { data } = await sb.from('transactions').select('*').eq('customer_id',cid).order('order_date',{ascending:false});
  if (ccust) ccust.transactions = data||[];
  loadTx();
}

function resetTxForm() {
  txEditId = null;
  const txSaveBtn = $('tx-save-btn'); if(txSaveBtn) txSaveBtn.textContent = 'Log Transaction';
  const txCancelBtn = $('tx-cancel-edit-btn'); if(txCancelBtn) txCancelBtn.style.display = 'none';
  const txWithEnd = ((ccust?.transactions)||[]).filter(t => t.end_serial_no!==null&&t.end_serial_no!==undefined&&t.end_serial_no!=='').sort((a,b) => new Date(b.order_date||b.created_at||0)-new Date(a.order_date||a.created_at||0))[0];
  const nextStart = txWithEnd ? parseInt(txWithEnd.end_serial_no,10) : NaN;
  const setVal = (id,v) => { const el=$(id); if(el) el.value=v; };
  setVal('txd', new Date().toISOString().split('T')[0]);
  setVal('txp',''); setVal('txq',''); setVal('txa','');
  setVal('txsup','Holostik'); setVal('txst','Outstanding');
  setVal('txsn-start', Number.isFinite(nextStart) ? nextStart+1 : '');
  setVal('txsn-end','');
  updateSerialQtyLabel();
}

function editTx(txId) {
  const tx = (ccust?.transactions||[]).find(t => String(t.id)===String(txId));
  if (!tx) return;
  txEditId = tx.id;
  const txSaveBtn = $('tx-save-btn'); if(txSaveBtn) txSaveBtn.textContent = 'Update Transaction';
  const txCancelBtn = $('tx-cancel-edit-btn'); if(txCancelBtn) txCancelBtn.style.display = 'inline-block';
  const setVal = (id,v) => { const el=$(id); if(el) el.value=v||''; };
  setVal('txd',    tx.order_date||new Date().toISOString().split('T')[0]);
  setVal('txp',    tx.product);
  setVal('txq',    tx.quantity);
  setVal('txa',    tx.amount);
  setVal('txsup',  tx.supplier||'Holostik');
  setVal('txst',   tx.payment_status||'Outstanding');
  setVal('txsn-start', tx.start_serial_no??'');
  setVal('txsn-end',   tx.end_serial_no??'');
  updateSerialQtyLabel();
}

function loadTx() {
  const tx = ccust.transactions||[];
  setTB('tb-t', tx.length);
  const txbody = $('txbody'); if(!txbody) return;
  txbody.innerHTML = tx.sort((a,b) => new Date(b.order_date)-new Date(a.order_date)).map(t => `
    <tr><td>${t.order_date||'—'}</td>
    <td>${t.product||'—'}${(t.start_serial_no!==null&&t.start_serial_no!==undefined&&t.end_serial_no!==null&&t.end_serial_no!==undefined)?`<div style="font-size:10px;color:#94a3b8;margin-top:2px">S/N: ${t.start_serial_no} - ${t.end_serial_no}</div>`:''}</td>
    <td>${t.quantity||'—'}</td>
    <td style="font-weight:700">${t.amount?parseFloat(t.amount).toLocaleString():0}</td>
    <td style="color:#475569">${t.supplier||'—'}</td>
    <td style="display:flex;justify-content:space-between;align-items:center;color:${t.payment_status==='Received'?'#34d399':'#f59e0b'};font-weight:600">
      ${t.payment_status}
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="editTx('${t.id}')" class="text-gold-400 hover:text-gold-300 px-2 py-0.5 bg-gold-900/20 rounded border border-gold-700/40 text-[10px] transition-colors">✎</button>
        <button onclick="delTx('${t.id}')" class="text-rose-400 hover:text-rose-300 px-2 py-0.5 bg-rose-900/30 rounded border border-rose-700/50 text-[10px] transition-colors">✕</button>
      </div>
    </td></tr>`).join('') || '<tr><td colspan="6" style="color:#334155;padding:14px 0;text-align:center">No transactions.</td></tr>';
}

async function delTx(txId) {
  if (!confirm('Delete this transaction permanently?')) return;
  await sb.from('transactions').delete().eq('id',txId);
  toast('✔ Transaction deleted');
  if (String(txEditId)===String(txId)) resetTxForm();
  await refreshTxForModal();
  loadData();
}

async function addTx() {
  const getVal = id => { const el=$(id); return el ? el.value : ''; };
  const a = parseFloat(getVal('txa'))||0;
  if (!a) { toast('Amount required','warn'); return; }
  const s = getVal('txsn-start').trim()==='' ? null : parseInt(getVal('txsn-start'),10);
  const e = getVal('txsn-end').trim()===''   ? null : parseInt(getVal('txsn-end'),10);
  if ((s!==null&&e===null)||(s===null&&e!==null)) { toast('Enter both Start S/N and End S/N','warn'); return; }
  if (s!==null&&e!==null&&e<s) { toast('End S/N cannot be lower than Start S/N','warn'); return; }
  const serialQty = (s!==null&&e!==null) ? (e-s)+1 : null;
  const qtyVal    = serialQty !== null ? serialQty : (parseFloat(getVal('txq'))||null);
  const payload   = { customer_id:cid, order_date:getVal('txd'), product:getVal('txp'), quantity:qtyVal, amount:a, supplier:getVal('txsup'), payment_status:getVal('txst'), start_serial_no:s, end_serial_no:e };
  if (txEditId) { await sb.from('transactions').update(payload).eq('id',txEditId); toast('✔ Transaction updated','info'); }
  else          { await sb.from('transactions').insert([payload]); toast('✔ Transaction logged'); }
  await refreshTxForModal();
  loadData();
  resetTxForm();
}

/* ─────────────────────────────────────────────
   LOGISTICS
───────────────────────────────────────────── */
const lcPct = s => { const i = LC_STEPS.indexOf(s); return i<0 ? 0 : Math.round(((i+1)/LC_STEPS.length)*100); };

function loadLogi() {
  const logs    = ccust.logistics||[];
  setTB('tb-l', logs.length);
  const logilistEl = $('logilist'); if(!logilistEl) return;
  if (!logs.length) { logilistEl.innerHTML='<div style="color:#334155;text-align:center;padding:16px;font-size:12px">No shipments logged.</div>'; return; }
  logilistEl.innerHTML = logs.sort((a,b) => new Date(b.pi_date||0)-new Date(a.pi_date||0)).map(l => {
    const pct  = lcPct(l.lc_status||'Draft PI Received');
    const d    = ddiff(l.eta);
    let etaS   = '—';
    if (d===0)           etaS = '<span style="color:#34d399;font-weight:700">Arriving Today</span>';
    else if (d!==null&&d>0)  etaS = `<span style="color:#64748b">${d} days</span>`;
    else if (d!==null&&d<0)  etaS = `<span style="color:#ef4444;font-weight:700">Overdue ${Math.abs(d)}d</span>`;
    const mi  = l.shipment_mode==='Air'?'✈️':l.shipment_mode==='Sea'?'🚢':'📦';
    const pit = l.pi_date ? Math.floor((Date.now()-new Date(l.pi_date).getTime())/864e5) : '—';
    return `<div class="lentry">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div><div style="font-weight:700;font-size:13px;color:#e2e8f0">${l.product||'—'}</div>
        <div style="font-size:11px;color:#475569;margin-top:2px">${mi} ${l.shipment_mode||'—'} · PI: ${l.pi_date||'—'}</div></div>
        <span class="badge" style="background:rgba(34,211,238,.1);color:#22d3ee;border-color:rgba(34,211,238,.25)">${l.lc_status||'—'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#334155;margin-bottom:4px"><span>PI Rcvd</span><span>LC</span><span>TT Paid</span><span>Clearing</span><span>Done</span></div>
      <div class="tbar-bg"><div class="tbar-fill" style="width:${pct}%"></div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="lpill">📅 ETA: ${etaS}</span>
        <span class="lpill">⏱ ${typeof pit==='number'?pit+'d':'—'}</span>
        <span class="lpill">🏭 ${l.supplier||'—'}</span>
        <span class="lpill">📊 ${pct}%</span>
      </div>
    </div>`;
  }).join('');
}

async function addLogi() {
  const getVal = id => { const el=$(id); return el ? el.value : ''; };
  const p = getVal('lp').trim();
  if (!p) { toast('Product required','warn'); return; }
  try {
    await sb.from('logistics').insert([{ customer_id:cid, product:p, pi_date:getVal('lpi')||null, shipment_mode:getVal('lm'), supplier:getVal('lsup'), lc_status:getVal('llc'), eta:getVal('leta')||null }]);
    const lpEl = $('lp'); if(lpEl) lpEl.value='';
    const letaEl = $('leta'); if(letaEl) letaEl.value='';
    toast('✔ Shipment logged');
    loadData();
    setTimeout(() => { ccust = custs.find(x => x.id===cid); loadLogi(); }, 650);
  } catch(e) { toast('⚠ Create logistics table in Supabase first','warn'); }
}

/* ─────────────────────────────────────────────
   ARTWORK LOG
───────────────────────────────────────────── */
function awprev(e) {
  const f = e.target.files[0]; if(!f) return;
  awFile = f;
  const p = $('awprev'); if(!p) return;
  p.style.display = 'block';
  if (f.type.startsWith('image/')) p.innerHTML = `<img src="${URL.createObjectURL(f)}" style="max-height:68px;border-radius:6px;border:1px solid rgba(255,255,255,.1)"/>`;
  else p.innerHTML = `<div style="font-size:11px;color:#475569;padding:4px 0">📄 ${f.name}</div>`;
}

async function addAw() {
  const getVal = id => { const el=$(id); return el ? el.value.trim() : ''; };
  const desc = getVal('awdesc'); if(!desc){ toast('Description required','warn'); return; }
  const ver  = getVal('awv');
  const entry = ver ? `[${ver}] ${desc}` : desc;
  let furl = null;
  if (awFile) {
    toast('Uploading artwork…','info');
    const path = `artworks/${cid}/${Date.now()}_${awFile.name}`;
    const { error } = await sb.storage.from('diamond-vault').upload(path, awFile);
    if (!error) furl = sb.storage.from('diamond-vault').getPublicUrl(path).data.publicUrl;
  }
  await sb.from('activity_logs').insert([{ customer_id:cid, change_description:entry, log_type:'artwork', file_url:furl||null }]);
  const els = ['awv','awdesc']; els.forEach(id => { const el=$(id); if(el) el.value=''; });
  const awprevEl=$('awprev'); if(awprevEl){ awprevEl.style.display='none'; awprevEl.innerHTML=''; }
  const awfEl=$('awf-inp'); if(awfEl) awfEl.value='';
  awFile = null;
  toast('✔ Artwork logged');
  loadData();
  setTimeout(() => { ccust = custs.find(x => x.id===cid); loadAw(); }, 650);
}

function loadAw() {
  const logs = (ccust.activity_logs||[]).filter(l => l.log_type==='artwork');
  setTB('tb-a', logs.length);
  const awlistEl = $('awlist'); if(!awlistEl) return;
  if (!logs.length) { awlistEl.innerHTML='<div style="color:#334155;padding:14px 0;text-align:center;font-size:12px">No artwork events yet.</div>'; return; }
  awlistEl.innerHTML = logs.sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).map(l => {
    const isImg = l.file_url && /\.(jpg|jpeg|png|gif|webp)/i.test(l.file_url);
    const thumb = l.file_url ? (isImg ? `<img class="awthumb" src="${l.file_url}" onerror="this.style.display='none'" alt="artwork">` : `<div class="awph"><a href="${l.file_url}" target="_blank" style="color:#475569">📄</a></div>`) : `<div class="awph">🎨</div>`;
    return `<div class="awe">
      ${thumb}
      <div style="flex:1;min-width:0">
        <div class="awdt">🎨 ${new Date(l.created_at).toLocaleString()}</div>
        <div class="awt">${l.change_description}</div>
        ${l.file_url?`<a href="${l.file_url}" target="_blank" style="color:#d4af37;font-size:11px">View file →</a>`:''}
      </div>
    </div>`;
  }).join('');
}

/* ─────────────────────────────────────────────
   HISTORY
───────────────────────────────────────────── */
function loadHistory() {
  const logs = (ccust.activity_logs||[]).filter(l => l.log_type!=='artwork');
  setTB('tb-h', logs.length);
  const htlEl = $('htl'); if(!htlEl) return;
  if (!logs.length) { htlEl.innerHTML='<div style="color:#334155;font-size:12px">No history.</div>'; return; }
  htlEl.innerHTML = logs.sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).map(l => `
    <div class="tli"><div class="tldot"></div>
    <div class="tldate">${new Date(l.created_at).toLocaleString()}</div>
    <div class="tlcont">${l.change_description}</div></div>`).join('');
}

/* ─────────────────────────────────────────────
   VAULT
───────────────────────────────────────────── */
function updateVaultPreview(url) {
  const img = $('vault-preview-img'), ph = $('vault-no-image');
  if (!img || !ph) return;
  if (url) { img.src=url; img.style.display='block'; ph.style.display='none'; }
  else      { img.src=''; img.style.display='none';  ph.style.display='block'; }
}

function updateVaultSeal() {
  const vsEl   = $('vault-status');
  const sealEl = $('vault-seal');
  if (!vsEl || !sealEl) return;
  sealEl.style.display = vsEl.value==='Final Verified' ? 'flex' : 'none';
}

function onVaultStatusChange() {
  const vsEl = $('vault-status'), vtEl = $('vault-ts');
  if (!vsEl) return;
  if (vsEl.value==='Final Verified' && vtEl && !vtEl.value) {
    const nowIso = new Date().toISOString();
    vtEl.value           = new Date(nowIso).toLocaleString();
    vtEl.dataset.iso     = nowIso;
  }
  if (vsEl.value!=='Final Verified' && vtEl) { vtEl.value=''; vtEl.dataset.iso=''; }
  updateVaultSeal();
}

async function uploadVault(e) {
  const f = e.target.files[0]; if(!f) return;
  toast('Uploading…','info');
  const path = `${cid}/${Date.now()}_${f.name}`;
  const { error } = await sb.storage.from('diamond-vault').upload(path, f);
  if (error) { toast('Upload failed','warn'); return; }
  const publicUrl = sb.storage.from('diamond-vault').getPublicUrl(path).data.publicUrl;
  updateVaultPreview(publicUrl);
  if (ccust) ccust.vault_preview_url = publicUrl;
  toast('✔ Saved to Vault');
  loadVault();
}

async function loadVault() {
  const { data } = await sb.storage.from('diamond-vault').list(cid.toString());
  const files = (data||[]).filter(f => !f.name.startsWith('.'));
  setTB('tb-v', files.length);
  const imgFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f.name)).sort((a,b) => new Date(b.created_at||0)-new Date(a.created_at||0));
  if (imgFiles.length) {
    const purl = sb.storage.from('diamond-vault').getPublicUrl(`${cid}/${imgFiles[0].name}`).data.publicUrl;
    updateVaultPreview(purl);
    if (ccust) ccust.vault_preview_url = purl;
  } else {
    updateVaultPreview(ccust?.vault_preview_url||null);
  }
  updateVaultSeal();
  const vlistEl = $('vlist'); if(!vlistEl) return;
  if (!files.length) { vlistEl.innerHTML='<div style="color:#334155;text-align:center;padding:12px;font-size:12px">Vault is empty.</div>'; return; }
  vlistEl.innerHTML = files.map(f => {
    const url = sb.storage.from('diamond-vault').getPublicUrl(`${cid}/${f.name}`).data.publicUrl;
    return `<div class="vitem">
      <div style="font-size:13px;font-weight:600;color:#e2e8f0">📄 ${f.name}</div>
      <div style="display:flex;gap:6px">
        <a href="${url}" target="_blank" style="text-decoration:none;padding:4px 10px;font-size:11px;font-weight:600;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#94a3b8">View</a>
        <button onclick="delVF('${f.name}')" style="padding:4px 10px;font-size:11px;font-weight:600;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:5px;color:#f87171;cursor:pointer">Del</button>
      </div>
    </div>`;
  }).join('');
}

async function delVF(fn) {
  if (!confirm('Delete permanently?')) return;
  await sb.storage.from('diamond-vault').remove([`${cid}/${fn}`]);
  toast('✔ Removed');
  loadVault();
}

/* ─────────────────────────────────────────────
   ADD RECORD
───────────────────────────────────────────── */
function openAdd() {
  const addmodEl = $('addmod'); if(addmodEl) addmodEl.style.display='flex';
  setTimeout(() => { const anEl=$('an'); if(anEl) anEl.focus(); }, 80);
}
function closeAdd() { const addmodEl=$('addmod'); if(addmodEl) addmodEl.style.display='none'; }

async function confirmAdd() {
  const anEl = $('an'); if(!anEl) return;
  const n = anEl.value.trim();
  if (!n) { toast('Name required','warn'); return; }
  const aprodEl = $('aprod');
  await sb.from('Diamond crM').insert([{ name:n.toUpperCase(), product:aprodEl?aprodEl.value:'', status:'Inquiry' }]);
  toast('✔ Record created');
  loadData();
  closeAdd();
  if(anEl) anEl.value='';
  if(aprodEl) aprodEl.value='';
}

/* ─────────────────────────────────────────────
   AI — callGemini
───────────────────────────────────────────── */
async function callGemini(prompt) {
  const res = await fetch(EDGE_FN_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ prompt }) });
  if (res.status===401) return '⚠ Access Denied: Disable "Enforce JWT" in Supabase Function settings.';
  const d = await res.json();
  return d.reply || d.text || 'No response text found.';
}

/* ─────────────────────────────────────────────
   AI RISK REPORT
───────────────────────────────────────────── */
async function openRiskReport() {
  const rrmodEl = $('rrmod'); if(rrmodEl) rrmodEl.style.display='flex';
  const rrBody  = $('rr-body');
  if (rrBody) rrBody.innerHTML = '<div class="ai-loading"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div><span>Analysing pipeline…</span></div>';
  try {
    const staleCount = custs.filter(c => { const d=dsince(c.last_contact); return d===null||d>=7; }).length;
    let outTotal = 0;
    custs.forEach(c => (c.transactions||[]).forEach(t => { if(t.payment_status==='Outstanding') outTotal+=parseFloat(t.amount)||0; }));
    const overdue = [];
    custs.forEach(c => (c.logistics||[]).forEach(l => { const d=ddiff(l.eta); if(d!==null&&d<0) overdue.push(`${c.name} (${Math.abs(d)}d late)`); }));
    const prompt = `You are an executive analyst for Diamond International Lanka, a security printing and hologram import company in Sri Lanka. Identify the top 3 supply chain and financial risks and provide brief actionable recommendations.\n\nDATA:\n- Total accounts: ${custs.length}\n- Stale accounts (no contact 7+ days): ${staleCount}\n- Total outstanding: Rs. ${Math.round(outTotal).toLocaleString()}\n- Overdue shipments: ${overdue.length} (${overdue.slice(0,5).join(', ')||'none'})\n- Accounts in Artwork Approval: ${custs.filter(c=>c.status==='Artwork Approval').length}\n- Stage distribution: ${STAGES.map(s=>s+': '+custs.filter(c=>c.status===s).length).join(', ')}\n\nWrite exactly 3 risks, each with: title, 1-sentence explanation, 1 action. Under 250 words.`;
    const resp = await callGemini(prompt);
    if (rrBody) { rrBody.style.color='#cbd5e1'; rrBody.style.fontStyle='normal'; rrBody.textContent=resp; }
  } catch {
    if (rrBody) { rrBody.style.color='#475569'; rrBody.style.fontStyle='italic'; rrBody.textContent='⚠ AI is resting — Unable to generate report.'; }
  }
}

/* ─────────────────────────────────────────────
   AI EMAIL
───────────────────────────────────────────── */
function selTone(el, tone) {
  document.querySelectorAll('.tone-chip').forEach(c => c.classList.remove('sel'));
  if(el) el.classList.add('sel');
  emailTone = tone;
}

async function genEmail() {
  const getVal = id => { const el=$(id); return el ? el.value : ''; };
  const from = getVal('senderName'), to = getVal('recipientName'), extra = getVal('customInstructions');
  const out  = $('ai-email-out');
  if (!from||!to) { toast('Enter From and To names','warn'); return; }
  if (out) { out.className='mt-3 text-xs text-slate-400 min-h-[60px]'; out.innerHTML='<div class="ai-loading"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div><span>Drafting…</span></div>'; }
  const prompt = `You are a Senior Security Printing Consultant. Draft a professional email.\nSENDER: ${from}\nRECIPIENT: ${to}\nSTYLE/TONE: ${emailTone}\nSPECIFIC NEEDS: ${extra||'None'}\nCLIENT: ${ccust?.name||''}\nPRODUCT: ${ccust?.product||''}\nSTAGE: ${ccust?.status||''}\nNOTES: ${ccust?.notes||'None'}\nInclude Subject Line at top. Under 150 words. Sign: "The Diamond International Lanka Team"`;
  try {
    const resp = await callGemini(prompt);
    if(out) renderAIResponse(out, resp, true);
    const copyBtnEl = $('copy-btn'); if(copyBtnEl) copyBtnEl.style.display='block';
  } catch {
    if(out) { out.className='mt-3 text-xs text-slate-400 italic min-h-[60px]'; out.textContent='⚠ AI is resting.'; }
  }
}

function copyEmail() {
  const out = $('ai-email-out');
  if (!out) return;
  navigator.clipboard.writeText(out.textContent).then(() => toast('📋 Email copied','info'));
}

/* ─────────────────────────────────────────────
   AI CUSTOMER FINDER
───────────────────────────────────────────── */
async function runAIDiscovery() {
  const queryEl = $('aiSearchInput'), status = $('aiSearchStatus');
  if (!queryEl) return;
  const query = queryEl.value.trim();
  if (!query) { toast('Enter a search query','warn'); return; }
  if (status) { status.className='mt-2 text-[10px] text-slate-500'; status.textContent='✨ Scanning database…'; }
  const summary = custs.map(c => ({ id:String(c.id), name:c.name, status:c.status, product:c.product||'' }));
  const prompt  = `You are a Database Analyst. USER QUERY: "${query}". DATABASE: ${JSON.stringify(summary)}. Return ONLY a comma-separated list of matching customer IDs (numbers only). If no match, return NONE.`;
  try {
    const result = await callGemini(prompt);
    if (result.includes('NONE')||!result.trim()) {
      applyAIFilter([]);
      if(status) renderAIResponse(status,'**No customers matched** your search query.',true);
    } else {
      const ids = result.split(',').map(x => x.trim()).filter(Boolean);
      applyAIFilter(ids);
      if(status) renderAIResponse(status,`### Scan Complete\n- Found **${ids.length}** match${ids.length!==1?'es':''}.\n- Results are now highlighted in the table.`,true);
    }
  } catch {
    if(status) { status.className='mt-2 text-[10px] text-rose-400'; status.textContent='AI search failed.'; }
  }
}

function applyAIFilter(ids) {
  document.querySelectorAll('#tbody tr').forEach(row => {
    const rid = row.getAttribute('data-id');
    row.style.display = (!ids.length || ids.includes(rid)) ? '' : 'none';
  });
}

/* ─────────────────────────────────────────────
   MARKET PROSPECTOR
───────────────────────────────────────────── */
async function huntLeads() {
  const queryEl  = $('prospectQuery'), results = $('prospectResults');
  if (!queryEl) return;
  const query = queryEl.value.trim();
  if (!query) { toast('Enter a search term','warn'); return; }
  if (results) { results.className='mt-3 text-[11px] text-slate-500'; results.innerHTML='<div class="ai-loading"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div><span>Scouting market opportunities…</span></div>'; }
  const prompt = `Act as a B2B Sales Scout for a Security Printing company in Sri Lanka. Find 3 REAL potential client organisations for: "${query}". For each: 1. Name, 2. Why they need security printing, 3. One-sentence pitch. Format as HTML list items (<li>) only.`;
  try {
    const resp = await callGemini(prompt);
    if(results) renderAIResponse(results, resp, true);
  } catch {
    if(results) { results.className='mt-3 text-[11px] text-rose-400'; results.textContent='Connection error.'; }
  }
}

/* ─────────────────────────────────────────────
   ANALYTICS — EXECUTIVE DASHBOARD SYNC
───────────────────────────────────────────── */
function syncDashboard() {
  const eo = $('executive-overview');
  if (!eo || !custs) return;
  const activeCusts = (custs||[]).filter(c => isActivePipelineStage(c.status));

  const stats = eo.querySelectorAll('.mt-6.grid .text-2xl');
  if (stats.length >= 4) {
    stats[0].textContent = activeCusts.length;
    const kcyEl=$('kc-y'); stats[1].textContent = kcyEl ? kcyEl.textContent : '—';
    const kcoEl=$('kc-o'); stats[2].textContent = kcoEl ? kcoEl.textContent : '—';
    const won = activeCusts.filter(c => c.status==='Production (PI)'||c.status==='Artwork Approval').length;
    stats[3].textContent = (activeCusts.length ? Math.round((won/activeCusts.length)*100) : 0) + '%';
  }

  const pipelineStages = [
    'Inquiry', 'Quoted', 'PO Received', 
    'Artwork Approval', 'Serial Number Approval', 
    'Production (PI)', 'Delivered', 'Closed'
  ];
  const stageAverages  = pipelineStages.map(stage => {
    const rows = activeCusts.filter(c => c.status===stage);
    if (!rows.length) return 0;
    return rows.reduce((sum,c) => sum + ageInDays(getCustomerStageReferenceDate(c)), 0) / rows.length;
  });
  const maxVelocity = Math.max(...stageAverages, 1);
  const bars  = eo.querySelectorAll('.space-y-3 .bar-gold');
  const texts = eo.querySelectorAll('.space-y-3 .text-navy');
  
  /* UPDATE FROM 5 TO 8 */
  if (bars.length===8 && texts.length===8) {
    stageAverages.forEach((avg,i) => {
      bars[i].style.width    = (avg>0 ? Math.max((avg/maxVelocity)*100,8) : 0) + '%';
      texts[i].textContent   = `${Math.round(avg)}d`;
    });
  }

  const exposureData  = activeCusts.map(c => ({ name:c.name||'Unnamed', value:getCustomerValue(c) })).filter(c => c.value>0).sort((a,b) => b.value-a.value).slice(0,5);
  const exposureTotal = exposureData.reduce((sum,c) => sum+toNum(c.value), 0);
  const riskCols = eo.querySelectorAll('.h-40 > div');
  if (riskCols.length >= 5) {
    const maxRisk = exposureData.length ? Math.max(...exposureData.map(d => d.value)) : 1;
    for (let i=0; i<5; i++) {
      const col = riskCols[i];
      const bar = col.querySelector('.bar-gold-vertical'), amtText = col.querySelector('.text-gold'), nameText = col.querySelector('.text-slate-400');
      if (bar&&amtText&&nameText) {
        if (exposureData[i]) { bar.style.height=Math.max((exposureData[i].value/maxRisk)*100,12)+'%'; amtText.textContent=fmtRs(exposureData[i].value); nameText.innerHTML=exposureData[i].name.substring(0,10); col.style.opacity='1'; }
        else { bar.style.height='4%'; amtText.textContent='Rs. 0'; nameText.innerHTML='—'; col.style.opacity='0.3'; }
      }
    }
    const totalOutText = eo.querySelector('.text-red-400.font-semibold');
    if (totalOutText) totalOutText.textContent = fmtRs(exposureTotal);
  }

  const productGroups = { Holograms:0, Certificates:0, Other:0 };
  (custs||[]).forEach(c => {
    const label = String(getCustomerProductLabel(c)||'Other').toLowerCase();
    if (label.includes('holo')) productGroups.Holograms++;
    else if (label.includes('cert')) productGroups.Certificates++;
    else productGroups.Other++;
  });
  const productTotal = productGroups.Holograms + productGroups.Certificates + productGroups.Other;
  const ptEl = eo.querySelector('#productBreakdownTotal'); if(ptEl) ptEl.textContent = String(productTotal);
  const holoPct  = productTotal ? Math.round((productGroups.Holograms/productTotal)*100) : 0;
  const certPct  = productTotal ? Math.round((productGroups.Certificates/productTotal)*100) : 0;
  const otherPct = Math.max(0, 100-holoPct-certPct);
  const legendRows = eo.querySelectorAll('.glass-card:last-child .w-full.space-y-2 > div');
  if (legendRows.length>=3) {
    legendRows[0].querySelector('.text-gold').textContent  = `${holoPct}%`;
    legendRows[0].querySelector('.text-slate-500').textContent = String(productGroups.Holograms);
    legendRows[1].querySelector('.text-gold').textContent  = `${certPct}%`;
    legendRows[1].querySelector('.text-slate-500').textContent = String(productGroups.Certificates);
    legendRows[2].querySelector('.text-gold').textContent  = `${otherPct}%`;
    legendRows[2].querySelector('.text-slate-500').textContent = String(productGroups.Other);
  }
}

/* ─────────────────────────────────────────────
   ANALYTICS — updateDashboard (chart instances)
───────────────────────────────────────────── */
function updateDashboard(customers) {
  if (!customers || !customers.length) return;
  
  const fmtRsLocal = v => { 
    if(v>=1e6) return `Rs. ${(v/1e6).toFixed(2)}M`; 
    if(v>=1e3) return `Rs. ${(v/1e3).toFixed(1)}K`; 
    return `Rs. ${Math.round(v).toLocaleString()}`; 
  };
  const daysSince = ds => { 
    if(!ds) return 0; 
    const diff = Date.now() - new Date(ds).getTime(); 
    return Math.max(0, Math.floor(diff/86400000)); 
  };

  /* UPDATE CONSTANTS TO INCLUDE DELIVERED STAGE */
  const ACTIVE_STAGES = ['Inquiry','Quoted','PO Received','Artwork Approval','Serial Number Approval','Production (PI)', 'Delivered', 'Closed'];
  const STAGE_COLORS  = ['#64748b','#f59e0b','#3b82f6','#a78bfa','#ef4444','#22c55e','#06b6d4','#475569'];

  /* exposure bar chart */
  const exposureByStage = ACTIVE_STAGES.map(stage => customers.filter(c => c.status===stage).reduce((sum,c) => sum+getCustomerValue(c), 0));
  const expCanvas = $('exposureChart');
  if (expCanvas && typeof Chart !== 'undefined') {
    if (exposureChart) { exposureChart.destroy(); exposureChart=null; }
    exposureChart = new Chart(expCanvas.getContext('2d'), { 
      type:'bar', 
      data:{ 
        labels:ACTIVE_STAGES.map(s => s.length > 12 ? s.split(' ')[0] : s), 
        datasets:[{ label:'Credit Exposure (Rs.)', data:exposureByStage, backgroundColor:STAGE_COLORS, borderRadius:6, borderSkipped:false }] 
      }, 
      options:{ 
        responsive:true, maintainAspectRatio:false, 
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${fmtRsLocal(ctx.raw)}`}} }, 
        scales:{ 
          x:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'rgba(255,255,255,0.05)'}}, 
          y:{beginAtZero:true,ticks:{color:'#64748b',font:{size:10},callback:v=>fmtRsLocal(v)},grid:{color:'rgba(255,255,255,0.05)'}} 
        } 
      } 
    });
  }

  /* product doughnut chart */
  const productCounts = {}; 
  customers.forEach(c => { 
    const label = (c.product_type||c.product||'Other').trim()||'Other'; 
    productCounts[label] = (productCounts[label]||0)+1; 
  });
  
  const productLabels = Object.keys(productCounts);
  const productValues = productLabels.map(l => productCounts[l]);
  const productTotal  = productValues.reduce((a,b) => a+b, 0);
  
  const ptEl2 = $('productBreakdownTotal'); 
  if(ptEl2) ptEl2.textContent = String(productTotal);
  
  const prodCanvas = $('productChart');
  if (prodCanvas && typeof Chart !== 'undefined') {
    if (productChart) { productChart.destroy(); productChart=null; }
    productChart = new Chart(prodCanvas.getContext('2d'), { 
      type:'doughnut', 
      data:{ 
        labels:productLabels, 
        datasets:[{ data:productValues, backgroundColor:productLabels.map(l=>getProductThemeColor(l)), borderWidth:0, hoverOffset:6 }] 
      }, 
      options:{ 
        responsive:true, maintainAspectRatio:false, cutout:'72%', 
        plugins:{ 
          legend:{display:false}, 
          tooltip:{callbacks:{label:ctx=>{ const pct=productTotal?Math.round((ctx.raw/productTotal)*100):0; return ` ${ctx.label}: ${ctx.raw} (${pct}%)`; }}} 
        } 
      } 
    });
  }

  /* velocity line chart */
  const velocityData = ACTIVE_STAGES.map(stage => { 
    const rows = customers.filter(c => c.status===stage && getCustomerStageReferenceDate(c)); 
    if(!rows.length) return 0; 
    return Math.round(rows.reduce((sum,c) => sum+daysSince(getCustomerStageReferenceDate(c)),0) / rows.length); 
  });
  
  const velCanvas = $('velocityChart');
  if (velCanvas && typeof Chart !== 'undefined') {
    if (velocityChart) { velocityChart.destroy(); velocityChart=null; }
    velocityChart = new Chart(velCanvas.getContext('2d'), { 
      type:'line', 
      data:{ 
        labels:ACTIVE_STAGES.map(s => s.length > 10 ? s.split(' ')[0] : s), 
        datasets:[{ label:'Avg Days in Stage', data:velocityData, borderColor:'#d4af37', backgroundColor:'rgba(212,175,55,0.08)', pointBackgroundColor:'#d4af37', pointRadius:5, tension:.35, fill:true }] 
      }, 
      options:{ 
        responsive:true, maintainAspectRatio:false, 
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${ctx.raw} days avg`}} }, 
        scales:{ 
          x:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}}, 
          y:{beginAtZero:true,ticks:{color:'#64748b',font:{size:10},callback:v=>`${v}d`},grid:{color:'rgba(255,255,255,0.04)'}} 
        } 
      } 
    });
  }
}

function updateAnalytics(customersParam) {
  const customers = customersParam || custs || [];
  updateDashboard(customers);
  try { syncDashboard(); } catch(e) { console.warn('syncDashboard failed', e); }
}

function refreshAnalytics() { updateAnalytics(); }

/* ─────────────────────────────────────────────
   TIER 1 CHARTS
───────────────────────────────────────────── */
function renderTier1Charts() {
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color       = '#64748b';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.font.size   = 11;
  }
  renderRevenueWaterfallChart();
  renderArtworkCycleChart();
  renderSupplierOnTimeChart();
  renderLCFunnelChart();
  renderSNHeatmapChart();
  renderStageAgeChart();
}

function setTier1Placeholder(baseId, show) {
  const canvas = $(baseId);
  const empty  = $(`${baseId}-empty`);
  if (canvas) canvas.style.display = show ? 'none' : 'block';
  if (empty)  { empty.style.display=show?'flex':'none'; empty.classList.toggle('hidden',!show); }
}

function destroyChartIfExists(canvasId) {
  if (typeof Chart==='undefined') return;
  const existing = Chart.getChart(canvasId);
  if (existing) existing.destroy();
}

function tier1Pill(text, tone='slate') {
  const tones = { slate:'bg-navy-900/70 text-slate-300 border-white/5', green:'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', red:'bg-red-500/10 text-red-300 border-red-500/20', gold:'bg-gold-500/10 text-gold-400 border-gold-500/20', blue:'bg-sky-500/10 text-sky-300 border-sky-500/20' };
  return `<span class="px-3 py-1.5 text-xs font-semibold rounded-full border ${tones[tone]||tones.slate}">${text}</span>`;
}

function renderArtworkCycleChart() {
  try {
    const rows = (custs||[]).map(c => {
      const logs = (c.activity_logs||[]).filter(l => String(l.log_type||'').toLowerCase()==='artwork'&&parseDateSafe(l.created_at)).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
      if (!logs.length) return null;
      const start = new Date(logs[0].created_at), end = logs.length>1 ? new Date(logs[logs.length-1].created_at) : new Date();
      return { name:c.name||'Unnamed', days:Math.max(0,Math.ceil((end-start)/86400000)) };
    }).filter(Boolean).sort((a,b) => b.days-a.days).slice(0,8);
    destroyChartIfExists('artworkCycleChart');
    if (!rows.length) { setTier1Placeholder('artworkCycleChart',true); return; }
    setTier1Placeholder('artworkCycleChart',false);
    const thresholdPlugin = { id:'artworkCycleThreshold', afterDraw(chart){ const {ctx,chartArea:{top,bottom},scales:{x}}=chart; const xPos=x.getPixelForValue(10); ctx.save(); ctx.strokeStyle='#ef4444'; ctx.lineWidth=1; ctx.setLineDash([5,4]); ctx.beginPath(); ctx.moveTo(xPos,top); ctx.lineTo(xPos,bottom); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle='#ef4444'; ctx.font='11px Inter, system-ui, sans-serif'; ctx.fillText('10d threshold',Math.min(xPos+6,chart.width-85),top+12); ctx.restore(); } };
    const valuePlugin    = { id:'artworkCycleLabels', afterDatasetsDraw(chart){ const {ctx}=chart; const meta=chart.getDatasetMeta(0); ctx.save(); ctx.fillStyle='#cbd5e1'; ctx.font='11px Inter, system-ui, sans-serif'; ctx.textBaseline='middle'; meta.data.forEach((bar,index)=>{ ctx.fillText(`${rows[index].days}d`,bar.x+8,bar.y); }); ctx.restore(); } };
    const canvasEl = $('artworkCycleChart'); if(!canvasEl) return;
    new Chart(canvasEl.getContext('2d'), { type:'bar', data:{ labels:rows.map(r=>r.name), datasets:[{ data:rows.map(r=>r.days), borderRadius:8, borderSkipped:false, backgroundColor:rows.map(r=>r.days<10?'#22c55e':r.days<=20?'#f59e0b':'#ef4444') }] }, options:{ indexAxis:'y', maintainAspectRatio:false, layout:{padding:{right:36}}, plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw} days`}}}, scales:{x:{beginAtZero:true,suggestedMax:30,ticks:{callback:v=>`${v}d`}},y:{grid:{display:false}}} }, plugins:[thresholdPlugin,valuePlugin] });
  } catch(err) { console.error('renderArtworkCycleChart failed',err); setTier1Placeholder('artworkCycleChart',true); }
}

function renderSupplierOnTimeChart() {
  try {
    const allLogistics = (custs||[]).flatMap(c => (c.logistics||[]).map(l => ({...l,customer_name:c.name||'Unnamed'})));
    const statsHost = $('supplierOnTimeStats'); if(statsHost) statsHost.innerHTML='';
    destroyChartIfExists('supplierOnTimeChart');
    if (!allLogistics.length) { setTier1Placeholder('supplierOnTimeChart',true); return; }
    const supplierMap = {}; let overdueNow=0,totalDelay=0,delayedCount=0,onTimeCount=0;
    allLogistics.forEach(l => {
      const supplier = (l.supplier||'Unknown').trim()||'Unknown';
      const etaDiff  = ddiff(l.eta);
      const completionDate = l.completed_at||l.updated_at||l.created_at;
      const completedOnTime = String(l.lc_status||'')==='Completed' && l.eta && sameOrBeforeDate(completionDate,l.eta);
      const currentlyOnTime = etaDiff!==null && etaDiff>=0;
      const isOnTime = completedOnTime || (String(l.lc_status||'')!=='Completed' && currentlyOnTime);
      supplierMap[supplier] = supplierMap[supplier]||{onTime:0,total:0};
      supplierMap[supplier].total+=1;
      if (isOnTime) { supplierMap[supplier].onTime+=1; onTimeCount++; }
      if (String(l.lc_status||'')!=='Completed' && etaDiff!==null && etaDiff<0) { overdueNow++; totalDelay+=Math.abs(etaDiff); delayedCount++; }
    });
    const rows = Object.entries(supplierMap).map(([supplier,data]) => ({ supplier, onTime:Math.round((data.onTime/data.total)*100), overdue:Math.round(((data.total-data.onTime)/data.total)*100), total:data.total })).sort((a,b)=>b.total-a.total).slice(0,5);
    if (!rows.length) { setTier1Placeholder('supplierOnTimeChart',true); return; }
    setTier1Placeholder('supplierOnTimeChart',false);
    if (statsHost) { const avgDelay=delayedCount?Math.round(totalDelay/delayedCount):0; statsHost.innerHTML=[tier1Pill(`${overdueNow} overdue now`,overdueNow?'red':'slate'),tier1Pill(`${avgDelay}d avg delay`,avgDelay?'gold':'slate'),tier1Pill(`${onTimeCount} on time`,onTimeCount?'green':'slate')].join(''); }
    const canvasEl = $('supplierOnTimeChart'); if(!canvasEl) return;
    new Chart(canvasEl.getContext('2d'), { type:'bar', data:{ labels:rows.map(r=>r.supplier), datasets:[{label:'On-time %',data:rows.map(r=>r.onTime),backgroundColor:'#22c55e',borderRadius:6,borderSkipped:false},{label:'Overdue %',data:rows.map(r=>r.overdue),backgroundColor:'#ef4444',borderRadius:6,borderSkipped:false}] }, options:{ indexAxis:'y', maintainAspectRatio:false, plugins:{legend:{position:'bottom'}}, scales:{x:{beginAtZero:true,max:100,ticks:{callback:v=>`${v}%`}},y:{grid:{display:false}}} } });
  } catch(err) { console.error('renderSupplierOnTimeChart failed',err); setTier1Placeholder('supplierOnTimeChart',true); const sh=$('supplierOnTimeStats'); if(sh) sh.innerHTML=''; }
}

function renderLCFunnelChart() {
  try {
    const logistics = (custs||[]).flatMap(c => c.logistics||[]);
    const statsHost = $('lcFunnelStats'); if(statsHost) statsHost.innerHTML='';
    destroyChartIfExists('lcFunnelChart');
    if (!logistics.length) { setTier1Placeholder('lcFunnelChart',true); return; }
    const lcSteps = ['Draft PI Received','LC Opened','TT Paid','In Clearing','Completed'];
    const activeSteps = lcSteps.filter(s => s!=='Completed');
    const counts = Object.fromEntries(lcSteps.map(step=>[step,0]));
    logistics.forEach(l => { if(counts[l.lc_status]!==undefined) counts[l.lc_status]++; });
    const completedCount = counts.Completed||0;
    const now = new Date();
    const completedThisMonth = logistics.filter(l => { if(String(l.lc_status||'')!=='Completed') return false; const d=parseDateSafe(l.completed_at||l.updated_at||l.created_at); return d&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); }).length;
    const overdueEta = logistics.filter(l => String(l.lc_status||'')!=='Completed'&&ddiff(l.eta)!==null&&ddiff(l.eta)<0).length;
    const activeTotal = activeSteps.reduce((sum,step)=>sum+(counts[step]||0),0);
    const funnelRows  = activeSteps.map(step => counts[step]||0);
    if (!funnelRows.some(Boolean)&&!completedCount) { setTier1Placeholder('lcFunnelChart',true); return; }
    setTier1Placeholder('lcFunnelChart',false);
    if (statsHost) statsHost.innerHTML=[tier1Pill(`${activeTotal} total active`,activeTotal?'blue':'slate'),tier1Pill(`${completedThisMonth} completed this month`,completedThisMonth?'green':'slate'),tier1Pill(`${overdueEta} overdue ETA`,overdueEta?'red':'slate'),tier1Pill(`${completedCount} done`,completedCount?'gold':'slate')].join('');
    const funnelLabelPlugin = { id:'lcFunnelLabels', afterDatasetsDraw(chart){ const {ctx}=chart; const meta=chart.getDatasetMeta(0); ctx.save(); ctx.fillStyle='#e2e8f0'; ctx.font='11px Inter, system-ui, sans-serif'; ctx.textBaseline='middle'; meta.data.forEach((bar,index)=>{ const value=funnelRows[index]; if(value>0){ const text=String(value); const insideX=bar.x-ctx.measureText(text).width-8; const x=insideX>bar.base+6?insideX:bar.x+8; ctx.fillText(text,x,bar.y); } }); ctx.restore(); } };
    const canvasEl = $('lcFunnelChart'); if(!canvasEl) return;
    new Chart(canvasEl.getContext('2d'), { type:'bar', data:{ labels:activeSteps, datasets:[{ data:funnelRows, borderRadius:8, borderSkipped:false, backgroundColor:['#bfdbfe','#93c5fd','#60a5fa','#3b82f6'].slice(0,activeSteps.length) }] }, options:{ indexAxis:'y', maintainAspectRatio:false, layout:{padding:{right:28}}, plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw} LCs`}}}, scales:{x:{beginAtZero:true,grace:'10%'},y:{grid:{display:false}}} }, plugins:[funnelLabelPlugin] });
  } catch(err) { console.error('renderLCFunnelChart failed',err); setTier1Placeholder('lcFunnelChart',true); const sh=$('lcFunnelStats'); if(sh) sh.innerHTML=''; }
}

function renderRevenueWaterfallChart() {
  try {
    destroyChartIfExists('revenueWaterfallChart');
    const months=[]; const now=new Date();
    for(let i=11;i>=0;i--) months.push(new Date(now.getFullYear(),now.getMonth()-i,1));
    const received=new Map(months.map(d=>[`${d.getFullYear()}-${d.getMonth()}`,0]));
    const outstanding=new Map(months.map(d=>[`${d.getFullYear()}-${d.getMonth()}`,0]));
    (custs||[]).forEach(c => (c.transactions||[]).forEach(t => {
      const d=parseDateSafe(t.order_date); if(!d) return;
      const key=`${d.getFullYear()}-${d.getMonth()}`; if(!received.has(key)) return;
      const amt=toNum(t.amount);
      if(String(t.payment_status||'')==='Received')    received.set(key,received.get(key)+amt);
      if(String(t.payment_status||'')==='Outstanding') outstanding.set(key,outstanding.get(key)+amt);
    }));
    const revenueData    = months.map(d=>received.get(`${d.getFullYear()}-${d.getMonth()}`)||0);
    const outstandingData= months.map(d=>outstanding.get(`${d.getFullYear()}-${d.getMonth()}`)||0);
    if (!revenueData.some(Boolean)&&!outstandingData.some(Boolean)) { setTier1Placeholder('revenueWaterfallChart',true); return; }
    setTier1Placeholder('revenueWaterfallChart',false);
    const canvasEl=$('revenueWaterfallChart'); if(!canvasEl) return;
    new Chart(canvasEl.getContext('2d'),{ type:'bar', data:{ labels:months.map(d=>d.toLocaleString('en-US',{month:'short'})), datasets:[{type:'bar',label:'Received Revenue',data:revenueData,backgroundColor:'#d4af37',borderRadius:6,borderSkipped:false},{type:'line',label:'Outstanding Balance',data:outstandingData,borderColor:'#ef4444',backgroundColor:'#ef4444',pointBackgroundColor:'#ef4444',pointRadius:4,tension:.3,yAxisID:'y1'}] }, options:{ maintainAspectRatio:false, plugins:{legend:{position:'bottom'}}, scales:{ x:{grid:{display:false}}, y:{beginAtZero:true,ticks:{callback:v=>fmtK(v)}}, y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>fmtK(v)}} } } });
  } catch(err) { console.error('renderRevenueWaterfallChart failed',err); setTier1Placeholder('revenueWaterfallChart',true); }
}

function renderSNHeatmapChart() {
  try {
    const host     = $('snHeatmapChart'),  statsHost = $('snHeatmapStats'), badge=$('snConflictBadge');
    if(host)      host.innerHTML='';
    if(statsHost) statsHost.innerHTML='';
    if(badge)     badge.classList.add('hidden');

    const txs = (custs||[]).flatMap(c=>(c.transactions||[]).map(t=>({...t,customer_id:t.customer_id||c.id,customer_name:c.name||'Unnamed'}))).filter(t=>t.start_serial_no!==null&&t.start_serial_no!==undefined&&t.start_serial_no!=='');
    if (!txs.length) { if(host) host.innerHTML='<div class="text-sm text-slate-500 text-center py-10">No data yet</div>'; return; }

    const endOfToday = new Date(); endOfToday.setHours(0,0,0,0);
    const dates=[]; for(let i=69;i>=0;i--){ const d=new Date(endOfToday); d.setDate(d.getDate()-i); dates.push(d); }
    const counts={};
    txs.forEach(t=>{ const d=parseDateSafe(t.order_date); if(!d) return; const key=d.toISOString().slice(0,10); counts[key]=(counts[key]||0)+1; });

    const byCustomer={};
    txs.forEach(t=>{ const cidK=t.customer_id||'unknown'; byCustomer[cidK]=byCustomer[cidK]||[]; const start=Number(t.start_serial_no),end=Number(t.end_serial_no??t.start_serial_no); if(Number.isFinite(start)&&Number.isFinite(end)) byCustomer[cidK].push({customer_name:t.customer_name||'Unnamed',product:t.product||'—',order_date:t.order_date||'—',start:Math.min(start,end),end:Math.max(start,end)}); });

    snConflictCache=[];
    Object.values(byCustomer).forEach(list=>{ const sorted=list.sort((a,b)=>a.start-b.start); for(let i=0;i<sorted.length;i++){ for(let j=i+1;j<sorted.length;j++){ if(sorted[j].start>sorted[i].end) break; if(sorted[i].start<=sorted[j].end&&sorted[j].start<=sorted[i].end) snConflictCache.push({customer_name:sorted[i].customer_name,first:sorted[i],second:sorted[j]}); } } });

    const totalSerials=txs.reduce((sum,t)=>{ const start=Number(t.start_serial_no),end=Number(t.end_serial_no??t.start_serial_no); return Number.isFinite(start)&&Number.isFinite(end)?sum+(Math.abs(end-start)+1):sum; },0);

    const cells=dates.map(d=>{ const key=d.toISOString().slice(0,10); const count=counts[key]||0; const color=count===0?'rgba(255,255,255,0.04)':count===1?'rgba(212,175,55,0.2)':count<=3?'rgba(212,175,55,0.5)':'#d4af37'; return `<div title="${key}: ${count} batches" style="width:18px;height:18px;border-radius:3px;background:${color};border:1px solid rgba(255,255,255,0.03)"></div>`; }).join('');

    if(host) host.innerHTML=`<div class="inline-flex flex-col items-center gap-3"><div class="grid" style="grid-template-columns:repeat(10,18px);grid-template-rows:repeat(7,18px);gap:3px">${cells}</div><div class="flex items-center gap-2 text-[11px] text-slate-500"><span>Less</span><span style="width:18px;height:18px;border-radius:3px;background:rgba(255,255,255,0.04)"></span><span style="width:18px;height:18px;border-radius:3px;background:rgba(212,175,55,0.2)"></span><span style="width:18px;height:18px;border-radius:3px;background:rgba(212,175,55,0.5)"></span><span style="width:18px;height:18px;border-radius:3px;background:#d4af37"></span><span>More</span></div></div>`;
    if(statsHost) statsHost.innerHTML=[tier1Pill(`Total S/Ns logged: ${totalSerials.toLocaleString()}`,totalSerials?'gold':'slate'),tier1Pill(`Active batches: ${txs.length}`,txs.length?'blue':'slate'),tier1Pill(`Conflicts detected: ${snConflictCache.length}`,snConflictCache.length?'red':'slate')].join('');
    if(badge&&snConflictCache.length){ badge.textContent=`⚠ ${snConflictCache.length} S/N Conflicts Detected`; badge.classList.remove('hidden'); }
  } catch(err) { console.error('renderSNHeatmapChart failed',err); const host=$('snHeatmapChart'); if(host) host.innerHTML='<div class="text-sm text-slate-500 text-center py-10">No data yet</div>'; }
}

function renderStageAgeChart() {
  try {
    const points=(custs||[]).map(c=>({x:STAGES.indexOf(c.status),y:Math.round(ageInDays(c.created_at)),name:c.name||'Unnamed',stage:c.status||'Unknown'})).filter(p=>p.x>=0);
    destroyChartIfExists('stageAgeChart');
    if (!points.length) { setTier1Placeholder('stageAgeChart',true); return; }
    setTier1Placeholder('stageAgeChart',false);
    const thresholdPlugin={ id:'stageAgeThreshold', afterDraw(chart){ const{ctx,chartArea:{left,right,top},scales:{y}}=chart; const yPos=y.getPixelForValue(30); ctx.save(); ctx.strokeStyle='#ef4444'; ctx.lineWidth=1; ctx.setLineDash([6,4]); ctx.beginPath(); ctx.moveTo(left,yPos); ctx.lineTo(right,yPos); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle='#ef4444'; ctx.font='11px Inter, system-ui, sans-serif'; ctx.fillText('30d threshold',right-86,Math.max(yPos-8,top+12)); ctx.restore(); } };
    const canvasEl=$('stageAgeChart'); if(!canvasEl) return;
    new Chart(canvasEl.getContext('2d'),{ type:'scatter', data:{ datasets:[{ data:points, pointRadius:6, pointBackgroundColor:points.map(p=>p.y<14?'#22c55e':p.y<=30?'#f59e0b':'#ef4444'), pointBorderWidth:0 }] }, options:{ maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{callbacks:{ title(items){return items[0]?.raw?.name||'';}, label(ctx){const raw=ctx.raw||{};return `${raw.stage} · ${raw.y}d in pipeline`;} }} }, scales:{ x:{min:-0.5,max:Math.max(STAGES.length-0.5,4.5),ticks:{stepSize:1,callback:v=>SLBLS[v]||''}}, y:{beginAtZero:true,ticks:{callback:v=>`${v}d`}} } }, plugins:[thresholdPlugin] });
  } catch(err) { console.error('renderStageAgeChart failed',err); setTier1Placeholder('stageAgeChart',true); }
}

/* ─────────────────────────────────────────────
   S/N CONFLICT MODAL
───────────────────────────────────────────── */
function showSNConflicts() {
  const existing = $('sn-conflict-modal'); if(existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'sn-conflict-modal'; overlay.className = 'modal-ovl'; overlay.style.display='flex';
  const items = (snConflictCache||[]).map((entry,idx) => `<div class="border border-red-500/20 rounded-xl p-4 bg-navy-900/60"><p class="text-sm font-semibold text-white">${idx+1}. ${entry.customer_name}</p><p class="text-xs text-slate-400 mt-2">Range A: ${entry.first.start.toLocaleString()} - ${entry.first.end.toLocaleString()} · ${entry.first.product} · ${entry.first.order_date}</p><p class="text-xs text-slate-400 mt-1">Range B: ${entry.second.start.toLocaleString()} - ${entry.second.end.toLocaleString()} · ${entry.second.product} · ${entry.second.order_date}</p></div>`).join('');
  overlay.innerHTML = `<div class="rr-modal" style="max-width:760px;max-height:85vh;overflow-y:auto"><div class="flex items-start justify-between gap-4 mb-4"><div><p class="text-[10px] font-bold tracking-widest text-red-400 uppercase">Serial Number Risk</p><h3 class="text-xl font-bold text-white mt-1">Overlapping S/N Batches</h3><p class="text-sm text-slate-400 mt-2">${snConflictCache.length} overlap${snConflictCache.length===1?'':'s'} detected.</p></div><button type="button" onclick="document.getElementById('sn-conflict-modal')?.remove()" class="px-3 py-1.5 text-xs font-medium text-slate-400 border border-slate-600 rounded hover:bg-slate-700/50">Close</button></div><div class="space-y-3">${items||'<div class="text-sm text-slate-500 text-center py-6">No conflicts detected.</div>'}</div></div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
function init() {
  initTheme();
  initExecutiveDashboardCollapse();
  initTableDensity();
  loadPipelineStages();
  checkAuth();
}

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.addEventListener('load', () => {
  if (!window.crmStages || !window.crmStages.length) loadPipelineStages();
});
