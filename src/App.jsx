import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, query, onSnapshot, 
  serverTimestamp, doc, getDoc, setDoc, writeBatch 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Radar, ShieldCheck, RefreshCcw, Zap, 
  Lightbulb, History, Send, Settings, 
  ArrowLeft, Building2, BrainCircuit, Sparkles, Volume2, Pause, AlertCircle
} from 'lucide-react';

/**
 * --------------------------------------------------
 * ⚠️ PM 配置区：请在此处填入你的真实密钥
 * --------------------------------------------------
 */
const firebaseConfig = {
  apiKey: "AIzaSyB_-fLwf2_ftDdA3YsgnVzajw7hVPDCS1k",
  authDomain: "sugar-radar.firebaseapp.com",
  projectId: "sugar-radar",
  storageBucket: "sugar-radar.firebasestorage.app",
  messagingSenderId: "388090302429",
  appId: "1:388090302429:web:97657e8f4690a5b17e3034",
};

const GEMINI_API_KEY = "AIzaSyBu_Y8pO8Bv8iNuvHBvoE0v_o5EbDOBnPc";
const APP_ID_DB = "sugar-radar-prod-fast"; 

// 检查配置是否已填写
const isConfigReady = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("你的");

let app, auth, db;
if (isConfigReady) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

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
  
  const [audioState, setAudioState] = useState({ playing: false, id: null });
  const audioRef = useRef(null);

  useEffect(() => {
    if (!isConfigReady) return;
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) { setUser(u); } else {
        try { await signInAnonymously(auth); } catch (e) { setErrorMsg("Firebase 连接失败"); }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const qIntel = query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'intel'));
    const unsubIntel = onSnapshot(qIntel, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setIntelList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 50));
    });
    const qLogs = query(collection(db, 'artifacts', APP_ID_DB, 'public', 'data', 'logs'));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
    const fetchConfig = async () => {
      const docRef = doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main');
      const snap = await getDoc(docRef);
      if (snap.exists()) setStrategy(snap.data().strategy);
    };
    fetchConfig();
    return () => { unsubIntel(); unsubLogs(); };
  }, [user]);

  useEffect(() => {
    if (!user || !isConfigReady) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (!isUpdating) triggerUpdate(true); 
          return 10; 
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [strategy, user, isUpdating]);

  const geminiFetch = async (payload, endpoint = "generateContent", model = "gemini-2.5-flash-preview-09-2025") => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${GEMINI_API_KEY}`;
    let lastError = null;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) return await res.json();
        const errData = await res.json().catch(() => ({}));
        lastError = errData.error?.message || "API Error";
      } catch (e) { lastError = e.message; }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(lastError);
  };

  const triggerUpdate = async (isAuto = false) => {
    if (isUpdating || !user || !db) return;
    setIsUpdating(true);
    try {
      const result = await geminiFetch({
        contents: [{ parts: [{ text: `根据策略搜集2条最新动态：${strategy}` }] }],
        systemInstruction: { 
          parts: [{ text: "你是极速情报专家。抓取2条最新动态并返回 JSON：{ 'items': [ { 'title', 'content', 'impact', 'suggestion', 'companies': [] } ] }。必须识别涉及的公司主体名称。不要输出Markdown。" }] 
        },
        tools: [{ "google_search": {} }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
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
        batch.set(l, { strategy, count: parsed.items.length, type: isAuto ? 'AUTO' : 'MANUAL', createdAt: serverTimestamp() });
        await batch.commit();
      }
    } catch (err) { console.error(err); } 
    finally { setIsUpdating(false); if (!isAuto) setCountdown(10); }
  };

  const handleAdminLogin = () => {
    if (password === 'admin') setView('dashboard');
    else setErrorMsg("密码错误");
  };

  const handleSaveStrategy = async () => {
    await setDoc(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), { strategy, updatedAt: serverTimestamp() });
    setErrorMsg("策略已同步");
    setTimeout(() => setErrorMsg(null), 2000);
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
        contents: [{ parts: [{ text: `Say: ${item.title}。${item.content}。建议：${item.suggestion}` }] }],
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
      <nav className="fixed top-0 w-full h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg"><Radar size={20} /></div>
          <h1 className="text-xl font-black italic text-slate-900">Sugar Radar</h1>
        </div>
        <div>
          {view === 'home' ? (
            <button onClick={() => setView('admin')} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-bold border border-indigo-100"><Settings size={16} /> 策略配置</button>
          ) : (
            <button onClick={() => setView('home')} className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-500"><ArrowLeft size={16} /> 返回雷达</button>
          )}
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6 max-w-4xl mx-auto">
        {!isConfigReady && (
          <div className="py-20 text-center space-y-4">
             <AlertCircle className="mx-auto text-amber-500" size={48} />
             <h2 className="text-xl font-bold">请先配置 Key</h2>
             <p className="text-slate-500 text-sm">请在 <code>src/App.jsx</code> 中填入 Firebase 和 Gemini 的密钥。</p>
          </div>
        )}

        {isConfigReady && view === 'home' && (
          <div className="animate-in fade-in duration-700">
            <header className="mb-12 flex justify-between items-end">
              <div>
                <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] uppercase tracking-widest mb-2">Live 10s Cycle</div>
                <h2 className="text-4xl font-black tracking-tight">情报动态流</h2>
              </div>
              <div className="bg-slate-900 text-white px-4 py-1 rounded-full font-mono font-black text-xl">{countdown}s</div>
            </header>
            <div className="relative space-y-10">
              <div className="absolute left-8 top-4 bottom-4 w-px bg-slate-200"></div>
              {intelList.length === 0 && <div className="pl-20 py-20 text-slate-300 italic">同步中...</div>}
              {intelList.map((item) => (
                <article key={item.id} className="relative pl-20 group">
                  <div className="absolute left-[31px] w-[3px] h-[16px] bg-slate-300 rounded-full top-2 group-hover:bg-indigo-600 group-hover:h-12 transition-all"></div>
                  <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all">
                    <div className="flex justify-between mb-4 gap-4">
                      <h3 className="text-xl font-bold leading-tight">{item.title}</h3>
                      <button onClick={() => speakIntel(item)} className={`p-2 rounded-full shrink-0 ${audioState.id === item.id ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400'}`}>{audioState.id === item.id ? <Pause size={16}/> : <Volume2 size={16}/>}</button>
                    </div>
                    {item.companies && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {item.companies.map((c, i) => <span key={i} className="bg-slate-900 text-white text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-tighter"><Building2 size={10} className="inline mr-1"/>{c}</span>)}
                      </div>
                    )}
                    <p className="text-slate-500 mb-6 leading-relaxed">{item.content}</p>
                    <div className="flex gap-3">
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black uppercase"><Zap size={12} className="inline mr-1"/>{item.impact}</span>
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-xl text-[10px] font-black uppercase"><Lightbulb size={12} className="inline mr-1"/>{item.suggestion}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {isConfigReady && view === 'admin' && (
          <div className="h-[60vh] flex items-center justify-center p-8">
            <div className="max-w-md w-full bg-white p-12 rounded-[3.5rem] border shadow-2xl text-center">
              <ShieldCheck size={48} className="mx-auto mb-6 text-indigo-600" />
              <h2 className="text-3xl font-black mb-10">管理验证</h2>
              <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="PIN" className="w-full h-16 bg-slate-50 border-none rounded-2xl text-center text-xl font-bold mb-6 focus:ring-2 focus:ring-indigo-600 outline-none" />
              <button onClick={handleAdminLogin} className="w-full h-16 bg-indigo-600 text-white rounded-2xl font-black text-lg">验证并进入</button>
              {errorMsg && <p className="text-red-500 text-xs font-bold mt-4 uppercase">{errorMsg}</p>}
            </div>
          </div>
        )}

        {isConfigReady && view === 'dashboard' && (
          <div className="animate-in fade-in"><h2 className="text-4xl font-black mb-12 tracking-tighter text-slate-900">控制中心 ✨</h2><div className="grid lg:grid-cols-12 gap-10"><div className="lg:col-span-8"><div className="bg-white p-10 rounded-[3rem] border shadow-sm"><h4 className="font-black text-xl mb-6">抓取指令策略</h4><textarea value={strategy} onChange={(e)=>setStrategy(e.target.value)} className="w-full h-56 p-8 bg-slate-50 border-none rounded-3xl text-lg font-bold outline-none mb-8"/><div className="grid sm:grid-cols-2 gap-4"><button onClick={handleSaveStrategy} className="h-16 bg-slate-900 text-white rounded-2xl font-black">保存配置</button><button onClick={()=>triggerUpdate(false)} disabled={isUpdating} className={`h-16 rounded-2xl font-black ${isUpdating ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-100'}`}>{isUpdating ? '同步中...' : '强制即刻抓取'}</button></div>{errorMsg && <p className="mt-4 text-center text-blue-600 font-black text-xs uppercase">{errorMsg}</p>}</div></div><div className="lg:col-span-4 h-full"><div className="bg-white p-8 rounded-[3rem] border shadow-sm h-full max-h-[600px] flex flex-col"><h4 className="font-black text-xl mb-8 flex items-center gap-2"><History size={18}/> 审计日志</h4><div className="flex-1 overflow-y-auto space-y-3">{logs.map(log => <div key={log.id} className="p-4 bg-slate-50 rounded-2xl border"><div className="flex justify-between mb-2"><span className={`text-[8px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full ${log.type === 'AUTO' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}>{log.type}</span></div><div className="text-[10px] font-bold">已同步: {log.count} 条动态</div></div>)}</div></div></div></div></div>
        )}
      </main>
    </div>
  );
};

export default App;
