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
  ArrowLeft, Building2, Volume2, Pause, AlertCircle, Sparkles
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

// ⚠️ 修复建议：请访问 https://aistudio.google.com/ 重新获取 Key 并替换下方字符串
const GEMINI_API_KEY = "AIzaSyC8eaRkyMNTvcUU3f5CR8HI5aIBub7-6-s"; 
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
  const [audioState, setAudioState] = useState({ playing: false, id: null });
  const audioRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) { setUser(u); } else {
        try { await signInAnonymously(auth); } catch (e) { setErrorMsg("Firebase 身份验证失败"); }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
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
    if (!user) return;
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

  const geminiFetch = async (payload, endpoint = "generateContent", model = "gemini-2.0-flash") => {
    if (GEMINI_API_KEY.includes("在此填入")) {
        throw new Error("检测到 API Key 仍为占位符，请先填入真实的 Key。");
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${GEMINI_API_KEY}`;
    
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        
        if (!res.ok) {
            // 针对 Key 过期的特殊提示
            if (data.error?.message?.includes("expired") || res.status === 403) {
                throw new Error("API Key 已过期或失效，请前往 Google AI Studio 重新申请。");
            }
            throw new Error(data.error?.message || "Gemini API 异常");
        }
        return data;
    } catch (e) {
        throw e;
    }
  };

  const triggerUpdate = async (isAuto = false) => {
    if (isUpdating || !user) return;
    setIsUpdating(true);
    if (!isAuto) setErrorMsg(null);

    try {
      const result = await geminiFetch({
        contents: [{ parts: [{ text: `根据策略搜集最新情报：${strategy}` }] }],
        systemInstruction: { 
          parts: [{ text: "你是情报专家。返回JSON：{ 'items': [ { 'title', 'content', 'impact', 'suggestion', 'companies': [] } ] }。抓取2条，必须识别公司名。不要输出Markdown。" }] 
        },
        tools: [{ "google_search": {} }],
        generationConfig: { responseMimeType: "application/json" }
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
    } catch (err) { 
      console.error(err);
      setErrorMsg("同步失败: " + err.message);
    } finally { 
      setIsUpdating(false); 
      if (!isAuto) setCountdown(10); 
    }
  };

  const handleAdminLogin = () => {
    if (password === 'admin') setView('dashboard');
    else setErrorMsg("验证码错误");
  };

  const handleSaveStrategy = async () => {
    await setDoc(doc(db, 'artifacts', APP_ID_DB, 'public', 'data', 'config', 'main'), { strategy, updatedAt: serverTimestamp() });
    setErrorMsg("策略已更新");
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
        contents: [{ parts: [{ text: `播报：${item.title}。${item.content}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } }
      }, "generateContent", "gemini-2.0-flash");
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
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B]">
      <audio ref={audioRef} className="hidden" />
      <nav className="fixed top-0 w-full h-16 bg-white/80 backdrop-blur-md border-b flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg"><Radar size={20} /></div>
          <h1 className="text-xl font-black italic">Sugar Radar</h1>
        </div>
        <button onClick={() => setView(view === 'home' ? 'admin' : 'home')} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-bold">
          {view === 'home' ? '策略配置' : '返回首页'}
        </button>
      </nav>

      <main className="pt-24 pb-12 px-6 max-w-4xl mx-auto">
        {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-bold animate-pulse">
                <AlertCircle size={18} />
                {errorMsg}
            </div>
        )}

        {view === 'home' && (
          <div className="animate-in fade-in duration-700">
            <header className="mb-12 flex justify-between items-end">
              <div>
                <div className="flex items-center gap-2 text-indigo-600 font-black text-[10px] tracking-widest mb-2"><Sparkles size={12}/> LIVE MONITORING</div>
                <h2 className="text-4xl font-black">情报动态流</h2>
              </div>
              <div className="bg-slate-900 text-white px-4 py-1 rounded-full font-mono font-black text-xl">{countdown}s</div>
            </header>
            
            <div className="relative space-y-10">
              <div className="absolute left-8 top-4 bottom-4 w-px bg-slate-200"></div>
              {intelList.length === 0 && !isUpdating && <div className="pl-20 py-20 text-slate-300 italic">正在等待 AI 探测情报...</div>}
              {intelList.map((item) => (
                <article key={item.id} className="relative pl-20 group">
                  <div className="absolute left-[31px] w-[3px] h-[16px] bg-slate-300 rounded-full top-2 group-hover:bg-indigo-600 group-hover:h-12 transition-all"></div>
                  <div className="bg-white p-6 rounded-[2.5rem] border shadow-sm hover:shadow-xl transition-all">
                    <div className="flex justify-between mb-4">
                      <h3 className="text-xl font-bold">{item.title}</h3>
                      <button onClick={() => speakIntel(item)} className="p-2 bg-slate-50 rounded-full text-slate-400">
                        {audioState.id === item.id ? <Pause size={16}/> : <Volume2 size={16}/>}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {item.companies?.map((c, i) => <span key={i} className="bg-slate-900 text-white text-[10px] font-black px-2 py-1 rounded uppercase tracking-tighter"><Building2 size={10} className="inline mr-1"/>{c}</span>)}
                    </div>
                    <p className="text-slate-500 mb-6">{item.content}</p>
                    <div className="flex gap-3 text-[10px] font-black uppercase">
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-xl"><Zap size={12} className="inline mr-1"/>{item.impact}</span>
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-xl"><Lightbulb size={12} className="inline mr-1"/>{item.suggestion}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {view === 'admin' && (
          <div className="max-w-md mx-auto bg-white p-10 rounded-[3rem] border shadow-2xl text-center">
            <ShieldCheck size={48} className="mx-auto mb-6 text-indigo-600" />
            <h2 className="text-2xl font-black mb-6">管理验证</h2>
            <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="密码" className="w-full p-4 bg-slate-50 rounded-2xl mb-4 text-center text-xl font-bold" />
            <button onClick={handleAdminLogin} className="w-full p-4 bg-indigo-600 text-white rounded-2xl font-black">验证</button>
          </div>
        )}

        {view === 'dashboard' && (
          <div className="bg-white p-8 rounded-[3rem] border shadow-sm">
            <h2 className="text-2xl font-black mb-6">抓取策略配置</h2>
            <textarea value={strategy} onChange={(e)=>setStrategy(e.target.value)} className="w-full h-40 p-4 bg-slate-50 rounded-2xl mb-6 outline-none" />
            <div className="grid grid-cols-2 gap-4">
              <button onClick={handleSaveStrategy} className="p-4 bg-slate-900 text-white rounded-2xl font-black">保存策略</button>
              <button onClick={()=>triggerUpdate(false)} disabled={isUpdating} className="p-4 bg-indigo-600 text-white rounded-2xl font-black">
                {isUpdating ? '抓取中...' : '即刻抓取'}
              </button>
            </div>
            <div className="mt-10 border-t pt-6">
              <h4 className="font-black mb-4 flex items-center gap-2"><History size={16}/> 审计日志</h4>
              <div className="space-y-2">
                {logs.slice(0, 5).map(log => (
                  <div key={log.id} className="text-xs p-3 bg-slate-50 rounded-xl flex justify-between items-center">
                    <span>探测到 {log.count} 条新动态</span>
                    <span className="text-slate-400 font-mono">{log.type}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
