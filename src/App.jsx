import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, query, onSnapshot, 
  serverTimestamp, doc, getDoc, setDoc, writeBatch 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Radar, ShieldCheck, Zap, 
  Lightbulb, History, Settings, 
  ArrowLeft, Building2, Volume2, Pause, AlertCircle, Sparkles, Coffee, RefreshCw, Users, Star, Clock
} from 'lucide-react';

/**
 * ==================================================
 * 🛰️ 方糖情报雷达 - 高频精准版
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

const GEMINI_API_KEY = "AIzaSyB_-fLwf2_ftDdA3YsgnVzajw7hVPDCS1k"; // 环境自动提供
const APP_ID_DB = "sugar-radar-prod-fast"; 

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const App = () => {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); 
  const [intelList, setIntelList] = useState([]);
  const [logs, setLogs] = useState([]);
  const [password, setPassword] = useState('');
  const [strategy, setStrategy] = useState('聚焦全球跨境电商、AI潮玩、直播出海及前沿科技动态');
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  
  const [manualCooldown, setManualCooldown] = useState(0); 
  const [audioState, setAudioState] = useState({ playing: false, id: null });
  const audioRef = useRef(null);
  const [triggeredSlots, setTriggeredSlots] = useState(new Set());

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) { setUser(u); } else {
        try { await signInAnonymously(auth); } catch (e) { setErrorMsg("身份验证失败: " + e.message); }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const qIntel = query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel'));
    const unsubIntel = onSnapshot(qIntel, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setIntelList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 100));
    }, (err) => setErrorMsg("数据同步异常: " + err.message));

    const qLogs = query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs'));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });

    const fetchConfig = async () => {
      try {
        const docRef = doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main');
        const snap = await getDoc(docRef);
        if (snap.exists()) setStrategy(snap.data().strategy);
      } catch (e) {}
    };
    fetchConfig();
    return () => { unsubIntel(); unsubLogs(); };
  }, [user]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();

      if (manualCooldown > 0) setManualCooldown(prev => prev - 1);

      const slots = [7, 12, 20];
      if (slots.includes(hour) && !triggeredSlots.has(hour) && minute === 0) {
        setTriggeredSlots(prev => new Set(prev).add(hour));
        triggerUpdate(true); 
      }
      if (hour === 0 && triggeredSlots.size > 0) setTriggeredSlots(new Set());
    }, 1000);
    return () => clearInterval(timer);
  }, [manualCooldown, triggeredSlots]);

  const geminiFetch = async (payload, endpoint = "generateContent", model = "gemini-2.5-flash-preview-09-2025") => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${GEMINI_API_KEY}`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) return data;
      throw new Error(data.error?.message || `API Error: ${res.status}`);
    } catch (e) { throw e; }
  };

  const triggerUpdate = async (isAuto = false) => {
    if (isUpdating || !user) return;
    if (!isAuto && manualCooldown > 0) return;
    setIsUpdating(true);
    setErrorMsg(null);
    const count = isAuto ? 20 : 5;

    try {
      const result = await geminiFetch({
        contents: [{ parts: [{ text: `搜集 ${count} 条关于：${strategy} 的最新商业动态。` }] }],
        systemInstruction: { 
          parts: [{ text: `你是一个专业的投资经理。请抓取最新情报并返回 JSON：{ 'items': [ { 'title', 'content', 'impact', 'suggestion', 'companies': [], 'target_audience': '适合人群(如:老板/运营/选品师)', 'attention_worth': '1-5数字', 'worth_reason': '研判理由(15字内)' } ] }。必须识别主体公司。` }] 
        },
        tools: [{ "google_search": {} }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      });
      
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(text);
      if (parsed.items) {
        const batch = writeBatch(db);
        parsed.items.forEach(item => {
          const d = doc(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel'));
          batch.set(d, { ...item, createdAt: serverTimestamp() });
        });
        const l = doc(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs'));
        batch.set(l, { strategy, count: parsed.items.length, type: isAuto ? 'AUTO_SLOT' : 'MANUAL', createdAt: serverTimestamp() });
        await batch.commit();
      }
      if (!isAuto) setManualCooldown(60);
    } catch (err) { setErrorMsg(`抓取异常: ${err.message}`); } 
    finally { setIsUpdating(false); }
  };

  const handleAdminLogin = () => {
    if (password === 'admin') setView('dashboard');
    else setErrorMsg("身份验证失败");
  };

  const handleSaveStrategy = async () => {
    if (!db) return;
    try {
      await setDoc(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), { strategy, updatedAt: serverTimestamp() });
      setErrorMsg("策略同步成功");
      setTimeout(() => setErrorMsg(null), 3000);
    } catch (e) { setErrorMsg(`保存失败: ${e.message}`); }
  };

  const speakIntel = async (item) => {
    if (audioState.playing && audioState.id === item.id) {
      audioRef.current?.pause();
      setAudioState({ playing: false, id: null });
      return;
    }
    setAudioState({ playing: true, id: item.id });
    try {
      const res = await geminiFetch({
        contents: [{ parts: [{ text: `请播报：${item.title}。研判：${item.worth_reason}。建议：${item.suggestion}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } }
      }, "generateContent", "gemini-2.5-flash-preview-tts");

      const audioData = res.candidates[0].content.parts[0].inlineData.data;
      const blob = new Blob([new Uint8Array(atob(audioData).split("").map(c => c.charCodeAt(0)))], { type: 'audio/wav' });
      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(blob);
        audioRef.current.play();
        audioRef.current.onended = () => setAudioState({ playing: false, id: null });
      }
    } catch (e) { setAudioState({ playing: false, id: null }); }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans">
      <audio ref={audioRef} className="hidden" />
      <nav className="fixed top-0 w-full h-16 bg-white/80 backdrop-blur-md border-b flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200"><Radar size={24} /></div>
          <h1 className="text-xl font-black italic tracking-tighter text-slate-900">Sugar Radar</h1>
        </div>
        <button 
          onClick={() => { setView(view === 'home' ? 'admin' : 'home'); setErrorMsg(null); }} 
          className="flex items-center gap-2 px-5 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-bold border border-indigo-100 hover:bg-indigo-100 transition-colors"
        >
          {view === 'home' ? <Settings size={16} /> : <ArrowLeft size={16} />}
        </button>
      </nav>

      <main className="pt-24 pb-12 px-6 max-w-4xl mx-auto">
        {errorMsg && (
            <div className="mb-8 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-600 text-sm font-bold animate-in fade-in slide-in-from-top-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span className="flex-1 break-all uppercase">{errorMsg}</span>
            </div>
        )}

        {view === 'home' && (
          <div className="animate-in fade-in duration-700 slide-in-from-bottom-4">
            <header className="mb-12 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] tracking-widest mb-2 uppercase">
                  <Clock size={12} /> 07:00 / 12:00 / 20:00 自动巡检
                </div>
                <h2 className="text-4xl font-black tracking-tight text-slate-900">情报动态轴</h2>
              </div>
              <button 
                onClick={() => triggerUpdate(false)} 
                disabled={isUpdating || manualCooldown > 0} 
                className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl font-black text-sm shadow-xl transition-all active:scale-95 ${manualCooldown > 0 ? 'bg-slate-100 text-slate-400' : 'bg-slate-900 text-white hover:bg-black'}`}
              >
                <RefreshCw size={16} className={isUpdating ? "animate-spin text-indigo-400" : ""} /> 
                {manualCooldown > 0 ? `冷却中 (${manualCooldown}s)` : '探测最新 (5条)'}
              </button>
            </header>
            
            <div className="relative space-y-12">
              {/* 完善的时间轴引导线 */}
              <div className="absolute left-10 top-4 bottom-4 w-px bg-slate-200"></div>
              {intelList.length === 0 && !isUpdating && <div className="pl-24 py-24 text-slate-300 italic font-medium">尚未捕获到有效信号...</div>}
              
              {intelList.map((item) => {
                const date = item.createdAt ? new Date(item.createdAt.seconds * 1000) : new Date();
                return (
                  <article key={item.id} className="relative pl-24 group">
                    <div className="absolute left-0 top-1.5 w-8 text-right">
                        <span className="text-[9px] font-black text-slate-300 uppercase leading-none block">{date.toLocaleDateString('zh-CN', {month:'2-digit', day:'2-digit'})}</span>
                        <span className="text-[11px] font-mono font-bold text-slate-400 block mt-1">{date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <div className="absolute left-[34px] top-3 w-3 h-3 bg-white rounded-full border-2 border-slate-200 group-hover:border-indigo-600 group-hover:bg-indigo-600 transition-all z-10 shadow-[0_0_0_4px_#F8FAFC]"></div>
                    <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300">
                      <div className="flex justify-between mb-4 items-start gap-4">
                        <h3 className="text-2xl font-bold leading-tight text-slate-900">{item.title}</h3>
                        <button onClick={() => speakIntel(item)} className={`p-3 rounded-full transition-all shrink-0 ${audioState.id === item.id ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-50 text-slate-400 hover:text-indigo-600'}`}>
                          {audioState.id === item.id ? <Pause size={18}/> : <Volume2 size={18}/>}
                        </button>
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
                           <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                               <Users size={12} /> 受影响人群: <span className="text-indigo-600">{item.target_audience || '全领域'}</span>
                           </div>
                           <div className="px-4 py-2 bg-indigo-50/50 rounded-2xl text-[12px] font-medium text-slate-600 border border-indigo-50 leading-relaxed italic">
                               💡 {item.suggestion}
                           </div>
                        </div>
                        <div className="flex flex-col gap-2">
                           <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                               <Star size={12} /> 关注权重: 
                               <div className="flex gap-0.5 ml-1">
                                  {[...Array(5)].map((_, idx) => (
                                    <Star key={idx} size={10} className={idx < parseInt(item.attention_worth || 3) ? "fill-amber-400 text-amber-400" : "text-slate-200"} />
                                  ))}
                               </div>
                           </div>
                           <div className="px-4 py-2 bg-amber-50/50 rounded-2xl text-[12px] font-bold text-amber-900 border border-amber-50 leading-relaxed uppercase tracking-tighter">
                               “{item.worth_reason || '核心决策参考'}”
                           </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="h-[60vh] flex items-center justify-center p-8">
            <div className="max-w-md w-full bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-2xl text-center">
              <ShieldCheck size={48} className="mx-auto mb-6 text-indigo-600" />
              <h2 className="text-3xl font-black mb-10 text-slate-900 tracking-tight">管理验证</h2>
              <input 
                type="password" 
                value={password} 
                onChange={(e)=>setPassword(e.target.value)} 
                className="w-full h-16 bg-slate-50 border-2 border-transparent rounded-2xl text-center text-xl font-bold mb-6 focus:border-indigo-600 outline-none" 
              />
              <button onClick={handleAdminLogin} className="w-full h-16 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700">进入控制台</button>
            </div>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-4xl font-black mb-12 tracking-tighter text-slate-900">控制中心 ✨</h2>
            <div className="grid lg:grid-cols-12 gap-10">
              <div className="lg:col-span-8">
                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                    <h4 className="font-black text-xl text-slate-900">AI 深度策略指令</h4>
                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md uppercase tracking-tighter">Scheduler: Active</span>
                  </div>
                  <textarea value={strategy} onChange={(e)=>setStrategy(e.target.value)} className="w-full h-64 p-8 bg-slate-50 border-none rounded-3xl text-lg font-bold outline-none mb-8 focus:ring-2 ring-indigo-100 transition-all" />
                  <div className="grid sm:grid-cols-2 gap-4">
                    <button onClick={handleSaveStrategy} className="h-16 bg-slate-900 text-white rounded-2xl font-black hover:bg-black">保存同步配置</button>
                    <button onClick={()=>triggerUpdate(false)} disabled={isUpdating} className={`h-16 rounded-2xl font-black transition-all ${isUpdating ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-100'}`}>
                      {isUpdating ? '探测中...' : '即刻强制抓取'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-4 h-full">
                <div className="bg-white p-8 rounded-[3.5rem] border border-slate-100 shadow-sm h-full max-h-[700px] flex flex-col">
                  <h4 className="font-black text-xl mb-8 flex items-center gap-2 text-slate-400"><History size={20}/> 执行日志</h4>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {logs.map(log => (
                      <div key={log.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex justify-between mb-2 text-[10px] font-black uppercase">
                          <span className={log.type === 'AUTO_SLOT' ? 'text-indigo-600' : 'text-amber-600'}>{log.type}</span>
                          <span className="text-slate-400">{log.createdAt ? new Date(log.createdAt.seconds * 1000).toLocaleTimeString() : '...'}</span>
                        </div>
                        <div className="text-[13px] font-bold text-slate-700">同步动态: {log.count} 条</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
