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
  ArrowLeft, Building2, Volume2, Pause, AlertCircle, Sparkles, Coffee
} from 'lucide-react';

/**
 * ==================================================
 * 🛰️ 方糖情报雷达 - 核心配置中心
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

// 在预览执行环境中，必须将 API Key 设置为空字符串，环境会自动注入有效密钥
const GEMINI_API_KEY = ""; 
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
  const [countdown, setCountdown] = useState(10); 
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false); 
  const [audioState, setAudioState] = useState({ playing: false, id: null });
  const audioRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) { 
        setUser(u); 
      } else {
        try { 
          await signInAnonymously(auth); 
        } catch (e) { 
          setErrorMsg("Firebase 身份验证失败，请检查配置或网络。"); 
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const qIntel = collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel');
    const unsubIntel = onSnapshot(query(qIntel), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setIntelList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 50));
    }, (err) => console.error("Firestore Intel Error:", err));

    const qLogs = collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs');
    const unsubLogs = onSnapshot(query(qLogs), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (err) => console.error("Firestore Logs Error:", err));

    const fetchConfig = async () => {
      try {
        const docRef = doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main');
        const snap = await getDoc(docRef);
        if (snap.exists()) setStrategy(snap.data().strategy);
      } catch (e) {
        console.warn("Failed to fetch config:", e);
      }
    };
    fetchConfig();
    return () => { unsubIntel(); unsubLogs(); };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (!isUpdating) triggerUpdate(true); 
          return isQuotaExceeded ? 60 : 10; 
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [strategy, user, isUpdating, isQuotaExceeded]);

  const geminiFetch = async (payload, endpoint = "generateContent", model = "gemini-2.5-flash-preview-09-2025") => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${GEMINI_API_KEY}`;
    
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(url, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(payload) 
        });
        const data = await res.json();
        
        if (res.ok) return data;

        if (res.status === 429 || data.error?.message?.includes("quota")) {
          throw new Error("QUOTA_LIMIT");
        }
        
        if (res.status === 403 || res.status === 401) {
          throw new Error("AUTH_ERROR");
        }

        throw new Error(data.error?.message || `API Error ${res.status}`);
      } catch (e) {
        if (e.message === "QUOTA_LIMIT" || e.message === "AUTH_ERROR") throw e;
        if (i === 4) throw e;
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
      }
    }
  };

  const triggerUpdate = async (isAuto = false) => {
    if (isUpdating || !user) return;
    setIsUpdating(true);
    if (!isAuto) setErrorMsg(null);

    try {
      const result = await geminiFetch({
        contents: [{ parts: [{ text: `根据当前策略搜集最新商业情报动态：${strategy}` }] }],
        systemInstruction: { 
          parts: [{ text: "你是一个专业的商业情报专家。请抓取2条最新动态并严格返回 JSON 格式：{ 'items': [ { 'title': '标题', 'content': '内容', 'impact': '影响(10字内)', 'suggestion': '建议(10字内)', 'companies': ['公司名'] } ] }。不要输出任何 Markdown 格式。使用 Google Search 获取最新信息。" }] 
        },
        tools: [{ "google_search": {} }],
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0.1
        }
      });
      
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("AI 未返回有效内容");
      
      const parsed = JSON.parse(text);
      if (parsed.items && Array.isArray(parsed.items)) {
        const batch = writeBatch(db);
        parsed.items.forEach(item => {
          const d = doc(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel'));
          batch.set(d, { ...item, createdAt: serverTimestamp() });
        });
        const l = doc(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs'));
        batch.set(l, { strategy, count: parsed.items.length, type: isAuto ? 'AUTO' : 'MANUAL', createdAt: serverTimestamp() });
        await batch.commit();
      }
      setIsQuotaExceeded(false);
    } catch (err) { 
      console.error(err);
      if (err.message === "QUOTA_LIMIT") {
          setIsQuotaExceeded(true);
          setErrorMsg("AI 正在休息（额度限制，进入 60 秒冷却期）");
      } else {
          setErrorMsg("同步失败: " + err.message);
      }
    } finally { 
      setIsUpdating(false); 
      if (!isAuto) setCountdown(isQuotaExceeded ? 60 : 10); 
    }
  };

  const handleAdminLogin = () => {
    if (password === 'admin') setView('dashboard');
    else setErrorMsg("验证码错误 (默认 admin)");
  };

  const handleSaveStrategy = async () => {
    if (!db) return;
    try {
      await setDoc(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), { strategy, updatedAt: serverTimestamp() });
      setErrorMsg("策略已更新并保存到云端");
      setTimeout(() => setErrorMsg(null), 3000);
    } catch (e) {
      setErrorMsg("保存策略失败，请检查数据库权限。");
    }
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
        contents: [{ parts: [{ text: `请用专业的播报音朗读：标题是${item.title}。详情：${item.content}。影响分析：${item.impact}。建议：${item.suggestion}` }] }],
        generationConfig: { 
          responseModalities: ["AUDIO"], 
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } 
        }
      }, "generateContent", "gemini-2.5-flash-preview-tts");

      const audioData = res.candidates[0].content.parts[0].inlineData.data;
      const blob = new Blob([new Uint8Array(atob(audioData).split("").map(c => c.charCodeAt(0)))], { type: 'audio/wav' });
      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(blob);
        audioRef.current.play();
        audioRef.current.onended = () => setAudioState({ playing: false, id: null });
      }
    } catch (e) { 
      console.error("Audio error:", e);
      setAudioState({ playing: false, id: null }); 
    }
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
          {view === 'home' ? <><Settings size={16} /> 策略配置</> : <><ArrowLeft size={16} /> 返回雷达</>}
        </button>
      </nav>

      <main className="pt-24 pb-12 px-6 max-w-4xl mx-auto">
        {errorMsg && (
            <div className={`mb-8 p-4 border rounded-2xl flex items-center gap-3 text-sm font-bold animate-in fade-in slide-in-from-top-2 ${isQuotaExceeded ? 'bg-amber-50 border-amber-100 text-amber-700' : 'bg-red-50 border-red-100 text-red-600'}`}>
                {isQuotaExceeded ? <Coffee size={18} className="animate-bounce" /> : <AlertCircle size={18} />}
                {errorMsg}
            </div>
        )}

        {view === 'home' && (
          <div className="animate-in fade-in duration-700 slide-in-from-bottom-4">
            <header className="mb-12 flex justify-between items-end">
              <div>
                <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] tracking-widest mb-2 uppercase"><Sparkles size={12} className="animate-pulse"/> 实时监测中</div>
                <h2 className="text-4xl font-black tracking-tight text-slate-900">情报动态流</h2>
              </div>
              <div className={`px-5 py-1.5 rounded-2xl font-mono font-black text-2xl shadow-sm transition-all duration-300 ${isQuotaExceeded ? 'bg-slate-200 text-slate-400' : 'bg-slate-900 text-white'}`}>
                {countdown}s
              </div>
            </header>
            
            <div className="relative space-y-10">
              <div className="absolute left-8 top-4 bottom-4 w-px bg-slate-200"></div>
              {intelList.length === 0 && !isUpdating && (
                <div className="pl-20 py-24 text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 border border-dashed border-slate-200">
                    <Radar size={24} className="animate-spin-slow" />
                  </div>
                  <p className="text-slate-400 italic font-medium">尚未捕获到有效信号，请尝试点击策略配置进行手动抓取...</p>
                </div>
              )}
              {intelList.map((item) => (
                <article key={item.id} className="relative pl-20 group">
                  <div className="absolute left-[31px] w-[3px] h-[16px] bg-slate-300 rounded-full top-2 group-hover:bg-indigo-600 group-hover:h-12 transition-all duration-300"></div>
                  <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300">
                    <div className="flex justify-between mb-4 items-start gap-4">
                      <h3 className="text-2xl font-bold leading-tight text-slate-900">{item.title}</h3>
                      <button 
                        onClick={() => speakIntel(item)} 
                        className={`p-3 rounded-full transition-all shrink-0 ${audioState.id === item.id ? 'bg-indigo-600 text-white animate-pulse' : 'bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                      >
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
                    <div className="flex flex-wrap gap-3">
                      <div className="px-4 py-1.5 bg-blue-50 text-blue-700 rounded-2xl text-[11px] font-black uppercase flex items-center gap-2 border border-blue-100 shadow-sm">
                        <Zap size={14}/> {item.impact}
                      </div>
                      <div className="px-4 py-1.5 bg-emerald-50 text-emerald-700 rounded-2xl text-[11px] font-black uppercase flex items-center gap-2 border border-emerald-100 shadow-sm">
                        <Lightbulb size={14}/> {item.suggestion}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="max-w-md mx-auto bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-2xl text-center animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto mb-8 text-indigo-600 shadow-inner">
              <ShieldCheck size={40} />
            </div>
            <h2 className="text-3xl font-black mb-10 text-slate-900 tracking-tight">管理验证</h2>
            <input 
              type="password" 
              value={password} 
              onChange={(e)=>setPassword(e.target.value)} 
              placeholder="默认密码 admin" 
              className="w-full h-16 bg-slate-50 border-2 border-transparent rounded-2xl text-center text-xl font-bold mb-6 focus:border-indigo-600 focus:bg-white outline-none transition-all" 
            />
            <button 
              onClick={handleAdminLogin} 
              className="w-full h-16 bg-indigo-600 text-white rounded-2xl font-black text-lg hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95"
            >
              验证并进入
            </button>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-4xl font-black mb-12 tracking-tighter text-slate-900">控制中心 ✨</h2>
            <div className="grid lg:grid-cols-12 gap-10">
              <div className="lg:col-span-8">
                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                    <h4 className="font-black text-xl text-slate-900">抓取指令策略</h4>
                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">云端同步已开启</span>
                  </div>
                  <textarea 
                    value={strategy} 
                    onChange={(e)=>setStrategy(e.target.value)} 
                    className="w-full h-64 p-8 bg-slate-50 border-2 border-transparent rounded-3xl text-lg font-bold outline-none mb-8 focus:border-indigo-100 focus:bg-white transition-all" 
                    placeholder="输入你想关注的动态领域、关键词或出海方向..." 
                  />
                  <div className="grid sm:grid-cols-2 gap-4">
                    <button onClick={handleSaveStrategy} className="h-16 bg-slate-900 text-white rounded-2xl font-black hover:bg-black transition-all shadow-lg">
                      保存云端配置
                    </button>
                    <button 
                      onClick={()=>triggerUpdate(false)} 
                      disabled={isUpdating} 
                      className={`h-16 rounded-2xl font-black transition-all ${isUpdating ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95'}`}
                    >
                      {isUpdating ? '正在探测情报...' : '强制即刻探测'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-4 h-full">
                <div className="bg-white p-8 rounded-[3.5rem] border border-slate-100 shadow-sm h-full max-h-[700px] flex flex-col">
                  <h4 className="font-black text-xl mb-8 flex items-center gap-2 text-slate-400"><History size={20}/> 审计日志</h4>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {logs.length === 0 && <p className="text-slate-300 italic text-sm text-center py-10">尚无操作记录</p>}
                    {logs.map(log => (
                      <div key={log.id} className="p-5 bg-slate-50 rounded-2xl border border-slate-100 transition-hover hover:border-indigo-100">
                        <div className="flex justify-between mb-2">
                          <span className={`text-[9px] font-black px-2.5 py-0.5 rounded-full ${log.type === 'AUTO' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}>
                            {log.type === 'AUTO' ? '自动监测' : '手动干预'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {log.createdAt ? new Date(log.createdAt.seconds * 1000).toLocaleTimeString() : '同步中'}
                          </span>
                        </div>
                        <div className="text-[13px] font-bold text-slate-700">捕获到 {log.count} 条新信号</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 12s linear infinite;
        }
      `}</style>
    </div>
  );
};

export default App;
