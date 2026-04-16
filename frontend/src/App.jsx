import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  House, 
  PaperPlaneTilt, 
  Clock, 
  Gear, 
  CheckCircle, 
  WarningCircle, 
  ArrowRight, 
  Database, 
  UploadSimple, 
  SignOut,
  CaretDown,
  ChartLine,
  Pause,
  Play,
  Square,
  DownloadSimple,
  MagnifyingGlass,
  ArrowsClockwise,
  ArrowCounterClockwise,
  List,
  X,
  Eye,
  EyeSlash,
  ShieldCheck,
  ArrowLeft,
  ChatCircleDots
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const API_BASE = window.location.hostname === 'localhost' && window.location.port === '5173' 
  ? 'http://localhost:3001' 
  : '';

const PAGE_TRANSITION = {
  initial: { opacity: 0, x: 5 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -5 },
  transition: { duration: 0.2 }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('home');

  // AUTH STATE
  const [token, setToken] = useState(localStorage.getItem('tim_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('tim_user') || 'null'));
  const [authView, setAuthView] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');

  // APP STATE
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [csvData, setCsvData] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [status, setStatus] = useState('');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageType, setMessageType] = useState('template');
  const [customMessage, setCustomMessage] = useState('');
  const [mapping, setMapping] = useState({});
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [config, setConfig] = useState({ PHONE_NUMBER_ID: '', WABA_ID: '', ACCESS_TOKEN: '' });
  const [isConnected, setIsConnected] = useState(false);
  const [metaSynced, setMetaSynced] = useState(false);
  const [isLoading, setIsLoading] = useState({ templates: false, send: false, config: false });
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshingTemplates, setRefreshingTemplates] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null);
  const [expandedHistoryJob, setExpandedHistoryJob] = useState(null);
  const [revealCredentials, setRevealCredentials] = useState(false);
  const [chats, setChats] = useState([]);
  const [activeChatPhone, setActiveChatPhone] = useState(null);
  const [activeChatHistory, setActiveChatHistory] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  // ──────────────── AUTH ────────────────

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = authView === 'login' ? '/auth/login' : '/auth/register';
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      if (authView === 'login') {
        setToken(data.token);
        setUser({ username: data.username });
        localStorage.setItem('tim_token', data.token);
        localStorage.setItem('tim_user', JSON.stringify({ username: data.username }));
      } else {
        setAuthView('login');
        setAuthError('Account created! Please login.');
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const logout = () => {
    setToken('');
    setUser(null);
    localStorage.removeItem('tim_token');
    localStorage.removeItem('tim_user');
  };

  // ──────────────── FETCH HELPER ────────────────

  const fetchWithAuth = (url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`
      }
    });
  };

  // ──────────────── STATS (was missing — caused crash) ────────────────

  const stats = useMemo(() => {
    let totalSent = 0, totalFailed = 0;
    historyData.forEach(job => {
      const sent = job.results ? job.results.filter(r => r.status?.includes('Sent') || r.status?.includes('Delivered') || r.status?.includes('Read')).length : (job.sent || 0);
      const failed = job.results ? job.results.filter(r => r.status?.includes('Failed')).length : (job.failed || 0);
      totalSent += sent;
      totalFailed += failed;
    });
    return { totalSent, totalFailed };
  }, [historyData]);

  // ──────────────── INITIAL LOAD ────────────────

  useEffect(() => {
    if (!token) return;

    fetchWithAuth(`${API_BASE}/api/config`)
      .then(r => { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(data => {
        setConfig(data);
        if (data.PHONE_NUMBER_ID && data.ACCESS_TOKEN) {
          setIsConnected(true);
          fetchWithAuth(`${API_BASE}/api/templates`).then(r => r.json()).then(tpls => {
            if (Array.isArray(tpls)) { setMetaSynced(true); setTemplates(tpls); }
          }).catch(() => setMetaSynced(false));
        }
      })
      .catch(() => { /* token might be expired */ logout(); });

    fetchWithAuth(`${API_BASE}/api/history`).then(r => r.json()).then(d => {
      if (Array.isArray(d)) setHistoryData(d);
    }).catch(() => {});
  }, [token]);

  // ──────────────── JOB POLLING ────────────────

  useEffect(() => {
    if (!jobId || !token) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/status/${jobId}`);
        const data = await res.json();
        if (data.error) { setJobId(null); return; }
        setJobStatus(data);
        if (data.status === 'Completed' || data.status === 'Stopped') {
          clearInterval(interval);
          fetchWithAuth(`${API_BASE}/api/history`).then(r => r.json()).then(d => { if (Array.isArray(d)) setHistoryData(d); });
        }
      } catch (e) {}
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId, token]);

  // ──────────────── INBOX POLLING ────────────────

  useEffect(() => {
    if (!token) return;
    const fetchChats = () => {
      fetchWithAuth(`${API_BASE}/api/chats`).then(r => r.json()).then(d => { if (Array.isArray(d)) setChats(d); }).catch(() => {});
    };
    fetchChats();
    const interval = setInterval(fetchChats, 5000);
    return () => clearInterval(interval);
  }, [token, activeTab]);

  // ──────────────── ACTIVE CHAT POLLING ────────────────

  useEffect(() => {
    if (!token || activeTab !== 'inbox' || !activeChatPhone) return;
    const fetchHistory = () => {
      fetchWithAuth(`${API_BASE}/api/chats/${activeChatPhone}`).then(r => r.json()).then(d => { if (Array.isArray(d)) setActiveChatHistory(d); }).catch(() => {});
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 3000);
    return () => clearInterval(interval);
  }, [token, activeTab, activeChatPhone]);

  // ──────────────── CORE FUNCTIONS ────────────────

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);
    setStatus('Parsing CSV...');
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      setCsvHeaders(headers);
      const data = lines.slice(1).filter(l => l.trim()).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        return headers.reduce((obj, header, index) => {
          obj[header] = values[index];
          return obj;
        }, {});
      });
      setCsvData(data);
      setStatus(`Loaded ${data.length} contacts.`);
    };
    reader.readAsText(uploadedFile);
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    setIsLoading(p => ({ ...p, config: true }));
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setIsConnected(true);
        setStatus('Configuration saved successfully!');
        handleTemplateRefresh();
      }
    } catch (err) {
      setStatus('Error saving configuration');
    } finally {
      setIsLoading(p => ({ ...p, config: false }));
    }
  };

  const handleTemplateRefresh = async () => {
    setRefreshingTemplates(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/templates`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setTemplates(data);
        setMetaSynced(true);
      }
    } catch (e) {
      setMetaSynced(false);
    } finally {
      setRefreshingTemplates(false);
    }
  };

  const handleSend = async () => {
    if (!selectedTemplate && messageType !== 'text') return;
    setIsLoading(p => ({ ...p, send: true }));
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: csvData,
          messageType,
          templateName: selectedTemplate,
          textBody: customMessage,
          mapping
        })
      });
      const data = await res.json();
      if (data.jobId) {
        setJobId(data.jobId);
        setActiveTab('status');
      }
    } catch (e) {
      setStatus('Error starting campaign');
    } finally {
      setIsLoading(p => ({ ...p, send: false }));
    }
  };

  const sendReply = async () => {
    if (!replyText.trim() || !activeChatPhone) return;
    setIsSendingReply(true);
    try {
      await fetchWithAuth(`${API_BASE}/api/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: activeChatPhone, text: replyText })
      });
      setReplyText('');
      const hRes = await fetchWithAuth(`${API_BASE}/api/chats/${activeChatPhone}`);
      const hData = await hRes.json();
      if (Array.isArray(hData)) setActiveChatHistory(hData);
    } catch (err) {
      console.error('Reply failed');
    } finally {
      setIsSendingReply(false);
    }
  };

  // ══════════════════════════════════════════════════
  //  LOGIN PAGE
  // ══════════════════════════════════════════════════

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#1e293b] rounded-2xl border border-white/5 p-8 shadow-2xl"
        >
          <div className="text-center mb-8">
            <div className="inline-flex p-3 bg-emerald-500/10 rounded-xl mb-4">
              <PaperPlaneTilt weight="fill" className="text-emerald-500 w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">TIM Cloud</h1>
            <p className="text-slate-400 text-sm mt-2">Professional WhatsApp CRM</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Username</label>
              <input 
                type="text"
                required
                className="w-full bg-[#0f172a] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
                placeholder="Enter your username"
                value={authForm.username}
                onChange={e => setAuthForm({...authForm, username: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Password</label>
              <input 
                type="password"
                required
                className="w-full bg-[#0f172a] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
                placeholder="••••••••"
                value={authForm.password}
                onChange={e => setAuthForm({...authForm, password: e.target.value})}
              />
            </div>

            {authError && (
              <div className={`p-3 ${authError.includes('created') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-500'} border rounded-lg text-xs text-center`}>
                {authError}
              </div>
            )}

            <button 
              type="submit"
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
            >
              {authView === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button 
              onClick={() => { setAuthView(authView === 'login' ? 'signup' : 'login'); setAuthError(''); }}
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              {authView === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════
  //  MAIN DASHBOARD (only rendered when logged in)
  // ══════════════════════════════════════════════════

  return (
    <div className="flex h-screen bg-[#0f172a] text-slate-200 overflow-hidden font-sans">
      {/* ── SIDEBAR ── */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 240 : 80 }}
        className="bg-[#1e293b] border-r border-white/5 flex flex-col transition-all duration-300 relative z-40"
      >
        <div className="p-6 flex items-center gap-4 border-b border-white/5 h-20 overflow-hidden">
          <div className="bg-emerald-500 p-2 rounded-xl shrink-0 shadow-lg shadow-emerald-500/20">
            <PaperPlaneTilt weight="bold" size={24} className="text-white" />
          </div>
          <AnimatePresence>
            {sidebarOpen && (
              <motion.span {...PAGE_TRANSITION} className="font-bold text-lg text-white whitespace-nowrap">
                TIM <span className="text-emerald-500">Cloud</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-4 overflow-x-hidden">
          {[
            { id: 'home', icon: House, label: 'Dashboard' },
            { id: 'campaign', icon: Plus, label: 'Campaign' },
            { id: 'inbox', icon: ChatCircleDots, label: 'Inbox' },
            { id: 'history', icon: Clock, label: 'History' },
            { id: 'config', icon: Gear, label: 'Settings' }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-4 p-3 rounded-xl transition-all group relative",
                activeTab === item.id 
                  ? "bg-emerald-500/10 text-emerald-500" 
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <item.icon weight={activeTab === item.id ? "fill" : "regular"} size={22} />
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.span {...PAGE_TRANSITION} className="font-medium whitespace-nowrap">
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {!sidebarOpen && (
                <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                  {item.label}
                </div>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5 mb-4">
           <div className="flex items-center gap-3 p-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-xs shrink-0">
                 {user?.username?.[0]?.toUpperCase()}
              </div>
              {sidebarOpen && <span className="text-xs font-medium text-slate-400 truncate">{user?.username}</span>}
           </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-4 p-3 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-500 transition-all font-medium"
          >
            <SignOut size={22} />
            <AnimatePresence>
              {sidebarOpen && <motion.span {...PAGE_TRANSITION}>Sign Out</motion.span>}
            </AnimatePresence>
          </button>
        </div>

        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-24 w-6 h-6 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 active:scale-90 transition-all z-50 border-2 border-[#0f172a]"
        >
          <CaretDown size={14} className={cn("transition-transform", sidebarOpen ? "rotate-90" : "-rotate-90")} />
        </button>
      </motion.aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 overflow-auto relative">
        <div className="max-w-7xl mx-auto p-8 pb-32">

          {/* ── DASHBOARD TAB ── */}
          {activeTab === 'home' && (
            <motion.div {...PAGE_TRANSITION} className="space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard Overview</h1>
                  <p className="text-slate-400 mt-1">Welcome back, <b>{user?.username}</b>. Here are your metrics.</p>
                </div>
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-xl">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className={`text-xs font-semibold uppercase tracking-wider ${isConnected ? 'text-emerald-500' : 'text-red-500'}`}>
                    {isConnected ? 'Connected' : 'Not Configured'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: 'Total Messages', value: stats.totalSent + stats.totalFailed, icon: PaperPlaneTilt, color: 'emerald' },
                  { label: 'Successfully Sent', value: stats.totalSent, icon: CheckCircle, color: 'sky' },
                  { label: 'Failed Delivery', value: stats.totalFailed, icon: WarningCircle, color: 'red' },
                  { label: 'Campaigns', value: historyData.length, icon: ChartLine, color: 'violet' }
                ].map((stat, i) => (
                  <motion.div 
                    key={i}
                    whileHover={{ y: -4, scale: 1.01 }}
                    className="bg-[#1e293b] p-6 rounded-2xl border border-white/5 relative overflow-hidden group shadow-xl"
                  >
                    <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity text-${stat.color}-500`}>
                      <stat.icon size={80} weight="bold" />
                    </div>
                    <p className="text-slate-400 text-sm font-medium">{stat.label}</p>
                    <h3 className="text-3xl font-bold text-white mt-1">{stat.value.toLocaleString()}</h3>
                  </motion.div>
                ))}
              </div>

              {!isConnected && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 text-center">
                  <p className="text-amber-400 font-medium">⚠️ WhatsApp not configured yet</p>
                  <p className="text-slate-400 text-sm mt-2">Go to <button onClick={() => setActiveTab('config')} className="text-emerald-500 underline font-bold">Settings</button> to add your Meta credentials.</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── CONFIG TAB ── */}
          {activeTab === 'config' && (
            <motion.div {...PAGE_TRANSITION} className="max-w-2xl mx-auto">
              <div className="bg-[#1e293b] rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
                <div className="p-8 border-b border-white/5 bg-gradient-to-r from-emerald-500/5 to-transparent">
                  <h2 className="text-2xl font-bold text-emerald-500 flex items-center gap-3">
                    <Gear size={28} weight="bold" /> Configuration
                  </h2>
                  <p className="text-slate-400 mt-2 text-sm leading-relaxed">Your WhatsApp Cloud API credentials. Private to your account.</p>
                </div>
                <form onSubmit={saveConfig} className="p-8 space-y-6">
                  <div className="grid grid-cols-1 gap-6">
                    {[
                      { key: 'PHONE_NUMBER_ID', label: 'Phone Number ID', placeholder: 'e.g. 10012345678', icon: Database },
                      { key: 'WABA_ID', label: 'WhatsApp Business Account ID', placeholder: 'e.g. 1971234567', icon: ShieldCheck },
                      { key: 'ACCESS_TOKEN', label: 'Permanent Access Token', placeholder: 'EAAN...', icon: ShieldCheck, secret: true }
                    ].map((field) => (
                      <div key={field.key}>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                           <field.icon size={14} /> {field.label}
                        </label>
                        <div className="relative group">
                           <input
                             type={field.secret && !revealCredentials ? "password" : "text"}
                             value={config[field.key] || ''}
                             onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                             className="w-full bg-[#0f172a] border border-white/10 rounded-xl px-5 py-3.5 text-white/90 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/40 transition-all shadow-inner"
                             placeholder={field.placeholder}
                           />
                           {field.secret && (
                             <button 
                               type="button"
                               onClick={() => setRevealCredentials(!revealCredentials)}
                               className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-emerald-500 transition-colors"
                             >
                               {revealCredentials ? <EyeSlash size={20} /> : <Eye size={20} />}
                             </button>
                           )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {status && (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs text-center">
                      {status}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading.config}
                    className={cn(
                      "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all",
                      isLoading.config ? "bg-slate-700 opacity-50" : "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
                    )}
                  >
                    {isLoading.config ? <ArrowsClockwise className="animate-spin" size={20} /> : <CheckCircle size={22} weight="bold" />}
                    Save Configuration
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {/* ── CAMPAIGN TAB ── */}
          {activeTab === 'campaign' && (
            <motion.div {...PAGE_TRANSITION} className="space-y-8">
              <div className="bg-[#1e293b] rounded-2xl border border-white/5 p-8 shadow-xl">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-white">1. Upload Contacts (CSV)</h2>
                  {file && <span className="text-xs text-emerald-500 font-medium">✓ {file.name} ({csvData.length} contacts)</span>}
                </div>
                <div 
                  onClick={() => document.getElementById('csv-upload').click()}
                  className="border-2 border-dashed border-white/10 rounded-2xl p-10 text-center hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all cursor-pointer group"
                >
                  <UploadSimple size={48} weight="duotone" className="mx-auto text-slate-500 group-hover:text-emerald-500 transition-colors mb-4" />
                  <p className="text-slate-300 font-medium">Drop your CSV here or click to browse</p>
                  <p className="text-slate-500 text-xs mt-2 uppercase tracking-widest font-bold">CSV with phone column • E.164 Format</p>
                  <input id="csv-upload" key={fileKey} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </div>
              </div>

              {csvData.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                  <div className="bg-[#1e293b] rounded-2xl border border-white/5 p-8 shadow-xl">
                    <h2 className="text-xl font-bold text-white mb-6">2. Select Message Type</h2>
                    <div className="flex gap-4 p-1 bg-[#0f172a] rounded-xl w-fit">
                      <button onClick={() => setMessageType('template')} className={cn("px-6 py-2 rounded-lg text-sm font-bold transition-all", messageType === 'template' ? "bg-emerald-500 text-white shadow-lg" : "text-slate-400 hover:text-white")}>Template</button>
                      <button onClick={() => setMessageType('text')} className={cn("px-6 py-2 rounded-lg text-sm font-bold transition-all", messageType === 'text' ? "bg-emerald-500 text-white shadow-lg" : "text-slate-400 hover:text-white")}>Custom Text</button>
                    </div>

                    {messageType === 'template' && templates.length > 0 && (
                      <div className="mt-6">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Select Template</label>
                        <select 
                          value={selectedTemplate} 
                          onChange={e => setSelectedTemplate(e.target.value)}
                          className="w-full bg-[#0f172a] border border-white/10 rounded-xl px-5 py-3.5 text-white focus:outline-none focus:border-emerald-500/40"
                        >
                          <option value="">Choose a template...</option>
                          {templates.map(t => <option key={t.name} value={t.name}>{t.name} ({t.language})</option>)}
                        </select>
                      </div>
                    )}

                    {messageType === 'text' && (
                      <div className="mt-6">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Message Body</label>
                        <textarea
                          value={customMessage}
                          onChange={e => setCustomMessage(e.target.value)}
                          rows={4}
                          className="w-full bg-[#0f172a] border border-white/10 rounded-xl px-5 py-3.5 text-white focus:outline-none focus:border-emerald-500/40 resize-none"
                          placeholder="Enter your message here..."
                        />
                      </div>
                    )}
                  </div>

                  <div className="bg-[#1e293b] rounded-2xl border border-white/5 p-8">
                    <h2 className="text-xl font-bold text-white mb-6">3. Field Mapping</h2>
                    <div className="mb-6">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Phone Number Column</label>
                      <select 
                        value={mapping.phone || ''} 
                        onChange={e => setMapping({...mapping, phone: e.target.value})}
                        className="w-full bg-[#0f172a] border border-white/10 rounded-xl px-5 py-3.5 text-white focus:outline-none focus:border-emerald-500/40"
                      >
                        <option value="">Select phone column...</option>
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>

                    <button 
                      onClick={handleSend} 
                      disabled={isLoading.send || (!mapping.phone)}
                      className={cn(
                        "w-full py-4 font-bold rounded-xl flex items-center justify-center gap-3 transition-all",
                        isLoading.send || !mapping.phone ? "bg-slate-700 opacity-50 cursor-not-allowed" : "bg-emerald-500 text-white shadow-lg hover:bg-emerald-400 active:scale-[0.98]"
                      )}
                    >
                      {isLoading.send ? <ArrowsClockwise className="animate-spin" size={20} /> : <PaperPlaneTilt size={22} weight="bold" />}
                      Launch Campaign 🚀
                    </button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ── STATUS TAB ── */}
          {activeTab === 'status' && jobStatus && (
            <motion.div {...PAGE_TRANSITION} className="space-y-6">
              <h1 className="text-2xl font-bold text-white">Campaign Progress</h1>
              <div className="bg-[#1e293b] rounded-2xl border border-white/5 p-8">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-lg font-bold">{jobStatus.name || 'Campaign'}</span>
                  <span className={`text-xs px-3 py-1 rounded-full font-bold ${jobStatus.status === 'Running' ? 'bg-blue-500/10 text-blue-400' : jobStatus.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    {jobStatus.status}
                  </span>
                </div>
                <div className="w-full bg-[#0f172a] rounded-full h-4 overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: `${jobStatus.total ? (jobStatus.processed / jobStatus.total * 100) : 0}%` }}
                  />
                </div>
                <p className="text-sm text-slate-400 mt-3">{jobStatus.processed || 0} / {jobStatus.total || 0} processed</p>
              </div>
            </motion.div>
          )}

          {/* ── HISTORY TAB ── */}
          {activeTab === 'history' && (
            <motion.div {...PAGE_TRANSITION} className="space-y-6">
              <h1 className="text-2xl font-bold text-white">Campaign History</h1>
              {historyData.length === 0 ? (
                <div className="bg-[#1e293b] rounded-2xl border border-white/5 p-12 text-center">
                  <Clock size={48} className="mx-auto text-slate-600 mb-4" />
                  <p className="text-slate-400">No campaigns yet. Start one from the Campaign tab!</p>
                </div>
              ) : (
                historyData.map((job, i) => (
                  <div key={job.id || i} className="bg-[#1e293b] p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex justify-between items-center">
                      <h3 className="font-bold text-white">{job.name || 'Campaign'}</h3>
                      <span className={`text-xs px-3 py-1 rounded-full font-bold ${job.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400' : job.status === 'Running' ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-500/10 text-slate-400'}`}>
                        {job.status}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-3 text-xs text-slate-500">
                      <span>Total: {job.totalContacts || job.total || '—'}</span>
                      <span>Sent: {job.sent || '—'}</span>
                      <span>Failed: {job.failed || '—'}</span>
                      {job.timestamp && <span>• {new Date(job.timestamp).toLocaleString()}</span>}
                    </div>
                  </div>
                ))
              )}
            </motion.div>
          )}

          {/* ── INBOX TAB ── */}
          {activeTab === 'inbox' && (
            <motion.div {...PAGE_TRANSITION} className="h-[calc(100vh-160px)] flex gap-6">
              <div className="w-80 bg-[#1e293b] rounded-2xl border border-white/5 overflow-hidden flex flex-col shadow-xl shrink-0">
                <div className="p-4 border-b border-white/5">
                  <h2 className="font-bold flex items-center gap-2">
                    <ChatCircleDots size={20} /> My Chats
                    <span className="ml-auto text-xs text-slate-500">{chats.length}</span>
                  </h2>
                </div>
                <div className="flex-1 overflow-auto">
                  {chats.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-sm italic">No conversations yet</div>
                  ) : (
                    chats.map(chat => (
                      <button 
                        key={chat.phone}
                        onClick={() => setActiveChatPhone(chat.phone)}
                        className={cn("w-full p-4 text-left border-b border-white/5 hover:bg-white/5 transition-colors", activeChatPhone === chat.phone && "bg-emerald-500/5 border-r-2 border-r-emerald-500")}
                      >
                        <p className="font-bold text-sm truncate">{chat.name || chat.phone}</p>
                        <p className="text-xs text-slate-500 truncate mt-1">{chat.messages?.[chat.messages.length-1]?.text || '...'}</p>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="flex-1 bg-[#1e293b] rounded-2xl border border-white/5 flex flex-col shadow-xl overflow-hidden">
                {activeChatPhone ? (
                  <>
                    <div className="p-4 border-b border-white/5 bg-white/5">
                      <h2 className="font-bold">{activeChatPhone}</h2>
                    </div>
                    <div className="flex-1 overflow-auto p-6 space-y-4">
                      {activeChatHistory.map((m, i) => (
                        <div key={i} className={cn("flex", m.from === 'me' ? "justify-end" : "justify-start")}>
                          <div className={cn("max-w-[80%] p-4 rounded-2xl", m.from === 'me' ? "bg-emerald-500 text-white rounded-tr-none" : "bg-[#0f172a] text-slate-200 rounded-tl-none")}>
                            <p className="text-sm">{m.text}</p>
                            <p className="text-[10px] opacity-50 mt-1">{m.timestamp ? new Date(parseInt(m.timestamp)).toLocaleTimeString() : ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-4 border-t border-white/5 bg-[#0f172a]">
                      <div className="flex gap-2">
                        <input 
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && sendReply()}
                          placeholder="Type a message..."
                          className="flex-1 bg-[#1e293b] border border-white/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50"
                        />
                        <button 
                          onClick={sendReply} 
                          disabled={isSendingReply}
                          className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-400 disabled:opacity-50"
                        >
                          <PaperPlaneTilt size={20} weight="bold" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-slate-500 italic">
                    Select a chat to start messaging
                  </div>
                )}
              </div>
            </motion.div>
          )}

        </div>
      </main>
    </div>
  );
}
