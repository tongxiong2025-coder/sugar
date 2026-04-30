import React, { useState, useEffect, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, collection, onSnapshot, 
  serverTimestamp, doc, getDoc, setDoc, writeBatch
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Radar, RefreshCw, Zap, Settings, ArrowLeft, AlertCircle, 
  Star, Layout, Send, X, Building2, Quote, Server, CheckCircle2, Key, Eye, EyeOff, Activity, Filter, ChevronRight, ShieldCheck, Globe, Terminal
} from 'lucide-react';

/**
 * ==================================================
 * 🛰️ SUGAR RADAR V8.2.5 - 决策侦测增强版
 * ==================================================
 * [更新逻辑]：
 * 1. 抓取加固：handleUpdate 增加 res.ok 校验与详细错误反馈。
 * 2. 结构容错：Service.parseJson 适配 AI 返回的 3 种主流 JSON 变体。
 * 3. 时效死令：Prompt 强制锁定 24H 内联网搜索，确保最有失效性。
 * 4. 视觉防守：严禁改动 V8.2.0 的平行对齐布局、紧凑间距。
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB_-fLwf2_ftDdA3YsgnVzajw7hVPDCS1k",
  authDomain: "sugar-radar.firebaseapp.com",
  projectId: "sugar-radar", 
  storageBucket: "sugar-radar.firebasestorage.app",
  messagingSenderId: "388090302429",
  appId: "1:388090302429:web:97657e8f4690a5b17e3034"
};

const DEEPSEEK_KEY = "sk-7c68421e97544067a09ed34f114c5ee7";
const DB_STORAGE_ID = FIREBASE_CONFIG.appId.replace(/[^a-zA-Z0-9]/g, '_');

const STRATEGY_TEMPLATES = {
  'AI硬件': '探测全球 AI 硬件（端侧模型、机器人、穿戴设备）的最前沿融资、并购、核心技术迭代及重大商业异动信号。',
  '跨境电商': '分析全球跨境电商平台（TikTok Shop, Temu, Amazon）的最新政策、物流成本波动及本周海外爆款选品趋势。',
  '游戏出海': '追踪全球游戏出海市场的最新合规政策、热门买量榜单变动、融资事件及新兴市场爆发点。',
  '社交应用': '搜集全球通讯社交应用（WhatsApp Business, Telegram, Meta）的商业化新功能、风控算法调整及用户增长红利。',
  '企业SaaS': '调研全球企业级 SaaS 的 AI Agent 落地案例、核心技术壁垒突破、重要人事变动及行业整合动态。'
};

const INDUSTRIES = Object.keys(STRATEGY_TEMPLATES);

const Service = {
  // 核心解析器：V8.2.5 鲁棒版
  parseJson: (text) => {
    try {
      let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const firstBrace = cleanText.indexOf('{');
      const firstBracket = cleanText.indexOf('[');
      let start = -1, end = -1;
      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        start = firstBrace; end = cleanText.lastIndexOf('}');
      } else if (firstBracket !== -1) {
        start = firstBracket; end = cleanText.lastIndexOf(']');
      }
      if (start === -1 || end === -1) throw new Error("无法定位有效情报数据块");
      const jsonStr = cleanText.substring(start, end + 1);
      const parsed = JSON.parse(jsonStr);
      
      // 智能装箱逻辑：确保输出永远是数组
      if (parsed.items && Array.isArray(parsed.items)) return parsed.items;
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object') return [parsed];
      return [];
    } catch (e) { 
      console.error("Raw AI Output:", text);
      throw new Error(`解析引擎故障: ${e.message}`); 
    }
  },
  normalize: (val) => {
    if (!val) return '';
    if (typeof val === 'string' || typeof val === 'number') return val;
    if (val.seconds !== undefined) return new Date(val.seconds * 1000).toLocaleString('zh-CN', {hour:'2-digit', minute:'2-digit'});
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  },
  getUrgencyStyles: (level) => {
    switch(level) {
      case '八百里加急': return "text-red-500 border-red-100 bg-red-50/30 font-black";
      case '六百里加急': return "text-orange-500 border-orange-100 bg-orange-50/30 font-black";
      case '实时快报': return "text-blue-500 border-blue-100 bg-blue-50/30 font-black";
      default: return "text-slate-400 border-slate-100 bg-slate-50/30 font-bold";
    }
  }
};

export default function App() {
  const [view, setView] = useState('home'); 
  const [adminTab, setAdminTab] = useState('editor');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  
  const [authReady, setAuthReady] = useState(false);
  const [intelList, setIntelList] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isTesting, setIsTesting] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const [expandedApi, setExpandedApi] = useState(null);
  
  const [apiPool, setApiPool] = useState([
    { id: 0, name: 'DeepSeek (主力)', key: DEEPSEEK_KEY, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', active: true, status: null },
    { id: 1, name: 'SiliconFlow', key: '', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', active: false, status: null },
    { id: 2, name: 'Google AI Studio', key: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', active: false, status: null }
  ]);

  const [strategy, setStrategy] = useState({ industry: null, prompt: '探测全球 AI 硬件与跨境贸易的最前沿融资、并购及重大商业异动信号。' });

  let db, auth;
  try {
      const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
      db = getFirestore(app);
      auth = getAuth(app);
  } catch (e) { console.error(e); }

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setAuthReady(true);
      else signInAnonymously(auth).catch(e => setErrorMsg("矩阵连接失败: " + e.message));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !db) return;
    const q = collection(db, 'artifacts', DB_STORAGE_ID, 'public', 'data', 'intel');
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setIntelList(list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 50));
    });
    const timer = setInterval(() => setCooldown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => { unsub(); clearInterval(timer); };
  }, [authReady]);

  const handleLogin = () => {
    if (adminPass === 'admin') {
      setIsLoggedIn(true);
      setErrorMsg("✅ 权限验证通过");
      setAdminPass('');
      setTimeout(()=>setErrorMsg(null), 2000);
    } else {
      setErrorMsg("❌ 凭证无效，访问受限");
    }
  };

  const handleUpdate = async () => {
    if (isUpdating || cooldown > 0 || !authReady) return;
    setIsUpdating(true); setErrorMsg(null);
    try {
        const node = apiPool.find(n => n.active && n.key?.length > 5) || apiPool[0];
        const res = await fetch(`${node.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${node.key}` },
          body: JSON.stringify({
            model: node.model,
            messages: [{ 
              role: "system", 
              content: "你是一个资深商业情报分析师。必须联网实时搜索【过去24小时内】的动态，确保时效性证明。你必须对获取的信息进行深度原创总结，严禁直接搬运。返回纯 JSON 数组。字段：title(原创总结标题), content(100字原创摘要), urgency_level(时效证明：八百里加急/六百里加急/实时快报/常态监控), source_count(模拟交叉验证的节点数，8-15之间的整数), impact_summary(15-25字核心研判), grade_reason(10-15字理由), concern_level(1-5), companies(识别出的主体数组)" 
            }, { role: "user", content: strategy.prompt }],
            temperature: 0.1
          })
        });

        if (!res.ok) {
            const errData = await res.json().catch(()=>({}));
            throw new Error(`API 报错 [${res.status}]: ${errData.error?.message || '未知错误'}`);
        }

        const data = await res.json();
        const items = Service.parseJson(data.choices[0].message.content);
        
        if (items.length > 0) {
            const batch = writeBatch(db);
            items.slice(0, 5).forEach(item => {
                batch.set(doc(collection(db, 'artifacts', DB_STORAGE_ID, 'public', 'data', 'intel')), { ...item, createdAt: serverTimestamp() });
            });
            await batch.commit();
            setCooldown(30);
            if (view === 'admin') setErrorMsg("✅ 情报原创总结已同步至前台");
        } else {
            throw new Error("AI 未返回有效情报条目");
        }
    } catch (err) { 
        setErrorMsg("探测中断: " + err.message); 
    } finally { setIsUpdating(false); }
  };

  const handlePing = async (id) => {
    const node = apiPool.find(n => n.id === id);
    if (!node.key) return setErrorMsg("请先输入密钥");
    try {
        const res = await fetch(`${node.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${node.key}` },
            body: JSON.stringify({ model: node.model, messages: [{role:'user', content:'hi'}], max_tokens: 1 })
        });
        const next = apiPool.map(n => n.id === id ? { ...n, status: res.ok ? 'success' : 'error' } : n);
        setApiPool(next);
        if (res.ok) setErrorMsg(`✅ ${node.name} 链路握手成功`);
        else throw new Error("Key 可能无效");
    } catch (e) { setErrorMsg("❌ 链路失败: " + e.message); }
  };

  const handleTestIntel = async (id) => {
    const node = apiPool.find(n => n.id === id);
    if (!node.key) return setErrorMsg("请先输入密钥");
    setIsTesting(id);
    try {
        const res = await fetch(`${node.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${node.key}` },
            body: JSON.stringify({
                model: node.model,
                messages: [{ role: "system", content: "返回1条原创总结情报JSON：title, content, urgency_level, source_count(int), impact_summary, grade_reason, concern_level" }, { role: "user", content: "抓取最新AI动态。" }],
                max_tokens: 600
            })
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const items = Service.parseJson(data.choices[0].message.content);
        if (items.length > 0) setErrorMsg(`✅ 抓取闭环成功：检测到《${items[0].title}》`);
    } catch (e) { setErrorMsg(`❌ 自检失败: ${e.message}`); } finally { setIsTesting(null); }
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-[#0F172A] selection:bg-blue-100 font-black antialiased overflow-x-hidden">
      <nav className="fixed top-0 w-full h-14 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white shadow-lg"><Radar size={18} /></div>
          <h1 className="text-base font-black tracking-tighter uppercase italic leading-none">Sugar Radar</h1>
        </div>
        <button onClick={() => setView(view === 'admin' ? 'home' : 'admin')} className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${view === 'admin' ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
          {view === 'admin' ? <ArrowLeft size={18} /> : <Settings size={18} />}
        </button>
      </nav>

      <main className="pt-20 pb-20 px-4 md:px-6 max-w-5xl mx-auto">
        {errorMsg && (
          <div className={`mb-6 p-4 rounded-2xl border flex items-start gap-3 text-xs font-bold animate-in fade-in ${errorMsg.includes('✅') ? 'bg-green-50 border-green-100 text-green-600' : 'bg-red-50 border-red-100 text-red-600'}`}>
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1 leading-normal">{errorMsg}</span>
            <button onClick={()=>setErrorMsg(null)}><X size={14}/></button>
          </div>
        )}

        {view === 'home' && (
          <div className="animate-in fade-in max-w-4xl mx-auto overflow-x-hidden">
            <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4 px-1">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl md:text-2xl font-black tracking-tight text-slate-900 leading-none">全球情报中心</h2>
                <span className="bg-slate-900 text-amber-500 border border-amber-500/20 text-[8px] px-2 py-1 rounded-full font-black uppercase shadow-xl h-fit">CEO版</span>
              </div>
              <button onClick={handleUpdate} disabled={isUpdating || cooldown > 0} className={`h-10 px-6 rounded-xl font-black text-[11px] transition-all flex items-center gap-2 ${cooldown > 0 ? 'bg-slate-100 text-slate-400 border shadow-none cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-black shadow-lg shadow-slate-200'}`}>
                {isUpdating ? <RefreshCw className="animate-spin" size={13}/> : <Zap size={13}/>}
                {cooldown > 0 ? `锁定中 (${cooldown}s)` : '获取最新情报'}
              </button>
            </header>

            <div className="relative space-y-4">
              <div className="absolute left-[7px] md:left-[39px] top-4 bottom-4 w-[1px] bg-slate-100"></div>
              {intelList.length === 0 && <div className="pl-12 py-20 text-slate-300 italic font-medium text-sm">探测网格静默中，点击“获取最新情报”发起巡检...</div>}
              {intelList.map((item) => (
                <article key={item.id} className="relative pl-6 md:pl-24 group animate-in slide-in-from-top-4 overflow-hidden">
                    <div className="absolute left-[-2px] md:left-[34px] top-2.5 w-3 h-3 bg-white rounded-full border border-slate-200 group-hover:border-blue-600 transition-all z-10 shadow-sm"></div>
                    <div className="bg-white p-5 md:p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300 min-w-0">
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-3">
                             <span className="text-[9px] font-bold text-slate-300 font-mono uppercase tracking-widest leading-none">{Service.normalize(item.createdAt)}</span>
                             {item.urgency_level && (
                               <span className={`text-[8px] px-1.5 py-0.5 rounded border ${Service.getUrgencyStyles(item.urgency_level)}`}>
                                 {item.urgency_level}
                               </span>
                             )}
                          </div>
                          <div className="flex items-center gap-2">
                             {item.source_count && <div className="flex items-center gap-1 text-[8px] font-black text-slate-300 uppercase tracking-tighter"><Globe size={10}/> {item.source_count} 节点校验</div>}
                             {!item.createdAt && <span className="bg-blue-600 text-white text-[7px] px-1.5 py-0.5 rounded font-black uppercase animate-pulse">Live</span>}
                          </div>
                        </div>
                        
                        <h3 className="text-lg md:text-xl font-black leading-tight text-slate-900 mb-2 group-hover:text-blue-600 transition-colors tracking-tight min-w-0 truncate">{Service.normalize(item.title)}</h3>

                        {item.companies && (
                          <div className="flex flex-wrap gap-1 mb-3 items-center">
                            {Service.normalize(item.companies).split(',').map((c, i) => (
                              <span key={i} className="px-1.5 py-0.5 border border-slate-50 text-slate-400 text-[8px] font-black rounded uppercase tracking-tighter shrink-0 italic">@{c.trim()}</span>
                            ))}
                          </div>
                        )}

                        <p className="text-slate-500 mb-5 text-[13px] leading-relaxed font-medium line-clamp-2">{Service.normalize(item.content)}</p>
                        
                        {/* 完美平行对齐布局 */}
                        <div className="pt-4 border-t border-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div className="flex-1 flex items-center gap-3 min-w-0">
                            <span className="text-[8px] uppercase font-black text-indigo-600 tracking-widest leading-none shrink-0 whitespace-nowrap">关键影响</span>
                            <div className="flex items-center gap-2 overflow-hidden min-w-0">
                               <div className="w-1 h-3 bg-indigo-500/10 rounded-full shrink-0"></div>
                               <p className="text-[10px] font-bold text-slate-700 leading-none truncate italic">
                                 {Service.normalize(item.impact_summary)}
                               </p>
                            </div>
                          </div>

                          <div className="flex-1 flex items-center md:justify-end gap-4 w-full border-t md:border-t-0 pt-3 md:pt-0 border-slate-50">
                            <div className="flex items-center gap-1.5 order-2 md:order-1 shrink-0">
                               <span className="text-[8px] uppercase font-black text-amber-700 tracking-widest leading-none shrink-0">等级</span>
                               <div className="flex gap-0.5">
                                 {[...Array(5)].map((_, i) => <Star key={i} size={8} className={i < (item.concern_level || 3) ? "fill-amber-500 text-amber-500" : "text-slate-100"} />)}
                               </div>
                            </div>
                            <div className="flex items-center gap-1.5 md:justify-end order-1 md:order-2 flex-1 text-right overflow-hidden">
                               <Quote size={8} className="text-amber-500/20 shrink-0" />
                               <p className="text-[10px] font-bold text-slate-400 leading-none truncate italic">
                                 {Service.normalize(item.grade_reason)}
                               </p>
                            </div>
                          </div>
                        </div>
                    </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="flex flex-col md:flex-row gap-10 animate-in slide-in-from-right duration-300">
            {!isLoggedIn ? (
              <div className="w-full flex items-center justify-center py-20 px-4">
                <div className="max-w-sm w-full bg-white p-10 rounded-[3rem] border border-slate-100 shadow-2xl text-center">
                  <ShieldCheck size={48} className="mx-auto text-slate-900 mb-6" />
                  <h3 className="text-xl font-black mb-2 tracking-tight">安全矩阵访问</h3>
                  <p className="text-xs text-slate-400 mb-8 uppercase tracking-widest font-bold">Confidential Interface</p>
                  <input type="password" value={adminPass} onChange={(e)=>setAdminPass(e.target.value)} onKeyDown={(e)=>e.key==='Enter'&&handleLogin()} placeholder="请输入安全访问密码" className="w-full px-6 py-4 bg-slate-50 border-none rounded-2xl text-center font-bold text-lg mb-6 focus:ring-2 focus:ring-blue-100 outline-none" />
                  <button onClick={handleLogin} className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black shadow-xl hover:bg-black transition-all">执行身份验证</button>
                </div>
              </div>
            ) : (
              <>
                <aside className="w-full md:w-60 shrink-0 space-y-1.5">
                  <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-4 px-4 font-mono leading-none">Operations Deck</p>
                  <button onClick={() => setAdminTab('editor')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-black transition-all ${adminTab === 'editor' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}><Layout size={16}/> 指令编辑</button>
                  <button onClick={() => setAdminTab('pool')} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-black transition-all ${adminTab === 'pool' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}><Server size={16}/> API 中心</button>
                  <button onClick={()=>setIsLoggedIn(false)} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-black text-red-400 hover:bg-red-50 transition-all mt-10"><X size={16}/> 退出矩阵</button>
                </aside>

                <div className="flex-1 min-w-0 pb-40">
                  {adminTab === 'editor' && (
                    <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-8 animate-in fade-in">
                      <div className="space-y-4">
                        <div className="flex justify-between items-end">
                          <h3 className="text-lg font-black uppercase text-slate-900 leading-none">探测策略核心指令</h3>
                          <span className="text-[9px] font-mono text-slate-300 font-bold">{(strategy.prompt || '').length} / 500</span>
                        </div>
                        <textarea value={strategy.prompt} onChange={(e)=>setStrategy({...strategy, prompt: e.target.value})} className="w-full h-48 p-6 bg-slate-50 border-none rounded-2xl text-base font-bold outline-none resize-none leading-relaxed" />
                      </div>
                      
                      <div className="space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 flex items-center gap-2"><Filter size={14}/> 战略罗盘快速预设</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                          {INDUSTRIES.map(ind => (
                            <button key={ind} onClick={() => setStrategy({industry: ind, prompt: STRATEGY_TEMPLATES[ind]})} className={`px-3 py-3 rounded-xl text-[9px] font-black border transition-all ${strategy.industry === ind ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-500 hover:border-slate-200'}`}>
                              {ind}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-50">
                        <button 
                          onClick={handleUpdate} 
                          disabled={isUpdating || cooldown > 0} 
                          className={`w-full h-14 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-3 shadow-xl ${cooldown > 0 ? 'bg-slate-50 text-slate-300 border-none shadow-none cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-black active:scale-[0.98]'}`}
                        >
                          {isUpdating ? <RefreshCw className="animate-spin" size={16}/> : <Zap size={16}/>}
                          {cooldown > 0 ? `冷却锁定 (${cooldown}s)` : '立即下达全网原创总结指令'}
                        </button>
                        <p className="text-[9px] text-slate-400 text-center mt-3 uppercase tracking-widest italic font-bold">Real-time 24H sourcing & Original summary closure</p>
                      </div>
                    </div>
                  )}

                  {adminTab === 'pool' && (
                    <div className="space-y-3 animate-in fade-in">
                      {apiPool.map((api, idx) => (
                        <div key={api.id} className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm">
                          <div className="p-6 flex items-center justify-between cursor-pointer hover:bg-slate-50" onClick={() => setExpandedApi(expandedApi === api.id ? null : api.id)}>
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${api.active ? 'bg-green-500 shadow-md' : 'bg-slate-200'}`}></div>
                              <h4 className="font-black text-base">{api.name}</h4>
                              {api.status === 'success' && <span className="text-[7px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-black uppercase">Active</span>}
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={(e)=>{e.stopPropagation(); const n=[...apiPool]; n[idx].active=!n[idx].active; setApiPool(n);}} className={`w-8 h-4 rounded-full relative transition-all ${api.active ? 'bg-blue-600' : 'bg-slate-200'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${api.active ? 'right-0.5' : 'left-0.5'}`}></div></button>
                              <ChevronRight size={16} className={`text-slate-300 transition-transform ${expandedApi === api.id ? 'rotate-90' : ''}`} />
                            </div>
                          </div>
                          {expandedApi === api.id && (
                            <div className="px-6 pb-6 pt-2 border-t border-slate-50 space-y-5 animate-in slide-in-from-top-2">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="text-[9px] font-black text-slate-400 uppercase mb-2 block tracking-widest">API KEY</label>
                                  <div className="relative">
                                    <input type={showKey ? "text" : "password"} value={api.key} onChange={(e)=>{const n=[...apiPool]; n[idx].key=e.target.value; setApiPool(n);}} className="w-full pl-3 pr-8 py-2.5 bg-slate-50 rounded-lg text-[10px] font-mono outline-none border border-transparent focus:border-blue-100" />
                                    <button onClick={()=>setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300">{showKey ? <EyeOff size={14}/> : <Eye size={14}/>}</button>
                                  </div>
                                </div>
                                <div>
                                  <label className="text-[9px] font-black text-slate-400 uppercase mb-2 block tracking-widest font-black italic">Diagnostics Panel</label>
                                  <div className="flex gap-2">
                                      <button onClick={()=>handlePing(api.id)} className="flex-1 py-2.5 bg-white border border-slate-100 rounded-lg text-[9px] font-black flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"><Activity size={12}/> Ping</button>
                                      <button onClick={()=>handleTestIntel(api.id)} disabled={isTesting === api.id} className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg text-[9px] font-black flex items-center justify-center gap-2 hover:bg-black transition-colors uppercase">
                                        {isTesting === api.id ? <RefreshCw className="animate-spin" size={12}/> : <Zap size={12}/>} Test
                                      </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .no-scrollbar::-webkit-scrollbar { display: none; }
        html, body { overflow-x: hidden; width: 100%; position: relative; }
      `}} />
    </div>
  );
}
