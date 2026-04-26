import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, query, onSnapshot, 
  serverTimestamp, doc, getDoc, setDoc, writeBatch, increment
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Radar, ShieldCheck, RefreshCw, Zap, 
  Lightbulb, History, Settings, 
  ArrowLeft, Building2, Volume2, Pause, AlertCircle, Sparkles, Clock, Key, Users, Star, Activity, Coins, CheckCircle2
} from 'lucide-react';

/**
 * ==================================================
 * 🛰️ 方糖情报雷达 - 安全运营版 (API 动态配置 & 成本监控)
 * ==================================================
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
  const [strategy, setStrategy] = useState('聚焦全球跨境电商、AI潮玩、直播出海及前沿科技动态');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('google/gemini-2.0-flash-001');
  const [usageStats, setUsageStats] = useState({ totalCalls: 0 });
  
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [testStatus, setTestStatus] = useState(null); // 'testing', 'success', 'error'
  const [manualCooldown, setManualCooldown] = useState(0); 
  const [audioState, setAudioState] = useState({ playing: false, id: null });
  const [triggeredSlots, setTriggeredSlots] = useState(new Set());

  // 1. 初始化 Auth
  useEffect(() => {
    onAuthStateChanged(auth, async (u) => {
      if (u) setUser(u); 
      else await signInAnonymously(auth);
    });
  }, []);

  // 2. 数据与配置实时同步
  useEffect(() => {
    if (!user) return;
    
    // 监听情报
    const unsubIntel = onSnapshot(query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel')), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setIntelList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 50));
    });

    // 监听日志
    const unsubLogs = onSnapshot(query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs')), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });

    // 监听 API 配置与统计
    const unsubConfig = onSnapshot(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.strategy) setStrategy(d.strategy);
        if (d.apiKey) setApiKey(d.apiKey);
        if (d.model) setModel(d.model);
        if (d.totalCalls !== undefined) setUsageStats({ totalCalls: d.totalCalls });
      }
    });

    return () => { unsubIntel(); unsubLogs(); unsubConfig(); };
  }, [user]);

  // 3. 7/12/20 定时逻辑
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      if (manualCooldown > 0) setManualCooldown(prev => prev - 1);
      const hour = now.getHours();
      if (AUTO_UPDATE_SLOTS.includes(hour) && !triggeredSlots.has(hour) && now.getMinutes() === 0) {
        setTriggeredSlots(prev => new Set(prev).add(hour));
        triggerUpdate(true);
      }
      if (hour === 0 && triggeredSlots.size > 0) setTriggeredSlots(new Set());
    }, 1000);
    return () => clearInterval(timer);
  }, [manualCooldown, triggeredSlots]);

  /**
   * 🛠️ OpenRouter 通用调用
   */
  const openRouterFetch = async (prompt, systemPrompt, tempApiKey = null) => {
    const keyToUse = tempApiKey || apiKey;
    if (!keyToUse) throw new Error("API Key 未在后台配置");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keyToUse}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Sugar Radar Security'
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
    
    // 成功后在 Firebase 记录一次调用 (原子增加)
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
      const sys = "你是一个专业情报官。请抓取情报并严格返回 JSON 格式：{ 'items': [ { 'title', 'content', 'impact', 'suggestion', 'companies': [], 'target_audience', 'attention_worth', 'worth_reason' } ] }。不要 Markdown。";
      const userReq = `搜集 ${count} 条关于 ${strategy} 的最新情报动态。必须识别公司主体。`;
      
      const rawText = await openRouterFetch(userReq, sys);
      const jsonMatch = rawText.match(/\[[\s\S]*\]/) || rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI 响应解析 JSON 失败");
      
      const parsed = JSON.parse(jsonMatch[0]);
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
      setErrorMsg("✅ 配置已成功保存至私有云端");
      setTimeout(() => setErrorMsg(null), 3000);
    } catch (e) {
      setErrorMsg("保存失败，请检查数据库权限");
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    try {
        await openRouterFetch("Respond with 'OK'", "Test mode", apiKey);
        setTestStatus('success');
        setTimeout(() => setTestStatus(null), 3000);
    } catch (e) {
        setTestStatus('error');
        setErrorMsg("API 测试失败: " + e.message);
    }
  };

  const speakIntel = (item) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${item.title}。研判建议是：${item.worth_reason}`);
    window.speechSynthesis.speak(utterance);
  };

  // 成本测算逻辑 (基于 Gemini 2.0 Flash 均价: $0.1 / 1M Tokens)
  const calculateCost = () => {
    const costPerCall = 0.00015; // 约合 0.001 人民币/次 (含搜索与上下午)
    const totalUsd = usageStats.totalCalls * costPerCall;
    const dailyEst = (3 * 20 + 5) * costPerCall; // 预估日消耗 (3次准点+1次手动)
    return { totalUsd: totalUsd.toFixed(4), dailyEst: dailyEst.toFixed(4) };
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans selection:bg-indigo-100">
      <nav className="fixed top-0 w-full h-16 bg-white/80 backdrop-blur-md border-b flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100"><Radar size={24} /></div>
          <h1 className="text-xl font-black italic tracking-tighter text-slate-900 leading-none">Sugar Radar</h1>
        </div>
        <button onClick={() => setView(view === 'home' ? 'admin' : 'home')} className="p-2 text-slate-400 hover:text-indigo-600 transition-colors">
          {view === 'home' ? <Settings size={20} /> : <ArrowLeft size={20} />}
        </button>
      </nav>

      <main className="pt-24 pb-12 px-6 max-w-4xl mx-auto">
        {errorMsg && (
          <div className={`mb-8 p-4 border rounded-2xl flex items-start gap-3 text-sm font-bold animate-in fade-in ${errorMsg.includes('成功') ? 'bg-indigo-50 border-indigo-100 text-indigo-600' : 'bg-red-50 border-red-100 text-red-600'}`}>
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span className="flex-1 break-all uppercase leading-tight">{errorMsg}</span>
          </div>
        )}

        {view === 'home' && (
          <div className="animate-in fade-in duration-700">
            <header className="mb-12 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] tracking-widest mb-2 uppercase">
                  <Clock size={12} /> 07:00 / 12:00 / 20:00 全自动巡检
                </div>
                <h2 className="text-4xl font-black tracking-tight text-slate-900 leading-none">实时情报动态</h2>
              </div>
              <button 
                onClick={() => triggerUpdate(false)} 
                disabled={isUpdating || manualCooldown > 0 || !apiKey} 
                className={`group flex items-center gap-2 px-6 py-2.5 rounded-2xl font-black text-sm shadow-xl transition-all active:scale-95 ${manualCooldown > 0 || !apiKey ? 'bg-slate-100 text-slate-400' : 'bg-slate-900 text-white hover:bg-black'}`}
              >
                <RefreshCw size={16} className={isUpdating ? "animate-spin text-indigo-400" : ""} /> 
                {!apiKey ? '请在后台配置 API' : manualCooldown > 0 ? `冷却中 (${manualCooldown}s)` : '探测最新 (5条)'}
              </button>
            </header>
            
            <div className="relative">
              <div id="timeline-flow" className="grid grid-cols-[80px_1px_1fr] gap-x-8 relative">
                <div className="absolute left-[119px] top-4 bottom-4 w-px bg-slate-200"></div>
                {intelList.length === 0 && !isUpdating && <div className="col-start-3 py-24 text-slate-300 italic font-medium">雷达已就绪，待配置完成后手动开启第一次探测...</div>}
                {intelList.map((item) => {
                  const date = item.createdAt ? new Date(item.createdAt.seconds * 1000) : new Date();
                  return (
                    <React.Fragment key={item.id}>
                        <div className="text-right py-4 shrink-0">
                            <span className="text-[9px] font-black text-slate-300 uppercase leading-none block">{date.toLocaleDateString('zh-CN', {month:'2-digit', day:'2-digit'})}</span>
                            <span className="text-[11px] font-mono font-bold text-slate-400 block mt-1">{date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                        <div className="relative flex justify-center py-4 shrink-0">
                            <div className="w-3 h-3 bg-white rounded-full border-2 border-slate-200 group-hover:border-indigo-600 group-hover:bg-indigo-600 transition-all z-10 shadow-[0_0_0_4px_#F8FAFC] mt-1.5"></div>
                        </div>
                        <div className="pb-12 group">
                            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300">
                                <div className="flex justify-between mb-4 items-start gap-4">
                                    <h3 className="text-2xl font-bold leading-tight text-slate-900 tracking-tight group-hover:text-indigo-600 transition-colors">{item.title}</h3>
                                    <button onClick={() => speakIntel(item)} className="p-3 rounded-full bg-slate-50 text-slate-400 hover:text-indigo-600 transition-all"><Volume2 size={18}/></button>
                                </div>
                                {item.companies && item.companies.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mb-6">
                                        {item.companies.map((c, i) => (
                                            <span key={i} className="bg-slate-900 text-white text-[10px] font-black px-3 py-1 rounded-lg uppercase tracking-tight flex items-center gap-1.5 shadow-sm">
                                                <Building2 size={10}/>{c}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <p className="text-slate-500 mb-8 leading-relaxed text-lg">{item.content}</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-50">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Users size={12} /> 受影响人群: <span className="text-indigo-600">{item.target_audience || '全领域'}</span></div>
                                        <div className="px-4 py-2 bg-indigo-50/50 rounded-2xl text-[12px] font-medium text-slate-600 border border-indigo-50">💡 {item.suggestion}</div>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Star size={12} /> 关注权重: 
                                            <div className="flex gap-0.5 ml-1">{[...Array(5)].map((_, idx) => ( <Star key={idx} size={10} className={idx < parseInt(item.attention_worth || 3) ? "fill-amber-400 text-amber-400" : "text-slate-200"} /> ))}</div>
                                        </div>
                                        <div className="px-4 py-2 bg-amber-50/50 rounded-2xl text-[12px] font-bold text-amber-900 border border-amber-50 uppercase tracking-tighter italic">“{item.worth_reason || '核心研判'}”</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="h-[60vh] flex items-center justify-center p-8">
            <div className="max-w-md w-full bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-2xl text-center">
              <ShieldCheck size={48} className="mx-auto mb-6 text-indigo-600" />
              <h2 className="text-3xl font-black mb-10 text-center tracking-tight">管理验证</h2>
              <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className="w-full h-16 bg-slate-50 border-none rounded-2xl text-center text-xl font-bold mb-6 focus:ring-2 ring-indigo-600 outline-none shadow-inner" placeholder="PIN" />
              <button onClick={() => password === 'admin' ? setView('dashboard') : setErrorMsg("密码不正确")} className="w-full h-16 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700 active:scale-95 transition-all">进入后台控制台</button>
            </div>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="animate-in fade-in duration-500 pb-20">
            <h2 className="text-4xl font-black mb-12 tracking-tighter text-slate-900">控制中心 ✨</h2>
            
            <div className="grid lg:grid-cols-12 gap-10">
              <div className="lg:col-span-8 space-y-10">
                
                {/* 1. API 引擎设置 (安全隔离) */}
                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-indigo-600 opacity-20"></div>
                    <div className="flex justify-between items-center mb-8">
                        <h4 className="font-black text-xl flex items-center gap-2"><Key size={20}/> API 引擎设置</h4>
                        {testStatus === 'success' && <span className="flex items-center gap-1 text-[10px] font-black text-green-600 uppercase tracking-widest animate-pulse"><CheckCircle2 size={12}/> 握手测试通过</span>}
                    </div>
                    
                    <div className="space-y-5">
                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block ml-1">OpenRouter API Key</label>
                            <input 
                                type="password" 
                                value={apiKey} 
                                onChange={(e)=>setApiKey(e.target.value)} 
                                placeholder="sk-or-v1-..." 
                                className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-mono focus:ring-2 ring-indigo-100 shadow-inner"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block ml-1">模型路径 (OpenRouter Model ID)</label>
                                <input 
                                    type="text" 
                                    value={model} 
                                    onChange={(e)=>setModel(e.target.value)} 
                                    className="w-full p-4 bg-slate-50 border-none rounded-2xl text-sm font-mono focus:ring-2 ring-indigo-100 shadow-inner"
                                />
                            </div>
                            <div className="flex items-end">
                                <button 
                                    onClick={handleTestConnection}
                                    disabled={testStatus === 'testing' || !apiKey}
                                    className={`w-full h-[52px] rounded-2xl font-bold text-xs transition-all ${testStatus === 'testing' ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-indigo-600 hover:bg-indigo-50'}`}
                                >
                                    {testStatus === 'testing' ? '正在拨号测试...' : '测试连通性'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. 指令策略配置 */}
                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                  <h4 className="font-black text-xl text-slate-900 mb-6 flex items-center gap-2"><Sparkles size={20}/> AI 检索策略</h4>
                  <textarea value={strategy} onChange={(e)=>setStrategy(e.target.value)} className="w-full h-64 p-8 bg-slate-50 border-none rounded-3xl text-lg font-bold outline-none mb-8 focus:ring-2 ring-indigo-100 transition-all custom-scrollbar" placeholder="在此输入情报抓取逻辑..." />
                  <div className="grid sm:grid-cols-2 gap-4">
                    <button onClick={handleSaveSettings} className="h-16 bg-slate-900 text-white rounded-2xl font-black hover:bg-black transition-all shadow-lg active:scale-95">保存所有同步配置</button>
                    <button onClick={()=>triggerUpdate(false)} disabled={isUpdating} className={`h-16 rounded-2xl font-black transition-all active:scale-95 ${isUpdating ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-100 hover:bg-indigo-700'}`}>
                      {isUpdating ? '同步中...' : '即刻强制同步 (5条)'}
                    </button>
                  </div>
                </div>

                {/* 3. 运营成本与用量看板 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                        <Activity size={18} className="text-blue-500 mb-2"/>
                        <p className="text-[10px] font-black text-slate-400 uppercase">累计请求次数</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">{usageStats.totalCalls} <span className="text-[10px] text-slate-300">次</span></p>
                    </div>
                    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
                        <Coins size={18} className="text-amber-500 mb-2"/>
                        <p className="text-[10px] font-black text-slate-400 uppercase">已产生费用 (USD)</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">${calculateCost().totalUsd}</p>
                    </div>
                    <div className="bg-indigo-600 p-6 rounded-[2.5rem] shadow-lg shadow-indigo-100 text-white">
                        <Activity size={18} className="text-indigo-200 mb-2"/>
                        <p className="text-[10px] font-black text-indigo-200 uppercase">预估日运营成本</p>
                        <p className="text-2xl font-black mt-1">${calculateCost().dailyEst} <span className="text-[10px] opacity-60">/DAY</span></p>
                    </div>
                </div>
              </div>

              <div className="lg:col-span-4 h-full">
                <div className="bg-white p-8 rounded-[3.5rem] border border-slate-100 shadow-sm h-full max-h-[900px] flex flex-col">
                  <h4 className="font-black text-xl mb-8 flex items-center gap-2 text-slate-400"><History size={20}/> 任务执行日志</h4>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                    {logs.map(log => (
                      <div key={log.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-100 transition-all hover:border-indigo-100">
                        <div className="flex justify-between mb-2 text-[10px] font-black uppercase">
                          <span className={log.type === 'AUTO_SLOT' ? 'text-indigo-600' : 'text-amber-600'}>{log.type === 'AUTO_SLOT' ? '自动巡检' : '手动干预'}</span>
                          <span className="text-slate-400 font-mono">{log.createdAt ? new Date(log.createdAt.seconds * 1000).toLocaleTimeString() : '...'}</span>
                        </div>
                        <div className="text-[13px] font-bold text-slate-700 leading-tight">同步动态: {log.count} 条</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 10px; }
      `}} />
    </div>
  );
};

export default App;
