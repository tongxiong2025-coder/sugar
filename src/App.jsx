import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, query, onSnapshot, 
  serverTimestamp, doc, getDoc, setDoc, writeBatch, increment, deleteField
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Radar, ShieldCheck, RefreshCw, Zap, 
  Lightbulb, History, Settings, 
  ArrowLeft, Building2, Volume2, Pause, AlertCircle, Sparkles, Clock, Key, Users, Star, Activity, Coins, CheckCircle2, Trash2
} from 'lucide-react';

/**
 * ==================================================
 * 🛰️ 方糖情报雷达 - 运营增强版 (V2.6.1)
 * ==================================================
 * 1. 深度修复 JSON 解析异常（处理 AI 溢出字符）
 * 2. 强持久化：刷新页面配置不丢失
 * 3. 首页探测按钮根据配置状态智能显隐
 * 4. 移动端全响应式舒适阅读适配
 */

const firebaseConfig = {
  apiKey: "AIzaSyB_-fLwf2_ftDdA3YsgnVzajw7hVPDCS1k",
  authDomain: "sugar-radar.firebaseapp.com",
  projectId: "sugar-radar", 
  storageBucket: "sugar-radar.firebasestorage.app",
  messagingSenderId: "388090302429",
  appId: "1:388090302429:web:97657e8f4690a5b17e3034"
};

const APP_ID_DB = "sugar-radar-prod-fast"; 
const AUTO_UPDATE_SLOTS = [7, 12, 20]; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); 
  const [intelList, setIntelList] = useState([]);
  const [logs, setLogs] = useState([]);
  const [password, setPassword] = useState('');
  
  // 核心配置状态
  const [strategy, setStrategy] = useState('加载中...');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('google/gemini-2.0-flash-001');
  const [usageStats, setUsageStats] = useState({ totalCalls: 0 });
  const [configLoaded, setConfigLoaded] = useState(false);
  
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [testStatus, setTestStatus] = useState(null); 
  const [manualCooldown, setManualCooldown] = useState(0); 
  const [audioState, setAudioState] = useState({ playing: false, id: null });
  const [triggeredSlots, setTriggeredSlots] = useState(new Set());

  // 1. 初始化 Auth 并强制读取云端配置
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        try {
          const configRef = doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main');
          const snap = await getDoc(configRef);
          if (snap.exists()) {
            const d = snap.data();
            setStrategy(d.strategy || '聚焦全球跨境电商、AI潮玩、直播出海及前沿科技动态');
            setApiKey(d.apiKey || '');
            setModel(d.model || 'google/gemini-2.0-flash-001');
          } else {
            setStrategy('聚焦全球跨境电商、AI潮玩、直播出海及前沿科技动态');
          }
          setConfigLoaded(true);
        } catch (e) {
          console.error("Config fetch error", e);
        }
      } else {
        await signInAnonymously(auth);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. 实时数据流同步
  useEffect(() => {
    if (!user) return;
    
    const unsubIntel = onSnapshot(query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel')), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setIntelList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 50));
    });

    const unsubLogs = onSnapshot(query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs')), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });

    const unsubConfig = onSnapshot(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.totalCalls !== undefined) setUsageStats({ totalCalls: d.totalCalls });
        if (d.apiKey !== undefined) setApiKey(d.apiKey);
        if (d.strategy !== undefined) setStrategy(d.strategy);
      }
    });

    return () => { unsubIntel(); unsubLogs(); unsubConfig(); };
  }, [user]);

  // 3. 定时扫描检查
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      if (manualCooldown > 0) setManualCooldown(prev => prev - 1);
      const hour = now.getHours();
      const minute = now.getMinutes();
      
      if (AUTO_UPDATE_SLOTS.includes(hour) && !triggeredSlots.has(hour) && minute === 0 && apiKey) {
        setTriggeredSlots(prev => new Set(prev).add(hour));
        triggerUpdate(true);
      }
      if (hour === 0 && triggeredSlots.size > 0) setTriggeredSlots(new Set());
    }, 1000);
    return () => clearInterval(timer);
  }, [manualCooldown, triggeredSlots, apiKey, strategy]);

  /**
   * 🛠️ OpenRouter 通用 Fetch
   */
  const openRouterFetch = async (prompt, systemPrompt, tempApiKey = null) => {
    const keyToUse = tempApiKey || apiKey;
    if (!keyToUse) throw new Error("API Key 缺失");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keyToUse}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Sugar Radar Pro'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.1
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    
    if (!tempApiKey) {
        await setDoc(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), {
            totalCalls: increment(1)
        }, { merge: true });
    }
    return data.choices[0].message.content;
  };

  const triggerUpdate = async (isAuto = false) => {
    if (isUpdating || !user || !apiKey) return;
    if (!isAuto && manualCooldown > 0) return;
    setIsUpdating(true);
    setErrorMsg(null);
    const count = isAuto ? 20 : 5;

    try {
      const sys = "你是一个全球商业情报官。请抓取情报并严格返回 JSON 格式：{ 'items': [ { 'title', 'content', 'impact', 'suggestion', 'companies': [], 'target_audience', 'attention_worth', 'worth_reason' } ] }。禁止输出任何 Markdown 代码块和额外解释。";
      const userReq = `基于策略搜集 ${count} 条关于 ${strategy} 的情报动态。必须识别公司。`;
      
      const rawText = await openRouterFetch(userReq, sys);
      
      // 🚀 终极解析逻辑：提取第一个 { 到最后一个 } 之间的所有内容
      const startIdx = rawText.indexOf('{');
      const endIdx = rawText.lastIndexOf('}');
      if (startIdx === -1 || endIdx === -1) throw new Error("AI 响应格式无效，未找到 JSON 边界");
      
      const cleanJson = rawText.substring(startIdx, endIdx + 1);
      
      const parsed = JSON.parse(cleanJson);
      const items = parsed.items || (Array.isArray(parsed) ? parsed : []);
      
      if (items.length > 0) {
        const batch = writeBatch(db);
        items.forEach(item => {
          batch.set(doc(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel')), { ...item, createdAt: serverTimestamp() });
        });
        batch.set(doc(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs')), { strategy, count: items.length, type: isAuto ? 'AUTO_SLOT' : 'MANUAL', createdAt: serverTimestamp() });
        await batch.commit();
      }
      if (!isAuto) setManualCooldown(60);
    } catch (err) { 
      setErrorMsg("探测失败: " + err.message); 
    } finally { 
      setIsUpdating(false); 
    }
  };

  const handleSaveSettings = async () => {
    try {
      await setDoc(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), {
        strategy, apiKey, model, updatedAt: serverTimestamp()
      }, { merge: true });
      setErrorMsg("✅ 配置已永久保存");
      setTimeout(() => setErrorMsg(null), 3000);
    } catch (e) { setErrorMsg("保存失败"); }
  };

  const handleDeleteKey = async () => {
    if (!confirm("确定要销毁 API 密钥吗？")) return;
    await setDoc(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), { apiKey: deleteField() }, { merge: true });
    setApiKey('');
    setErrorMsg("❌ 密钥已销毁");
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    try {
        await openRouterFetch("ping", "test", apiKey);
        setTestStatus('success');
        setTimeout(() => setTestStatus(null), 3000);
    } catch (e) {
        setTestStatus('error');
        setErrorMsg("API 测试失败: " + e.message);
    }
  };

  const speakIntel = (item) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${item.title}。研判：${item.worth_reason}`);
    window.speechSynthesis.speak(utterance);
  };

  const calculateCost = () => {
    const costPerCall = 0.00015; 
    const totalUsd = usageStats.totalCalls * costPerCall;
    const dailyEst = (3 * 20 + 5) * costPerCall;
    return { totalUsd: totalUsd.toFixed(4), dailyEst: dailyEst.toFixed(4) };
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans selection:bg-indigo-100 antialiased overflow-x-hidden">
      <nav className="fixed top-0 w-full h-16 bg-white/80 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-4 md:px-8 z-50">
        <div className="flex items-center gap-2.5 cursor-pointer active:scale-95 transition-transform" onClick={() => setView('home')}>
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200"><Radar size={22} /></div>
          <h1 className="text-lg font-black italic tracking-tighter text-slate-900 leading-none">Sugar Radar</h1>
        </div>
        <button onClick={() => setView(view === 'home' ? 'admin' : 'home')} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-indigo-600 transition-colors">
          {view === 'home' ? <Settings size={20} /> : <ArrowLeft size={20} />}
        </button>
      </nav>

      <main className="pt-24 pb-20 px-4 md:px-8 max-w-5xl mx-auto">
        {errorMsg && (
          <div className={`mb-8 p-4 rounded-2xl flex items-start gap-3 text-sm font-bold animate-in fade-in slide-in-from-top-2 border ${errorMsg.includes('✅') ? 'bg-indigo-50 border-indigo-100 text-indigo-600' : 'bg-red-50 border-red-100 text-red-600'}`}>
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span className="flex-1 break-all leading-tight">{errorMsg}</span>
          </div>
        )}

        {view === 'home' && (
          <div className="animate-in fade-in duration-700">
            <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] tracking-[0.2em] mb-2 uppercase">
                  <Clock size={12} /> 07:00 / 12:00 / 20:00 巡检模式
                </div>
                <h2 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 leading-none">实时情报动态轴</h2>
              </div>
              <button 
                onClick={() => apiKey ? triggerUpdate(false) : setView('admin')} 
                disabled={isUpdating || manualCooldown > 0} 
                className={`w-full md:w-auto h-14 md:h-12 flex items-center justify-center gap-2 px-8 rounded-2xl font-black text-sm shadow-xl transition-all active:scale-[0.98] ${!apiKey ? 'bg-amber-100 text-amber-700' : manualCooldown > 0 ? 'bg-slate-100 text-slate-400' : 'bg-slate-900 text-white hover:bg-black'}`}
              >
                <RefreshCw size={18} className={isUpdating ? "animate-spin text-indigo-400" : ""} /> 
                {!apiKey ? '请在后台配置 API 开启功能' : manualCooldown > 0 ? `冷却中 (${manualCooldown}s)` : '探测最新 (5条)'}
              </button>
            </header>
            
            <div className="relative">
              <div className="absolute left-[7px] md:left-[39px] top-4 bottom-4 w-px bg-slate-200"></div>
              <div className="space-y-6 md:space-y-12">
                {intelList.length === 0 && !isUpdating && <div className="pl-8 md:pl-24 py-24 text-slate-300 italic font-medium">雷达处于守望状态，等待配置完成...</div>}
                {intelList.map((item) => {
                  const date = item.createdAt ? new Date(item.createdAt.seconds * 1000) : new Date();
                  return (
                    <article key={item.id} className="relative pl-6 md:pl-24 group">
                      <div className="md:absolute md:left-0 md:top-1.5 md:w-10 text-left md:text-right mb-2 md:mb-0">
                          <span className="text-[9px] md:text-[10px] font-black text-slate-300 md:block">{date.toLocaleDateString('zh-CN', {month:'2-digit', day:'2-digit'})}</span>
                          <span className="text-[11px] md:text-[12px] font-mono font-bold text-slate-400 ml-2 md:ml-0 md:block">{date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                      <div className="absolute left-[-2px] md:left-[34px] top-1.5 md:top-3 w-3 h-3 bg-white rounded-full border-2 border-slate-200 group-hover:border-indigo-600 transition-all z-10 shadow-[0_0_0_4px_#F8FAFC]"></div>
                      <div className="bg-white p-5 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300">
                        <div className="flex justify-between mb-4 items-start gap-3">
                          <h3 className="text-xl md:text-2xl font-black leading-tight text-slate-900 tracking-tight">{item.title}</h3>
                          <button onClick={() => speakIntel(item)} className="p-3 rounded-full bg-slate-50 text-slate-400 active:bg-indigo-600 active:text-white transition-all shadow-sm shrink-0"><Volume2 size={18}/></button>
                        </div>
                        {item.companies && item.companies.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-5">
                            {item.companies.map((c, i) => (
                              <span key={i} className="bg-slate-900 text-white text-[10px] font-black px-2.5 py-1 rounded-lg uppercase flex items-center gap-1.5"><Building2 size={10}/>{c}</span>
                            ))}
                          </div>
                        )}
                        <p className="text-slate-500 mb-6 leading-relaxed text-base md:text-lg">{item.content}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6 border-t border-slate-50">
                          <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Users size={12} /> 受影响从业者: <span className="text-indigo-600">{item.target_audience || '全领域'}</span></div>
                             <div className="px-4 py-3 bg-indigo-50/50 rounded-2xl text-[12px] font-medium text-slate-600 border border-indigo-50 leading-tight">💡 {item.suggestion}</div>
                          </div>
                          <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Star size={12} /> 关注决策权重: 
                                <div className="flex gap-0.5 ml-1">{[...Array(5)].map((_, idx) => ( <Star key={idx} size={10} className={idx < parseInt(item.attention_worth || 3) ? "fill-amber-400 text-amber-400" : "text-slate-200"} /> ))}</div>
                             </div>
                             <div className="px-4 py-3 bg-amber-50/50 rounded-2xl text-[12px] font-bold text-amber-900 border border-amber-50 uppercase tracking-tighter italic">“{item.worth_reason || '核心决策参考'}”</div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="min-h-[60vh] flex items-center justify-center animate-in zoom-in-95">
            <div className="max-w-md w-full bg-white p-10 md:p-12 rounded-[2.5rem] md:rounded-[3.5rem] border border-slate-100 shadow-2xl text-center">
              <ShieldCheck size={56} className="mx-auto mb-6 text-indigo-600" />
              <h2 className="text-2xl md:text-3xl font-black mb-10 text-center tracking-tight">管理身份验证</h2>
              <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="w-full h-16 bg-slate-50 border-none rounded-2xl text-center text-2xl font-bold mb-6 focus:ring-2 ring-indigo-600 outline-none shadow-inner tracking-widest" placeholder="PIN" />
              <button onClick={() => password === 'admin' ? setView('dashboard') : setErrorMsg("验证失败")} className="w-full h-16 bg-indigo-600 text-white rounded-2xl font-black text-lg active:scale-95 transition-all shadow-lg">进入运营后台</button>
            </div>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="animate-in fade-in duration-500 space-y-10 pb-20">
            <h2 className="text-3xl md:text-4xl font-black tracking-tighter text-slate-900 leading-none">运营控制中心 ✨</h2>
            
            <div className="grid lg:grid-cols-12 gap-10">
              <div className="lg:col-span-8 space-y-10">
                
                {/* API 永久配置 */}
                <div className="bg-white p-8 md:p-10 rounded-[2.5rem] md:rounded-[3rem] border border-slate-100 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-indigo-600 opacity-20"></div>
                    <div className="flex justify-between items-center mb-8">
                        <h4 className="font-black text-xl flex items-center gap-2"><Key size={20}/> 引擎与永久密钥</h4>
                        {testStatus === 'success' && <span className="flex items-center gap-1 text-[10px] font-black text-green-600 uppercase tracking-widest animate-bounce"><CheckCircle2 size={12}/> 握手通过</span>}
                    </div>
                    
                    <div className="space-y-6">
                        <div>
                            <div className="flex justify-between items-end mb-1.5 px-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">OpenRouter API Key</label>
                                <button onClick={handleDeleteKey} className="text-[9px] font-black text-red-400 hover:text-red-600 flex items-center gap-1 uppercase"><Trash2 size={10}/> 销毁密钥</button>
                            </div>
                            <input type="password" value={apiKey} onChange={(e)=>setApiKey(e.target.value)} placeholder="sk-or-v1-..." className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-mono focus:ring-2 ring-indigo-100 shadow-inner" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block ml-1">模型 ID</label>
                                <input type="text" value={model} onChange={(e)=>setModel(e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-mono focus:ring-2 ring-indigo-100 shadow-inner" />
                            </div>
                            <div className="flex items-end">
                                <button onClick={handleTestConnection} disabled={testStatus === 'testing' || !apiKey} className={`w-full h-14 rounded-2xl font-bold text-xs transition-all ${testStatus === 'testing' ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-indigo-600 hover:bg-indigo-50 active:scale-95 shadow-sm'}`}>
                                    {testStatus === 'testing' ? '连接中...' : '测试连通性'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 指令策略 */}
                <div className="bg-white p-8 md:p-10 rounded-[2.5rem] md:rounded-[3rem] border border-slate-100 shadow-sm">
                  <h4 className="font-black text-xl text-slate-900 mb-6 flex items-center gap-2"><Sparkles size={20}/> 抓取策略指令库</h4>
                  <textarea value={strategy} onChange={(e)=>setStrategy(e.target.value)} className="w-full h-64 p-8 bg-slate-50 border-none rounded-3xl text-lg font-bold outline-none mb-8 focus:ring-2 ring-indigo-100 transition-all custom-scrollbar" placeholder="输入抓取方向..." />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button onClick={handleSaveSettings} className="h-16 bg-slate-900 text-white rounded-2xl font-black active:scale-95 transition-all shadow-lg hover:bg-black">永久保存配置</button>
                    <button onClick={()=>triggerUpdate(false)} disabled={isUpdating || !apiKey} className={`h-16 rounded-2xl font-black active:scale-95 transition-all ${isUpdating || !apiKey ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-100 hover:bg-indigo-700'}`}>
                      {isUpdating ? '同步中...' : '强制即刻同步'}
                    </button>
                  </div>
                </div>

                {/* 成本看板 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                        <Activity size={18} className="text-blue-500 mb-2"/>
                        <p className="text-[10px] font-black text-slate-400 uppercase">累计总请求</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">{usageStats.totalCalls} <span className="text-[10px] text-slate-300">次</span></p>
                    </div>
                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                        <Coins size={18} className="text-amber-500 mb-2"/>
                        <p className="text-[10px] font-black text-slate-400 uppercase">已耗费用</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">${calculateCost().totalUsd}</p>
                    </div>
                    <div className="bg-indigo-600 p-6 rounded-[2.5rem] shadow-lg text-white">
                        <p className="text-[10px] font-black text-indigo-200 uppercase">预估日成本</p>
                        <p className="text-2xl font-black mt-1">${calculateCost().dailyEst} <span className="text-[10px] opacity-60">/DAY</span></p>
                    </div>
                </div>
              </div>

              <div className="lg:col-span-4 h-full">
                <div className="bg-white p-8 rounded-[2.5rem] md:rounded-[3rem] border border-slate-100 shadow-sm h-full max-h-[850px] flex flex-col">
                  <h4 className="font-black text-xl mb-8 flex items-center gap-2 text-slate-400"><History size={20}/> 执行日志轴</h4>
                  <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
                    {logs.map(log => (
                      <div key={log.id} className="p-4 bg-slate-50 rounded-2xl">
                        <div className="flex justify-between mb-1">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${log.type === 'AUTO_SLOT' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}>{log.type}</span>
                          <span className="text-[10px] font-mono text-slate-400">{log.createdAt ? new Date(log.createdAt.seconds * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}</span>
                        </div>
                        <div className="text-[12px] font-bold text-slate-700">同步动态: {log.count} 条</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; }` }} />
    </div>
  );
};

export default App;
