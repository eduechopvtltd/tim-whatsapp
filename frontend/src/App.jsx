import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  ChatCircleDots,
  Paperclip,
  ImageSquare,
  VideoCamera,
  FileText,
  Phone,
  ArrowSquareOut,
  Envelope
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

  // ═══════════ AUTH STATE ═══════════
  const [token, setToken] = useState(localStorage.getItem('tim_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('tim_user') || 'null'));
  const [authView, setAuthView] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');

  // ═══════════ APP STATE ═══════════
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
  const [registrationPin, setRegistrationPin] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [debouncedHistorySearch, setDebouncedHistorySearch] = useState('');
  const [revealCredentials, setRevealCredentials] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadedMediaId, setUploadedMediaId] = useState(null);
  const [localMediaUrl, setLocalMediaUrl] = useState(null);
  const [chats, setChats] = useState([]);
  const [activeChatPhone, setActiveChatPhone] = useState(null);
  const [activeChatHistory, setActiveChatHistory] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [emailConfig, setEmailConfig] = useState({ enabled: false, smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', notifyEmail: '' });
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);

  // ═══════════ AUTH FUNCTIONS ═══════════
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
    setToken(''); setUser(null);
    localStorage.removeItem('tim_token');
    localStorage.removeItem('tim_user');
  };

  // ═══════════ FETCH WITH AUTH ═══════════
  const fetchWithAuth = (url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: { ...options.headers, 'Authorization': `Bearer ${token}` }
    });
  };

  // ═══════════ INITIAL LOAD ═══════════
  useEffect(() => {
    if (!token) return;
    fetchWithAuth(`${API_BASE}/api/config`).then(r => { if (!r.ok) throw new Error('auth'); return r.json(); }).then(data => {
      setConfig(data);
      if (data.emailConfig) setEmailConfig(data.emailConfig);
      if (data.PHONE_NUMBER_ID && data.ACCESS_TOKEN) {
        setIsConnected(true);
        fetchWithAuth(`${API_BASE}/api/templates`).then(r => r.json()).then(tpls => {
          if (Array.isArray(tpls)) { setMetaSynced(true); setTemplates(tpls); }
        }).catch(() => setMetaSynced(false));
      }
    }).catch(() => logout());
    fetchWithAuth(`${API_BASE}/api/active-job`).then(r => r.json()).then(data => {
      if (data.jobId) { setJobId(data.jobId); setJobStatus(data.status || data); setActiveTab('status'); }
    }).catch(() => {});
    fetchWithAuth(`${API_BASE}/api/history`).then(r => r.json()).then(d => { if (Array.isArray(d)) setHistoryData(d); }).catch(() => {});
  }, [token]);

  // REAL-TIME CONNECTION CHECK
  useEffect(() => {
    if (!token) return;
    const isConfigured = !!(config.PHONE_NUMBER_ID && config.ACCESS_TOKEN);
    setIsConnected(isConfigured);
    if (!isConfigured) { setMetaSynced(false); return; }
  }, [config, token]);

  // JOB POLLING
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

  // INBOX POLLING
  useEffect(() => {
    if (!token) return;
    const fetchChats = () => {
      fetchWithAuth(`${API_BASE}/api/chats`).then(r => r.json()).then(d => { if (Array.isArray(d)) setChats(d); }).catch(() => {});
    };
    fetchChats();
    const interval = setInterval(fetchChats, 5000);
    return () => clearInterval(interval);
  }, [token, activeTab]);

  useEffect(() => {
    if (!token || activeTab !== 'inbox' || !activeChatPhone) return;
    const fetchHistory = () => {
      fetchWithAuth(`${API_BASE}/api/chats/${activeChatPhone}`).then(r => r.json()).then(d => { if (Array.isArray(d)) setActiveChatHistory(d); }).catch(() => {});
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 3000);
    return () => clearInterval(interval);
  }, [token, activeTab, activeChatPhone]);

  const unreadTotal = useMemo(() => chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0), [chats]);

  // --- NOTIFICATION SOUNDS & BROWSER POPUPS ---
  const lastUnreadTotal = useRef(0);
  const notificationSound = useMemo(() => new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3'), []);

  useEffect(() => {
    // Request permission on first load
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (unreadTotal > lastUnreadTotal.current) {
      // PLAY SOUND
      notificationSound.play().catch(() => {});

      // BROWSER POPUP
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        const latestChat = chats.find(c => (c.unreadCount || 0) > 0);
        new Notification("New WhatsApp Message", {
          body: latestChat ? `From: ${latestChat.name || latestChat.phone}` : "You have new messages",
          icon: "/vite.svg" 
        });
      }
    }
    lastUnreadTotal.current = unreadTotal;
  }, [unreadTotal, notificationSound, chats]);

  // UNREAD NOTIFICATIONS SYNC
  useEffect(() => {
    if (unreadTotal > 0) {
      document.title = `(${unreadTotal}) TIM Cloud`;
    } else {
      document.title = 'TIM Cloud';
    }
  }, [unreadTotal]);

  // AUTO-READ ACTIVE CHAT
  useEffect(() => {
    if (!token || !activeChatPhone) return;
    const activeChat = chats.find(c => c.phone === activeChatPhone);
    if (activeChat && activeChat.unreadCount > 0) {
      fetchWithAuth(`${API_BASE}/api/chats/${activeChatPhone}/read`, { method: 'POST' })
        .then(() => {
          setChats(prev => prev.map(c => c.phone === activeChatPhone ? { ...c, unreadCount: 0 } : c));
        })
        .catch(() => {});
    }
  }, [chats, activeChatPhone, token]);

  // ═══════════ STATS ═══════════
  const stats = useMemo(() => {
    let totalSent = 0, totalFailed = 0;
    const dailyCounts = [0, 0, 0, 0, 0, 0, 0];
    historyData.forEach(job => {
      const sent = job.results ? job.results.filter(r => r.status?.includes('Sent')).length : (job.sent || 0);
      const failed = job.results ? job.results.filter(r => r.status?.includes('Failed')).length : (job.failed || 0);
      totalSent += sent;
      totalFailed += failed;
      if (job.createdAt || job.timestamp) {
        const date = new Date(job.createdAt || job.timestamp);
        const day = (date.getDay() + 6) % 7;
        dailyCounts[day] += sent;
      }
    });
    const max = Math.max(...dailyCounts, 1);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const finalActivity = dailyCounts.map((count, i) => ({
      height: (count / max) * 100, day: days[i], count
    }));
    return { totalCampaigns: historyData.length, totalSent, totalFailed, weeklyActivity: finalActivity };
  }, [historyData]);

  const selectedTpl = useMemo(() => templates.find(t => t.name === selectedTemplate) || null, [selectedTemplate, templates]);
  const bodyVariables = useMemo(() => selectedTpl?.componentsData?.body?.variables || [], [selectedTpl]);
  const headerInfo = useMemo(() => selectedTpl?.componentsData?.header || null, [selectedTpl]);
  const footerVariables = useMemo(() => selectedTpl?.componentsData?.footer?.variables || [], [selectedTpl]);
  const buttons = useMemo(() => selectedTpl?.componentsData?.buttons || [], [selectedTpl]);

  const filteredResults = useMemo(() => {
    if (!jobStatus?.results) return [];
    if (!debouncedSearch) return jobStatus.results.slice().reverse();
    return jobStatus.results.slice().reverse().filter(r =>
      (r.name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
      (r.phone || '').includes(debouncedSearch)
    );
  }, [jobStatus?.results, debouncedSearch]);

  const filteredHistory = useMemo(() => {
    if (!historyData) return [];
    if (!debouncedHistorySearch) return historyData;
    return historyData.filter(job => 
      (job.name || job.templateName || '').toLowerCase().includes(debouncedHistorySearch.toLowerCase()) ||
      String(job.id || '').includes(debouncedHistorySearch)
    );
  }, [historyData, debouncedHistorySearch]);

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      
      // 1. Primary sort: last message timestamp (newest first)
      if (dateB !== dateA) return dateB - dateA;
      
      // 2. Secondary sort: unread count (unreads first)
      if ((b.unreadCount || 0) !== (a.unreadCount || 0)) return (b.unreadCount || 0) - (a.unreadCount || 0);
      
      // 3. Stable tertiary sort: phone number (alphabetical)
      return (a.phone || '').localeCompare(b.phone || '');
    });
  }, [chats]);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(searchTerm), 300); return () => clearTimeout(t); }, [searchTerm]);
  useEffect(() => { const t = setTimeout(() => setDebouncedHistorySearch(historySearchTerm), 300); return () => clearTimeout(t); }, [historySearchTerm]);

  // FETCH CAMPAIGN DETAILS
  const handleExpandHistory = async (job) => {
    try {
      if (job.results) { setExpandedHistoryJob(job); return; }
      const res = await fetchWithAuth(`${API_BASE}/api/history/${job.id}`);
      if (res.ok) {
        const fullJob = await res.json();
        setExpandedHistoryJob(fullJob);
      }
    } catch (e) {
      console.error('Failed to fetch job details');
    }
  };

  // --- AUTO MAPPING LOGIC ---
  useEffect(() => {
    if (csvHeaders.length === 0) return;
    
    setMapping(prev => {
      const newMapping = { ...prev };
      
      // Auto-map Core Fields
      if (!newMapping.phone) {
        const phoneCol = csvHeaders.find(h => ['phone', 'mobile', 'whatsapp', 'number', 'contact'].includes(h.toLowerCase()));
        if (phoneCol) newMapping.phone = phoneCol;
      }
      if (!newMapping.name) {
        const nameCol = csvHeaders.find(h => ['name', 'full name', 'first name', 'customer'].includes(h.toLowerCase()));
        if (nameCol) newMapping.name = nameCol;
      }

      // Auto-map Template Variables
      const allVars = [
        ...(selectedTpl?.componentsData?.header?.variables || []),
        ...(selectedTpl?.componentsData?.body?.variables || []),
        ...(selectedTpl?.componentsData?.footer?.variables || []),
        ...(selectedTpl?.componentsData?.buttons?.flatMap(b => b.variables) || [])
      ];

      allVars.forEach(v => {
        if (!newMapping[v] && !newMapping[`Variable: ${v}`] && !newMapping[`Body Var ${v}`]) {
          const match = csvHeaders.find(h => h.toLowerCase() === String(v).toLowerCase() || h.toLowerCase().includes(String(v).toLowerCase()));
          if (match) {
            newMapping[v] = match;
            newMapping[`Variable: ${v}`] = match;
            newMapping[`Body Var ${v}`] = match;
            newMapping[`Header Var ${v}`] = match;
            newMapping[`Footer Var ${v}`] = match;
          }
        }
      });

      return newMapping;
    });
  }, [csvHeaders, selectedTemplate, selectedTpl]);

  // ═══════════ CORE FUNCTIONS ═══════════
  const handleRegisterPhone = async () => {
    if (!registrationPin || registrationPin.length !== 6) { setStatus('Please enter a 6-digit PIN.'); return; }
    setIsRegistering(true); setStatus('Attempting Meta registration...');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: registrationPin }) });
      const data = await res.json();
      if (res.ok) { setStatus('Registration Successful! Refreshing templates...'); await handleRefreshTemplates(); }
      else { setStatus(`Registration Error: ${data.error || 'Failed'}`); }
    } catch (e) { setStatus('Register failed — check server logs.'); }
    finally { setIsRegistering(false); }
  };
  
  const handleSaveEmailSettings = async (e) => {
    e.preventDefault();
    setIsSavingEmail(true); setStatus('Updating email alerts...');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/settings/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailConfig)
      });
      if (res.ok) { setStatus('Email settings updated!'); }
      else { const d = await res.json(); setStatus(`Error: ${d.error}`); }
    } catch (e) { setStatus('Failed to save email settings.'); }
    finally { setIsSavingEmail(false); }
  };

  const handleTestEmail = async () => {
    setIsTestingEmail(true); setStatus('Sending test email...');
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/settings/email/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailConfig)
      });
      const d = await res.json();
      if (res.ok) { setStatus('Test email sent! Check your inbox.'); }
      else { setStatus(`Test failed: ${d.error}`); }
    } catch (e) { setStatus('Failed to send test email.'); }
    finally { setIsTestingEmail(false); }
  };

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setStatus('Uploading...');
    const formData = new FormData();
    formData.append('csv', selectedFile);
    try {
      const resp = await fetchWithAuth(`${API_BASE}/api/upload-csv`, { method: 'POST', body: formData });
      if (!resp.ok) throw new Error('Upload failed');
      const data = await resp.json();
      setFile(selectedFile); setCsvData(data.data); setCsvHeaders(data.headers);
      setStatus(`Loaded ${data.data.length} contacts`);
    } catch (err) { setStatus('Upload failed — check your CSV file'); setFile(null); setCsvData([]); setCsvHeaders([]); }
  };

  const handleMediaUpload = async (e) => {
    const mediaFile = e.target.files[0];
    if (!mediaFile) return;
    setIsUploadingMedia(true); setStatus('Uploading media to Meta...');
    const formData = new FormData();
    formData.append('media', mediaFile);
    // Local preview for UI
    const localUrl = URL.createObjectURL(mediaFile);
    setLocalMediaUrl(localUrl);
    
    try {
      const resp = await fetchWithAuth(`${API_BASE}/api/upload-media`, { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Upload failed');
      setUploadedMediaId(data.mediaId);
      setMapping(prev => ({ ...prev, header_media_url: data.mediaId }));
      setStatus('Media uploaded successfully!');
    } catch (err) { setStatus(`Media upload failed: ${err.message}`); setLocalMediaUrl(null); }
    finally { setIsUploadingMedia(false); }
  };

  const handleRefreshTemplates = async () => {
    setRefreshingTemplates(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/templates`);
      const data = await res.json();
      if (Array.isArray(data)) { setTemplates(data); setStatus(`Synced ${data.length} templates`); setMetaSynced(true); }
    } catch (err) { setStatus('Failed to refresh templates'); setMetaSynced(false); }
    finally { setTimeout(() => setRefreshingTemplates(false), 800); }
  };

  const handleSend = async () => {
    if (!file || csvData.length === 0) { setStatus('Please upload a CSV file first'); return; }
    if (!mapping.phone) { setStatus('Please select the phone number column'); return; }
    if (messageType === 'template' && !selectedTemplate) { setStatus('Please select a template'); return; }
    if (messageType === 'custom' && !customMessage.trim()) { setStatus('Please type a message'); return; }
    setIsLoading(prev => ({ ...prev, send: true })); setStatus('Starting...');
    try {
      const resp = await fetchWithAuth(`${API_BASE}/api/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: csvData, templateName: selectedTemplate, messageType: messageType === 'custom' ? 'text' : 'template', customMessage, mapping, allowDuplicates })
      });
      const data = await resp.json();
      if (data.error) { setStatus(`Error: ${data.error}`); }
      else { setJobId(data.jobId); setActiveTab('status'); setStatus('Sending started!'); }
    } catch (err) { setStatus('Could not start sending'); }
    finally { setIsLoading(prev => ({ ...prev, send: false })); }
  };

  const handleRestart = () => {
    setJobId(null); setJobStatus(null); setCsvData([]); setCsvHeaders([]);
    setFile(null); setFileKey(prev => prev + 1); setStatus(''); setMapping({});
    setMessageType('template'); setCustomMessage(''); setSelectedTemplate('');
    setSearchTerm(''); setActiveTab('send');
  };

  const handleExportCSV = () => {
    if (!jobStatus?.results?.length) return;
    const headers = "Name,Phone,Status\n";
    const csv = headers + jobStatus.results.map(r => `"${r.name}","${r.phone}","${(r.status || '').replace(/"/g, '""')}"`).join('\n');
    downloadBlob(csv, `campaign_results_${jobId}.csv`);
  };

  const handleExportHistoryCSV = (job) => {
    if (!job?.results?.length) return;
    const headers = "Name,Phone,Status\n";
    const csv = headers + job.results.map(r => `"${r.name}","${r.phone}","${(r.status || '').replace(/"/g, '""')}"`).join('\n');
    downloadBlob(csv, `campaign_history_${job.id}.csv`);
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!activeChatPhone || isSendingReply) return;
    if (!replyText.trim() && !pendingAttachment) return;
    
    setIsSendingReply(true);
    try {
      let mediaId = null;
      let type = 'text';
      let filename = null;
      let finalChatText = replyText;

      // Handle Attachment if staged
      if (pendingAttachment) {
        const formData = new FormData();
        formData.append('media', pendingAttachment.file);
        const upRes = await fetchWithAuth(`${API_BASE}/api/upload-media`, { method: 'POST', body: formData });
        const upData = await upRes.json();
        
        if (upData.mediaId) {
          mediaId = upData.mediaId;
          type = pendingAttachment.type;
          filename = pendingAttachment.file.name;
          // No fallback text, let it be empty if user didn't type a caption
        } else {
          throw new Error(upData.error || 'Media upload failed');
        }
      }

      const res = await fetchWithAuth(`${API_BASE}/api/reply`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          phone: activeChatPhone, 
          text: finalChatText,
          type,
          mediaId,
          filename
        }) 
      });

      if (res.ok) {
        setReplyText('');
        setPendingAttachment(null);
        const histRes = await fetchWithAuth(`${API_BASE}/api/chats/${activeChatPhone}`);
        const histData = await histRes.json();
        if (Array.isArray(histData)) setActiveChatHistory(histData);
      } else { 
        const err = await res.json(); 
        alert(`Reply failed: ${err.error || 'Unknown error'}`); 
      }
    } catch (err) { 
      alert(err.message || 'Network error while sending reply'); 
    }
    finally { setIsSendingReply(false); }
  };

  const handleSelectAttachment = (file, type) => {
    if (!file) return;
    const previewUrl = type === 'image' ? URL.createObjectURL(file) : null;
    setPendingAttachment({ file, type, previewUrl });
    setShowAttachmentMenu(false);
  };



  function downloadBlob(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.setAttribute('download', filename);
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  }

  const switchTab = (tab) => { setActiveTab(tab); setSidebarOpen(false); };
  const TAB_TITLES = { home: 'Home', send: 'Send Messages', status: 'Sending Status', inbox: 'Inbox', history: 'History', settings: 'Settings' };

  // ═══════════════════════════════════════════
  //  LOGIN PAGE
  // ═══════════════════════════════════════════
  if (!token) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md simple-card p-8 space-y-6">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center text-black font-bold text-xl mx-auto mb-4 shadow-lg shadow-emerald-500/20">T</div>
            <h1 className="text-2xl font-bold text-white">TIM Cloud</h1>
            <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Professional WhatsApp CRM</p>
          </div>
          <form onSubmit={handleAuth} className="space-y-4">
            <SimpleInput label="Username" value={authForm.username} onChange={v => setAuthForm({...authForm, username: v})} placeholder="Enter your username" />
            <SimpleInput label="Password" value={authForm.password} onChange={v => setAuthForm({...authForm, password: v})} placeholder="••••••••" isSensitive={true} />
            {authError && (
              <div className={`p-3 rounded-xl text-xs text-center font-bold ${authError.includes('created') ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border border-red-500/20 text-red-500'}`}>
                {authError}
              </div>
            )}
            <button type="submit" className="simple-btn btn-primary w-full h-12 flex items-center justify-center gap-2 font-bold">
              {authView === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <div className="text-center">
            <button onClick={() => { setAuthView(authView === 'login' ? 'signup' : 'login'); setAuthError(''); }} className="text-slate-500 hover:text-white text-xs transition-colors font-bold">
              {authView === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  //  MAIN DASHBOARD
  // ═══════════════════════════════════════════
  return (
    <div className="min-h-screen flex bg-bg-base text-slate-300">
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside className={cn(
        "w-64 border-r border-border-dim flex flex-col pt-8 pb-6 px-4 shrink-0 bg-bg-base z-50 transition-transform duration-300",
        "fixed inset-y-0 left-0 lg:relative lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="px-4 mb-8 flex items-center justify-between">
           <div className="flex items-center gap-2">
             <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-black font-bold text-sm">T</div>
             <h1 className="text-lg font-bold">TIM Cloud</h1>
           </div>
           <button className="lg:hidden p-1 text-slate-500 hover:text-white" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>

        <nav className="flex-1 space-y-1">
          <SidebarLink active={activeTab === 'home'} onClick={() => switchTab('home')} icon={House} label="Home" />
          <SidebarLink active={activeTab === 'send'} onClick={() => switchTab('send')} icon={PaperPlaneTilt} label="Send" />
          <SidebarLink active={activeTab === 'status'} onClick={() => switchTab('status')} icon={ChartLine} label="Status" badge={jobStatus?.status === 'Running' ? '●' : null} />
          <SidebarLink active={activeTab === 'inbox'} onClick={() => switchTab('inbox')} icon={ChatCircleDots} label="Inbox" badge={unreadTotal > 0 ? unreadTotal : null} />
          <SidebarLink active={activeTab === 'history'} onClick={() => switchTab('history')} icon={Clock} label="History" badge={historyData.length > 0 ? historyData.length : null} />
          <div className="pt-4 border-t border-border-dim mt-4 opacity-50" />
          <SidebarLink active={activeTab === 'settings'} onClick={() => switchTab('settings')} icon={Gear} label="Settings" />
        </nav>

        <div className="mt-auto px-2 space-y-3">
           <div className="p-3 rounded-xl bg-bg-surface border border-border-dim flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 font-bold border border-emerald-500/20 text-xs">
                {user?.username?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                 <p className="text-xs font-bold text-white truncate">{user?.username}</p>
                 <p className="text-[10px] text-slate-500">SaaS Account</p>
              </div>
           </div>
           <button onClick={logout} className="w-full sidebar-item text-slate-500 hover:text-red-500 hover:bg-red-500/5 group">
             <SignOut size={18} weight="bold" className="text-slate-600 group-hover:text-red-500" />
             <span className="font-bold flex-1 text-left">Sign Out</span>
           </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden w-full min-w-0">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] emerald-radial pointer-events-none -z-10" />

        <header className="h-16 lg:h-20 flex items-center justify-between px-4 lg:px-10 border-b border-border-dim shrink-0 bg-bg-base/50 backdrop-blur-md sticky top-0 z-30">
           <div className="flex items-center gap-4">
             <button className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-white bg-white/5 rounded-lg border border-border-dim transition-all" onClick={() => setSidebarOpen(true)}><List size={20} weight="bold" /></button>
             <h2 className="text-lg lg:text-xl font-bold tracking-tight">{TAB_TITLES[activeTab]}</h2>
           </div>
           <div className="flex items-center gap-3 lg:gap-6">
               <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 font-black text-[9px] border border-emerald-500/20">
                     {user?.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <span className="text-[11px] font-bold text-slate-300 tracking-tight">{user?.username}</span>
               </div>
              <div className="flex flex-col items-end gap-1">
                 <div className={cn("px-3 py-1 rounded-full text-[9px] lg:text-[10px] font-bold uppercase tracking-widest flex items-center gap-2", isConnected ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-red-500/10 text-red-500 border border-red-500/20")}>
                    <div className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                    <span className="hidden xs:inline">{isConnected ? "Connected" : "Disconnected"}</span>
                 </div>
                 {isConnected && (
                    <span className={cn("text-[7px] font-bold uppercase tracking-[0.2em] px-1", metaSynced ? "text-emerald-500/40" : "text-amber-500/40")}>
                       {metaSynced ? "Meta API Synced" : "Meta Sync Failed"}
                    </span>
                 )}
              </div>
           </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-10">
           <AnimatePresence mode="wait">

              {/* ═══ HOME TAB ═══ */}
              {activeTab === 'home' && (
                <motion.div key="home" {...PAGE_TRANSITION} className="space-y-8 lg:space-y-10 max-w-6xl">
                   <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
                      <MetricCard label="Messages Sent" value={stats.totalSent} icon={PaperPlaneTilt} />
                      <MetricCard label="Success Rate" value={`${stats.totalSent > 0 ? (stats.totalSent / (stats.totalSent + stats.totalFailed) * 100).toFixed(1) : 0}%`} icon={CheckCircle} color="text-emerald-500" />
                      <MetricCard label="Campaigns" value={stats.totalCampaigns} icon={Database} />
                   </div>
                   <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
                      <div className="flex-1 space-y-4">
                         <h3 className="text-xs lg:text-sm font-bold text-slate-500 uppercase tracking-widest">Weekly Activity</h3>
                         <div className="simple-card h-48 lg:h-64 flex items-end justify-between gap-1.5 lg:gap-3 px-4 lg:px-6 pt-10 pb-2">
                             {stats.weeklyActivity.map((dayData, i) => (
                                <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                                   <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(dayData.height, 5)}%` }} className="w-full bg-emerald-500/20 rounded-t-sm lg:rounded-t-md relative group min-h-[4px]">
                                      <div className="absolute inset-x-0 bottom-0 bg-emerald-500 rounded-t-sm lg:rounded-t-md opacity-20 group-hover:opacity-60 transition-opacity" style={{ height: '100%' }} />
                                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[8px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 border border-emerald-500/20">
                                         {dayData.count} sent
                                      </div>
                                   </motion.div>
                                   <span className="text-[8px] font-bold text-slate-600 uppercase tracking-tighter">{dayData.day}</span>
                                </div>
                             ))}
                          </div>
                      </div>
                      <div className="w-full lg:w-96 space-y-4">
                         <h3 className="text-xs lg:text-sm font-bold text-slate-500 uppercase tracking-widest">Recent Activity</h3>
                         <div className="space-y-2 lg:space-y-3">
                            {historyData.slice(0, 4).map(job => (
                               <div key={job.id || job._id} className="p-3 lg:p-4 rounded-xl bg-bg-surface border border-border-dim flex items-center justify-between group hover:border-emerald-500/10 transition-all">
                                  <div className="flex items-center gap-3 min-w-0">
                                     <div className={cn("w-2 h-2 rounded-full shrink-0", job.status === 'Completed' ? "bg-emerald-500" : "bg-amber-500")} />
                                     <div className="min-w-0">
                                        <p className="text-xs font-bold text-white truncate">{job.name || job.templateName || 'Campaign'}</p>
                                        <p className="text-[10px] text-slate-500">{job.totalContacts || job.total || 0} contacts</p>
                                     </div>
                                  </div>
                                  <ArrowRight className="text-slate-700 group-hover:text-emerald-500 transition-colors shrink-0" size={16} />
                               </div>
                            ))}
                            {historyData.length === 0 && <p className="text-center py-10 text-[10px] font-bold text-slate-700 uppercase tracking-widest">No history yet</p>}
                         </div>
                      </div>
                   </div>
                </motion.div>
              )}

              {/* ═══ SEND TAB ═══ */}
              {activeTab === 'send' && (
                <motion.div key="send" {...PAGE_TRANSITION} className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-8 pb-20">
                   {/* LEFT COLUMN: CONFIGURATION */}
                   <div className="flex-1 space-y-6 lg:space-y-8 min-w-0">
                      
                      {/* 1. UPLOAD CONTACTS */}
                      <div className="simple-card space-y-6">
                         <div className="flex items-center gap-3 lg:gap-4 border-b border-border-dim pb-4 lg:pb-6">
                            <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500"><UploadSimple size={18} weight="bold" /></div>
                            <div><h3 className="text-base lg:text-lg font-bold">1. Upload Contacts</h3><p className="text-[10px] lg:text-xs text-slate-500">Pick a CSV file with your phone numbers.</p></div>
                         </div>
                         <label className="block group cursor-pointer">
                            <div className={cn("h-32 lg:h-40 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all", file ? "border-emerald-500/30 bg-emerald-500/5" : "border-border-dim bg-white/[0.01] hover:border-emerald-500/20")}>
                               {file ? (
                                  <div className="text-center px-4">
                                     <CheckCircle size={28} className="text-emerald-500 mx-auto mb-2" weight="fill" />
                                     <p className="text-sm font-bold text-white truncate max-w-[250px]">{file.name}</p>
                                     <p className="text-[10px] text-emerald-500 font-bold uppercase mt-1">{csvData.length} Contacts Found</p>
                                  </div>
                               ) : (
                                  <div className="text-center"><Plus size={22} className="text-slate-600 mb-2 mx-auto" weight="bold" /><p className="text-[10px] lg:text-xs font-bold text-slate-500 uppercase tracking-widest">Click to Upload CSV</p></div>
                               )}
                            </div>
                            <input key={fileKey} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                         </label>
                         {csvHeaders.length > 0 && (
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border-dim">
                              <FieldSelect label="Phone Number Column *" value={mapping.phone || ''} onChange={v => setMapping({...mapping, phone: v})} options={csvHeaders} />
                              <FieldSelect label="Name Column (Optional)" value={mapping.name || ''} onChange={v => setMapping({...mapping, name: v})} options={csvHeaders} />
                           </div>
                         )}
                      </div>

                      {/* 2. CHOOSE MESSAGE */}
                      <div className="simple-card space-y-6">
                         <div className="flex items-center gap-3 lg:gap-4 border-b border-border-dim pb-4 lg:pb-6">
                            <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500"><PaperPlaneTilt size={18} weight="bold" /></div>
                            <div className="flex-1"><h3 className="text-base lg:text-lg font-bold">2. Choose Message</h3><p className="text-[10px] lg:text-xs text-slate-500">Pick a template or write a custom message.</p></div>
                         </div>
                         <div className="space-y-6">
                             <div className="flex gap-2 p-1 bg-white/[0.02] border border-border-dim rounded-xl w-fit">
                                <button onClick={() => setMessageType('template')} className={cn("px-6 lg:px-8 py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all", messageType === 'template' ? "bg-emerald-500 text-black shadow-lg" : "text-slate-500 hover:text-slate-300")}>Template</button>
                                <button onClick={() => setMessageType('custom')} className={cn("px-6 lg:px-8 py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all", messageType === 'custom' ? "bg-emerald-500 text-black shadow-lg" : "text-slate-500 hover:text-slate-300")}>Custom</button>
                             </div>
                             
                             {messageType === 'template' ? (
                                <div className="space-y-5">
                                   <div className="flex gap-3 items-end">
                                      <div className="flex-1 space-y-2">
                                         <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Template Name</label>
                                         <div className="relative">
                                            <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="w-full bg-bg-surface border border-border-dim rounded-xl p-3.5 lg:p-4 text-xs lg:text-sm font-bold text-white outline-none appearance-none focus:border-emerald-500/30 transition-all">
                                               <option value="">-- Choose Template --</option>
                                               {templates.map(t => <option key={t.name} value={t.name}>{t.name} ({t.language})</option>)}
                                            </select>
                                            <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={14} />
                                         </div>
                                      </div>
                                      <button onClick={handleRefreshTemplates} disabled={refreshingTemplates} className={cn("simple-btn bg-white/5 border border-border-dim text-slate-400 hover:text-emerald-500 hover:border-emerald-500/20 h-[46px] lg:h-[52px] px-3.5 mb-[1px]", refreshingTemplates && "animate-pulse")} title="Refresh templates">
                                         <ArrowsClockwise size={20} className={refreshingTemplates ? "animate-spin" : ""} />
                                      </button>
                                   </div>

                                   {/* ════════ HEADER SECTION ════════ */}
                                   {headerInfo?.type && (
                                     <div className="p-4 rounded-2xl bg-white/[0.01] border border-border-dim space-y-4">
                                       <div className="flex items-center gap-2 mb-1">
                                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Message Header ({headerInfo.type})</p>
                                       </div>

                                       {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerInfo.type) ? (
                                         <div className="space-y-4">
                                            <div className="flex items-center gap-3">
                                               <label className={cn("flex-1 flex items-center justify-center gap-2 p-3.5 rounded-xl border border-dashed transition-all cursor-pointer", uploadedMediaId ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500" : "border-border-dim bg-white/[0.02] hover:border-emerald-500/20 text-slate-500")}>
                                                  {isUploadingMedia ? <ArrowsClockwise size={16} className="animate-spin" /> : uploadedMediaId ? <CheckCircle size={16} weight="fill" /> : <Plus size={16} />}
                                                  <span className="text-[10px] font-bold uppercase tracking-wider">{isUploadingMedia ? 'Uploading...' : uploadedMediaId ? 'File Ready ✓' : `Upload ${headerInfo.type}`}</span>
                                                  <input type="file" className="hidden" accept={headerInfo.type === 'IMAGE' ? "image/*" : headerInfo.type === 'VIDEO' ? "video/*" : ".pdf,.doc,.docx"} onChange={handleMediaUpload} disabled={isUploadingMedia} />
                                               </label>
                                               {uploadedMediaId && (
                                                 <button onClick={() => { setUploadedMediaId(null); setLocalMediaUrl(null); setMapping(prev => { const n = {...prev}; delete n.header_media_url; return n; }); }} className="p-3 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-all"><X size={16} /></button>
                                               )}
                                            </div>
                                         </div>
                                       ) : headerInfo.type === 'TEXT' && headerInfo.variables?.length > 0 && (
                                          <div className="grid grid-cols-1 gap-4">
                                            {headerInfo.variables.map((v, i) => (
                                               <FieldSelect 
                                                 key={`h-${i}`} 
                                                 label={`Header: ${v}`} 
                                                 value={mapping[v] || mapping[`Header Var ${v}`] || ''} 
                                                 onChange={val => setMapping({...mapping, [v]: val, [`Header Var ${v}`]: val})} 
                                                 options={csvHeaders} 
                                               />
                                            ))}
                                          </div>
                                       )}
                                     </div>
                                   )}

                                   {/* ════════ BODY SECTION ════════ */}
                                   {(bodyVariables.length > 0 || footerVariables.length > 0 || buttons.some(b => b.variables?.length > 0)) && (
                                      <div className="p-4 rounded-2xl bg-white/[0.01] border border-border-dim space-y-4">
                                         <div className="flex items-center gap-2 mb-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Message Body & Variables</p>
                                         </div>
                                         
                                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {/* Body Vars */}
                                            {bodyVariables.map((v, i) => (
                                               <FieldSelect 
                                                 key={`b-${i}`} 
                                                 label={`Body: ${v}`} 
                                                 value={mapping[v] || mapping[`Body Var ${v}`] || ''} 
                                                 onChange={val => setMapping({...mapping, [v]: val, [`Body Var ${v}`]: val})} 
                                                 options={csvHeaders} 
                                               />
                                            ))}
                                            {/* Footer Vars */}
                                            {footerVariables.map((v, i) => (
                                               <FieldSelect 
                                                 key={`f-${i}`} 
                                                 label={`Footer: ${v}`} 
                                                 value={mapping[v] || mapping[`Footer Var ${v}`] || ''} 
                                                 onChange={val => setMapping({...mapping, [v]: val, [`Footer Var ${v}`]: val})} 
                                                 options={csvHeaders} 
                                               />
                                            ))}
                                         </div>
                                         {/* Button Vars */}
                                         {buttons.map((btn, bIdx) => btn.variables?.length > 0 && (
                                            <div key={`btn-${bIdx}`} className="p-3 rounded-xl bg-white/[0.01] border border-emerald-500/5 space-y-3">
                                               <p className="text-[9px] font-bold text-emerald-500/60 uppercase tracking-tighter">Button Parameter: {btn.text}</p>
                                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                  {btn.variables.map((v, vIdx) => (
                                                     <FieldSelect 
                                                        key={vIdx} 
                                                        label={`Button ${btn.text}: ${v}`} 
                                                        value={mapping[`btn_${bIdx}_${v}`] || mapping[`Btn ${bIdx} Var ${v}`] || ''} 
                                                        onChange={val => setMapping({...mapping, [`btn_${bIdx}_${v}`]: val, [`Btn ${bIdx} Var ${v}`]: val})} 
                                                        options={csvHeaders} 
                                                     />
                                                  ))}
                                               </div>
                                            </div>
                                         ))}
                                      </div>
                                   )}
                                </div>
                             ) : (
                                <div className="space-y-2">
                                   <textarea value={customMessage} onChange={e => setCustomMessage(e.target.value)} placeholder="Type your message here... Use {{ColumnName}} to insert data from your CSV." className="w-full h-32 lg:h-40 bg-bg-surface border border-border-dim rounded-xl p-4 lg:p-5 text-sm font-medium text-white outline-none focus:border-emerald-500/30 resize-none" />
                                   <p className="text-[10px] text-slate-600 ml-1">Tip: Use {"{{Name}}"} or {"{{Phone}}"} to insert CSV column values.</p>
                                </div>
                             )}
                         </div>

                         {status && (<div className="p-3 rounded-xl bg-white/[0.02] border border-border-dim flex items-center gap-2 text-xs text-slate-400"><WarningCircle size={14} className="text-emerald-500 shrink-0" />{status}</div>)}
                         
                         <div className="pt-4 lg:pt-6 border-t border-border-dim flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setAllowDuplicates(!allowDuplicates)}>
                               <div className={cn("w-5 h-5 rounded-md border flex items-center justify-center transition-all", allowDuplicates ? "bg-emerald-500 border-emerald-500" : "border-border-dim bg-white/5")}>
                                  {allowDuplicates && <CheckCircle size={14} className="text-black" weight="bold" />}
                               </div>
                               <span className="text-xs font-medium text-slate-500">Allow duplicate numbers</span>
                            </div>
                            <button onClick={handleSend} disabled={isLoading.send || !isConnected || !file || csvData.length === 0} className="simple-btn btn-primary px-8 lg:px-10 h-11 lg:h-12 flex items-center gap-2 w-full sm:w-auto justify-center">
                               {isLoading.send ? 'Starting...' : <><PaperPlaneTilt weight="bold" /> Start Sending</>}
                            </button>
                         </div>
                      </div>
                   </div>

                   {/* RIGHT COLUMN: PREVIEW (STICKY) */}
                    <div className="w-full lg:w-[350px] shrink-0 flex flex-col items-center lg:items-stretch">
                       <div className="relative lg:sticky lg:top-24 space-y-4 w-full max-w-[350px]">
                         <div className="flex items-center justify-between px-2">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Live Preview</h3>
                            <div className="flex items-center gap-2">
                               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                               <span className="text-[10px] font-bold text-emerald-500/60 uppercase">High Fidelity</span>
                            </div>
                         </div>
                         <TemplatePreview 
                           template={selectedTpl} 
                           mapping={mapping} 
                           csvHeaders={csvHeaders} 
                           uploadedMediaId={uploadedMediaId}
                           localMediaUrl={localMediaUrl}
                         />
                         {selectedTpl && (
                           <div className="p-4 rounded-2xl bg-white/[0.01] border border-border-dim">
                              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2 text-center">Template Details</p>
                              <div className="grid grid-cols-2 gap-2 text-[9px] font-bold">
                                 <div className="bg-bg-surface p-2 rounded-lg border border-border-dim text-center">
                                    <p className="text-slate-600 mb-0.5">CATEGORY</p>
                                    <p className="text-white truncate">{selectedTpl.category || 'MARKETING'}</p>
                                 </div>
                                 <div className="bg-bg-surface p-2 rounded-lg border border-border-dim text-center">
                                    <p className="text-slate-600 mb-0.5">LANGUAGE</p>
                                    <p className="text-white">{selectedTpl.language || 'en'}</p>
                                 </div>
                              </div>
                           </div>
                         )}
                      </div>
                   </div>
                </motion.div>
              )}

              {/* ═══ STATUS TAB ═══ */}
              {activeTab === 'status' && (
                <motion.div key="status" {...PAGE_TRANSITION} className="max-w-4xl mx-auto space-y-6 lg:space-y-8">
                   {jobStatus ? (
                     <>
                       <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                          <MiniStat label="Processed" value={`${jobStatus.processed || 0}/${jobStatus.total || 0}`} />
                          <MiniStat label="Sent" value={jobStatus.results?.filter(r => r.status?.includes('Sent') || r.status?.includes('Delivered') || r.status?.includes('Read')).length || 0} color="text-emerald-500" />
                          <MiniStat label="Failed" value={jobStatus.results?.filter(r => r.status?.includes('Failed')).length || 0} color="text-red-500" />
                          <MiniStat label="Remaining" value={(jobStatus.total || 0) - (jobStatus.processed || 0)} />
                       </div>
                       <div className="simple-card space-y-6">
                          <div className="flex items-center justify-between flex-wrap gap-3">
                             <div className="flex items-center gap-3">
                                {jobStatus.status === 'Running' && <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />}
                                {jobStatus.status === 'Paused' && <div className="w-3 h-3 rounded-full bg-amber-500" />}
                                {(jobStatus.status === 'Completed' || jobStatus.status === 'Stopped') && <div className="w-3 h-3 rounded-full bg-slate-500" />}
                                <h3 className="text-sm font-bold text-white">{jobStatus.status === 'Running' ? 'Sending...' : jobStatus.status}</h3>
                             </div>
                             <div className="flex gap-2">
                               {(jobStatus.status === 'Running' || jobStatus.status === 'Paused') && (
                                 <>
                                    <button onClick={() => fetchWithAuth(`${API_BASE}/api/${jobStatus.status === 'Running' ? 'pause' : 'resume'}/${jobId}`, { method: 'POST' })} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 transition-colors" title={jobStatus.status === 'Running' ? 'Pause' : 'Resume'}>
                                       {jobStatus.status === 'Running' ? <Pause size={18} /> : <Play size={18} />}
                                    </button>
                                    <button onClick={() => fetchWithAuth(`${API_BASE}/api/stop/${jobId}`, { method: 'POST' })} className="p-2 hover:bg-red-500/10 rounded-lg text-slate-400 hover:text-red-500 transition-colors" title="Stop">
                                       <Square size={18} />
                                    </button>
                                 </>
                               )}
                               {(jobStatus.status === 'Completed' || jobStatus.status === 'Stopped') && (
                                 <>
                                    <button onClick={handleExportCSV} className="simple-btn bg-white/5 border border-border-dim text-slate-300 hover:text-emerald-500 hover:border-emerald-500/20 flex items-center gap-2 text-xs"><DownloadSimple size={16} /> Download CSV</button>
                                    <button onClick={handleRestart} className="simple-btn bg-white/5 border border-border-dim text-slate-300 hover:text-emerald-500 hover:border-emerald-500/20 flex items-center gap-2 text-xs"><ArrowCounterClockwise size={16} /> New Campaign</button>
                                 </>
                               )}
                             </div>
                          </div>
                          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                             <motion.div initial={{ width: 0 }} animate={{ width: `${(jobStatus.processed / jobStatus.total * 100) || 0}%` }} className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                          </div>
                          {jobStatus.results?.length > 0 && (
                            <div className="relative">
                              <MagnifyingGlass size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" />
                              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search by name or phone..." className="w-full bg-white/[0.02] border border-border-dim rounded-xl pl-10 pr-4 py-3 text-xs font-medium text-white outline-none focus:border-emerald-500/20 placeholder:text-slate-700" />
                            </div>
                          )}
                          <div className="max-h-72 lg:max-h-80 overflow-y-auto space-y-1.5 pr-1">
                             {filteredResults.map((res, i) => (
                                 <div key={i} onClick={() => setSelectedResult(res)} className="flex items-center justify-between p-2.5 lg:p-3 rounded-xl bg-white/[0.01] border border-border-dim text-[10px] lg:text-[11px] font-medium cursor-pointer hover:bg-white/[0.03] transition-colors group">
                                    <div className="flex items-center gap-2 lg:gap-3 min-w-0">
                                       <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", res.status?.includes('Sent') || res.status?.includes('Delivered') || res.status?.includes('Read') ? "bg-emerald-500" : res.status?.includes('Skip') ? "bg-amber-500" : "bg-red-500")} />
                                       <span className="text-white font-bold shrink-0">{res.phone}</span>
                                       <span className="text-slate-600 truncate">{res.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                       <span className={cn("truncate max-w-[140px] lg:max-w-[200px] text-right shrink-0 ml-2", res.status?.includes('Sent') || res.status?.includes('Delivered') || res.status?.includes('Read') ? "text-emerald-500" : res.status?.includes('Skip') ? "text-amber-500" : "text-red-500")}>{res.status}</span>
                                       <Eye size={14} className="text-slate-700 group-hover:text-emerald-500 transition-colors" />
                                    </div>
                                 </div>
                             ))}
                             {filteredResults.length === 0 && searchTerm && <p className="text-center py-6 text-[10px] text-slate-600">No matches for "{searchTerm}"</p>}
                          </div>
                       </div>
                     </>
                   ) : (
                     <div className="text-center py-40">
                        <ChartLine size={48} className="mx-auto text-slate-800 mb-4" />
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-widest">No active sending</p>
                        <p className="text-[10px] text-slate-600 mt-2">Go to "Send" to start a new campaign.</p>
                     </div>
                   )}
                </motion.div>
              )}

              {/* ═══ HISTORY TAB ═══ */}
              {activeTab === 'history' && (
                <motion.div key="history" {...PAGE_TRANSITION} className="space-y-6 max-w-6xl pb-20">
                   <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-1">
                      <div className="flex items-center gap-3">
                        {expandedHistoryJob && (
                          <button onClick={() => setExpandedHistoryJob(null)} className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all border border-border-dim hover:border-emerald-500/20 group">
                            <ArrowLeft size={16} weight="bold" className="group-hover:-translate-x-0.5 transition-transform" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Back to Campaigns</span>
                          </button>
                        )}
                        {!expandedHistoryJob && <h3 className="text-lg lg:text-xl font-bold">Past Campaigns</h3>}
                      </div>
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        {!expandedHistoryJob && (
                          <div className="relative flex-1 sm:w-64">
                             <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                             <input value={historySearchTerm} onChange={e => setHistorySearchTerm(e.target.value)} placeholder="Search history..." className="w-full bg-white/[0.02] border border-border-dim rounded-lg pl-9 pr-3 py-2 text-[10px] font-bold text-white outline-none focus:border-emerald-500/20" />
                          </div>
                        )}
                        {historyData.length > 0 && !expandedHistoryJob && (
                          <button onClick={() => { if(confirm('Wipe all history?')) fetchWithAuth(`${API_BASE}/api/history/clear`, { method: 'POST' }).then(() => setHistoryData([])) }} className="text-[10px] font-bold text-red-500/50 hover:text-red-500 uppercase tracking-widest whitespace-nowrap">Clear All</button>
                        )}
                      </div>
                   </div>

                   {expandedHistoryJob ? (
                     <div className="space-y-6">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                           <MiniStat label="Total Contacts" value={expandedHistoryJob.totalContacts || expandedHistoryJob.total || 0} />
                           <MiniStat label="Sent Success" value={expandedHistoryJob.sent || expandedHistoryJob.results?.filter(r => r.status?.includes('Sent')).length || 0} color="text-emerald-500" />
                           <MiniStat label="Failed" value={expandedHistoryJob.failed || expandedHistoryJob.results?.filter(r => r.status?.includes('Failed')).length || 0} color="text-red-500" />
                           <MiniStat label="Status" value={expandedHistoryJob.status || 'Completed'} />
                        </div>
                        <div className="simple-card">
                          <div className="flex justify-between items-center mb-6">
                             <div>
                                <h4 className="text-xs font-bold text-white uppercase tracking-widest">{expandedHistoryJob.name || expandedHistoryJob.templateName || 'Campaign'}</h4>
                                <p className="text-[10px] text-slate-500 mt-1">{new Date(expandedHistoryJob.timestamp || expandedHistoryJob.createdAt).toLocaleString()}</p>
                             </div>
                             {expandedHistoryJob.results && <button onClick={() => handleExportHistoryCSV(expandedHistoryJob)} className="simple-btn bg-white/5 border border-border-dim text-slate-300 hover:text-emerald-500 flex items-center gap-2 text-[10px] px-4"><DownloadSimple size={14} /> Export CSV</button>}
                          </div>
                          {expandedHistoryJob.results ? (
                            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                               {expandedHistoryJob.results.map((res, i) => (
                                 <div key={i} onClick={() => setSelectedResult(res)} className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.01] border border-border-dim text-[10px] cursor-pointer hover:bg-white/[0.03] group">
                                    <div className="flex items-center gap-3 min-w-0">
                                       <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", res.status?.includes('Sent') ? "bg-emerald-500" : res.status?.includes('Skip') ? "bg-amber-500" : "bg-red-500")} />
                                       <span className="text-white font-bold">{res.phone}</span>
                                       <span className="text-slate-600 truncate">{res.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                       <span className={cn(res.status?.includes('Sent') ? "text-emerald-500" : "text-slate-500")}>{res.status}</span>
                                       <Eye size={14} className="text-slate-700 group-hover:text-emerald-500" />
                                    </div>
                                 </div>
                               ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 text-center py-10">Detailed results not available for this campaign.</p>
                          )}
                        </div>
                     </div>
                   ) : (
                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
                        {filteredHistory.map(job => {
                           const sent = job.sent || job.results?.filter(r => r.status?.includes('Sent')).length || 0;
                           const failed = job.failed || job.results?.filter(r => r.status?.includes('Failed')).length || 0;
                           const total = job.totalContacts || job.total || 0;
                           const rate = total > 0 ? (sent / total * 100).toFixed(0) : 0;
                           return (
                             <div key={job.id || job._id} onClick={() => handleExpandHistory(job)} className="simple-card group cursor-pointer hover:border-emerald-500/20 transition-all">
                                <div className="flex justify-between items-start mb-4">
                                   <div className="p-2.5 bg-white/5 rounded-xl text-slate-500 group-hover:text-emerald-500 transition-colors"><Database size={18} /></div>
                                   <div className="text-right">
                                      <span className="text-[10px] font-bold text-slate-600">#{String(job.id || job._id || '').slice(-6)}</span>
                                      <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">{job.status || 'Completed'}</p>
                                   </div>
                                </div>
                                <h4 className="text-xs lg:text-sm font-bold text-white mb-1 truncate">{job.name || job.templateName || 'Campaign'}</h4>
                                <p className="text-[10px] text-slate-500 mb-6">{new Date(job.timestamp || job.createdAt || Date.now()).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'})}</p>
                                <div className="grid grid-cols-3 gap-2 mb-6">
                                   <div className="text-center p-2 rounded-lg bg-white/[0.02] border border-border-dim"><p className="text-[8px] text-slate-600 font-bold uppercase mb-1">Sent</p><p className="text-xs font-bold text-emerald-500">{sent}</p></div>
                                   <div className="text-center p-2 rounded-lg bg-white/[0.02] border border-border-dim"><p className="text-[8px] text-slate-600 font-bold uppercase mb-1">Fail</p><p className="text-xs font-bold text-red-500">{failed}</p></div>
                                   <div className="text-center p-2 rounded-lg bg-white/[0.02] border border-border-dim"><p className="text-[8px] text-slate-600 font-bold uppercase mb-1">Total</p><p className="text-xs font-bold text-white">{total}</p></div>
                                </div>
                                <div className="pt-4 border-t border-border-dim flex justify-between items-center">
                                   <div className="flex items-center gap-2"><div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${rate}%` }} /></div><span className="text-[10px] font-bold text-emerald-500">{rate}%</span></div>
                                   <button onClick={(e) => { e.stopPropagation(); handleExportHistoryCSV(job); }} className="p-2 hover:bg-emerald-500/10 rounded-lg text-slate-500 hover:text-emerald-500 transition-all"><DownloadSimple size={16} /></button>
                                </div>
                             </div>
                           );
                        })}
                        {filteredHistory.length === 0 && (<div className="col-span-full text-center py-40"><Clock size={40} className="mx-auto text-slate-800 mb-4" /><p className="text-xs font-bold text-slate-700 uppercase tracking-widest">No matching history</p></div>)}
                     </div>
                   )}
                </motion.div>
              )}

              {/* ═══ INBOX TAB ═══ */}
              {activeTab === 'inbox' && (
                <motion.div key="inbox" {...PAGE_TRANSITION} className="h-[calc(100vh-12rem)] flex gap-4 lg:gap-6 relative">
                   <div className={cn(
                      "w-full lg:w-80 flex flex-col gap-4 shrink-0 transition-all duration-300",
                      activeChatPhone ? "hidden lg:flex" : "flex"
                   )}>
                      <div className="relative">
                         <MagnifyingGlass size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" />
                         <input placeholder="Search conversations..." className="w-full bg-white/[0.02] border border-border-dim rounded-xl pl-10 pr-4 py-3 text-xs font-medium text-white outline-none focus:border-emerald-500/20 placeholder:text-slate-700" />
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                         {sortedChats.length > 0 ? sortedChats.map(chat => (
                            <button key={chat.phone} onClick={async () => { 
                               setActiveChatPhone(chat.phone); 
                               setActiveChatHistory([]);
                               // Mark as read
                               try { fetchWithAuth(`${API_BASE}/api/chats/${chat.phone}/read`, { method: 'POST' }); } catch(e){}
                               // Update local state for badge
                               setChats(prev => prev.map(c => c.phone === chat.phone ? { ...c, unreadCount: 0 } : c));
                            }}
                              className={cn("w-full text-left p-4 rounded-2xl border transition-all group relative", activeChatPhone === chat.phone ? "bg-emerald-500/10 border-emerald-500/30 shadow-lg shadow-emerald-500/5" : "bg-white/[0.01] border-border-dim hover:bg-white/[0.03] hover:border-emerald-500/10")}>
                               <div className="flex justify-between items-start mb-1">
                                  <div className="flex items-center gap-2 min-w-0">
                                     <span className={cn("text-xs font-bold transition-colors truncate", activeChatPhone === chat.phone ? "text-emerald-500" : "text-white")}>{chat.name || chat.phone}</span>
                                     {chat.unreadCount > 0 && (
                                        <span className="bg-emerald-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-lg shadow-emerald-500/20">{chat.unreadCount}</span>
                                     )}
                                  </div>
                                  {chat.updatedAt && <span className="text-[9px] font-bold text-slate-600 shrink-0">{new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                               </div>
                               <p className="text-[10px] text-slate-500 truncate pr-4">
                                 {chat.messages?.[chat.messages.length - 1]?.from === 'me' ? '✓ ' : ''}
                                 {chat.messages?.[chat.messages.length - 1]?.text || 'No messages'}
                               </p>
                               {activeChatPhone === chat.phone && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-1 h-8 bg-emerald-500 rounded-full" />}
                            </button>
                         )) : (
                            <div className="py-20 text-center space-y-3 opacity-30"><ChatCircleDots size={32} className="mx-auto" /><p className="text-[10px] font-bold uppercase tracking-widest">No messages yet</p></div>
                         )}
                      </div>
                   </div>

                   <div className={cn(
                      "flex-1 flex flex-col bg-bg-surface/50 border border-border-dim rounded-[2rem] overflow-hidden relative min-w-0 transition-all duration-300",
                      !activeChatPhone ? "hidden lg:flex" : "flex"
                   )}>
                      {activeChatPhone ? (
                         <>
                            <div className="p-4 lg:p-6 border-b border-border-dim flex items-center justify-between bg-white/[0.01]">
                               <div className="flex items-center gap-3">
                                  <button onClick={() => setActiveChatPhone(null)} className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-white"><ArrowLeft size={20} weight="bold" /></button>
                                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20 font-bold text-sm">
                                     {(chats.find(c => c.phone === activeChatPhone)?.name || 'C').charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                     <h3 className="text-sm font-bold text-white">{chats.find(c => c.phone === activeChatPhone)?.name || 'Customer'}</h3>
                                     <p className="text-[10px] text-slate-500 font-bold">{activeChatPhone}</p>
                                  </div>
                               </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 custom-scrollbar flex flex-col">
                               {activeChatHistory.map((msg, i) => (
                                  <div key={i} className={cn("max-w-[85%] sm:max-w-[70%] flex flex-col", (msg.from === 'me' || msg.from === 'bot') ? "self-end items-end" : "self-start items-start")}>
                                     <div className={cn(
                                       "px-4 py-3 rounded-2xl text-[13px] font-medium leading-relaxed shadow-sm whitespace-pre-wrap break-words overflow-hidden", 
                                       (msg.from === 'me' || msg.from === 'bot') ? "bg-emerald-500 text-black rounded-tr-none" : "bg-white/5 text-slate-200 border border-border-dim rounded-tl-none")}>
                                        
                                        {/* MEDIA CONTENT */}
                                        {msg.type === 'image' && (
                                           <div className="mb-2 -mx-1 -mt-1 rounded-xl overflow-hidden bg-black/20">
                                              {msg.mediaUrl ? (
                                                 <img src={msg.mediaUrl} alt="msg" className="max-w-full h-auto object-cover max-h-64" />
                                              ) : (
                                                 <div className="p-4 flex items-center gap-2 text-[10px] font-bold opacity-50"><ImageSquare size={16} /> Image Received</div>
                                              )}
                                           </div>
                                        )}
                                        {msg.type === 'video' && (
                                           <div className="mb-2 -mx-1 -mt-1 rounded-xl overflow-hidden bg-black/20">
                                              {msg.mediaUrl ? (
                                                 <video controls src={msg.mediaUrl} className="max-w-full h-auto max-h-64" />
                                              ) : (
                                                 <div className="p-4 flex items-center gap-2 text-[10px] font-bold opacity-50"><VideoCamera size={16} /> Video Received</div>
                                              )}
                                           </div>
                                        )}
                                        {msg.type === 'document' && (
                                           <div className="mb-2 p-3 bg-black/10 rounded-xl flex items-center gap-3 border border-white/5">
                                              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-500"><FileText size={20} /></div>
                                              <div className="min-w-0 flex-1">
                                                 <p className="text-[11px] font-bold truncate">{msg.filename || msg.text || 'Document'}</p>
                                                 <p className="text-[9px] opacity-50 uppercase tracking-widest font-bold">PDF / DOC</p>
                                              </div>
                                           </div>
                                        )}

                                        {/* TEXT CONTENT */}
                                        {(msg.type === 'text' || !msg.type) && msg.text}
                                        {msg.type !== 'text' && msg.type && msg.text && msg.text !== msg.filename && (
                                           <div className="mt-2 pt-2 border-t border-black/5">{msg.text}</div>
                                        )}
                                     </div>
                                     <span className="text-[8px] font-bold text-slate-600 mt-1.5 uppercase tracking-widest px-1">{msg.timestamp ? new Date(parseInt(msg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                  </div>
                               ))}
                            </div>
                            <form onSubmit={handleSendReply} className="p-4 lg:p-6 bg-white/[0.01] border-t border-border-dim space-y-3 relative">
                               <AnimatePresence>
                                  {showAttachmentMenu && (
                                     <motion.div 
                                       initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                       animate={{ opacity: 1, scale: 1, y: 0 }}
                                       exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                       className="absolute bottom-full left-6 mb-4 bg-bg-surface border border-border-dim rounded-2xl shadow-2xl p-2 flex flex-col gap-1 z-50 min-w-[140px]"
                                     >
                                        <button type="button" onClick={() => document.getElementById('inbox-img').click()} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-slate-300 hover:text-emerald-500 transition-all text-xs font-bold">
                                           <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500"><ImageSquare size={18} /></div>
                                           Image
                                        </button>
                                        <button type="button" onClick={() => document.getElementById('inbox-vid').click()} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-slate-300 hover:text-emerald-500 transition-all text-xs font-bold">
                                           <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500"><VideoCamera size={18} /></div>
                                           Video
                                        </button>
                                        <button type="button" onClick={() => document.getElementById('inbox-doc').click()} className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/5 text-slate-300 hover:text-emerald-500 transition-all text-xs font-bold">
                                           <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500"><FileText size={18} /></div>
                                           Document
                                        </button>

                                        <input id="inbox-img" type="file" className="hidden" accept="image/*" onChange={(e) => handleSelectAttachment(e.target.files[0], 'image')} />
                                        <input id="inbox-vid" type="file" className="hidden" accept="video/*" onChange={(e) => handleSelectAttachment(e.target.files[0], 'video')} />
                                        <input id="inbox-doc" type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => handleSelectAttachment(e.target.files[0], 'document')} />
                                     </motion.div>
                                  )}
                               </AnimatePresence>

                               <AnimatePresence>
                                  {pendingAttachment && (
                                     <motion.div 
                                       initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                       animate={{ opacity: 1, scale: 1, y: 0 }}
                                       exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                       className="mx-2 mb-4 p-3 bg-bg-surface border border-border-dim rounded-2xl flex items-center gap-4 relative group"
                                     >
                                        <div className="w-12 h-12 rounded-lg bg-black/20 overflow-hidden flex items-center justify-center border border-white/5">
                                           {pendingAttachment.previewUrl ? (
                                              <img src={pendingAttachment.previewUrl} className="w-full h-full object-cover" />
                                           ) : (
                                              <div className="text-emerald-500"><FileText size={24} /></div>
                                           )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                           <p className="text-xs font-bold text-white truncate">{pendingAttachment.file.name}</p>
                                           <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{pendingAttachment.type}</p>
                                        </div>
                                        <button type="button" onClick={() => setPendingAttachment(null)} className="p-2 hover:bg-white/5 text-slate-500 hover:text-red-500 rounded-full transition-all">
                                           <X size={16} />
                                        </button>
                                     </motion.div>
                                  )}
                               </AnimatePresence>

                               <div className="flex items-center gap-2">
                                  <button 
                                    type="button" 
                                    onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                                    className={cn(
                                       "p-2.5 rounded-xl border transition-all",
                                       showAttachmentMenu ? "bg-emerald-500 text-black border-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-white/5 border-border-dim text-slate-400 hover:text-emerald-500"
                                    )}
                                  >
                                     <Paperclip size={18} weight={showAttachmentMenu ? "bold" : "regular"} />
                                  </button>
                                  <textarea value={replyText} onChange={e => { setReplyText(e.target.value); if(showAttachmentMenu) setShowAttachmentMenu(false); }} placeholder="Type a message..." className="flex-1 bg-bg-base border border-border-dim rounded-2xl p-3 lg:p-4 text-[13px] font-medium text-white outline-none focus:border-emerald-500/30 resize-none min-h-[48px] max-h-32 transition-all" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(e); } }} />
                                  <button type="submit" disabled={isSendingReply || (!replyText.trim() && !pendingAttachment)} className="h-12 w-12 lg:h-14 lg:w-14 flex items-center justify-center bg-emerald-500 text-black rounded-2xl transition-all shadow-lg shadow-emerald-500/10 disabled:opacity-50">
                                     {isSendingReply ? <ArrowsClockwise size={18} className="animate-spin" /> : <PaperPlaneTilt size={20} weight="bold" />}
                                  </button>
                               </div>
                            </form>
                         </>
                      ) : (
                         <div className="flex-1 flex flex-col items-center justify-center p-10 text-center opacity-30 select-none">
                            <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-6"><ChatCircleDots size={40} /></div>
                            <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-2">Select a Conversation</h3>
                            <p className="text-xs text-slate-500 max-w-xs leading-relaxed">Choose a contact from the left to start chatting in real-time.</p>
                         </div>
                      )}
                   </div>
                </motion.div>
               )}

              {/* ═══ SETTINGS TAB ═══ */}
              {activeTab === 'settings' && (
                <motion.div key="settings" {...PAGE_TRANSITION} className="max-w-2xl mx-auto py-4 lg:py-6">
                   <div className="simple-card space-y-8 lg:space-y-10 p-6 lg:p-8">
                      <div className="flex items-center justify-between border-b border-border-dim pb-4 lg:pb-6">
                          <div className="flex items-center gap-3 lg:gap-4">
                             <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500"><Gear size={18} weight="bold" /></div>
                             <div><h3 className="text-base lg:text-lg font-bold">API Settings</h3><p className="text-[10px] lg:text-xs text-slate-500">Connect your Meta account. Private to your account.</p></div>
                          </div>
                          <button type="button" onClick={() => setRevealCredentials(!revealCredentials)} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-widest", revealCredentials ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-white/5 text-slate-400 border-border-dim hover:text-white")}>
                             {revealCredentials ? <><EyeSlash size={14} weight="bold" /> Hide IDs</> : <><Eye size={14} weight="bold" /> Show IDs</>}
                          </button>
                      </div>
                      <form className="space-y-6 lg:space-y-8" onSubmit={async e => {
                        e.preventDefault();
                        setIsLoading(prev => ({ ...prev, config: true })); setStatus('Saving...');
                        try {
                           const res = await fetchWithAuth(`${API_BASE}/api/config`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(config) });
                           if (res.ok) { setIsConnected(true); setRevealCredentials(false); setStatus('Settings saved! Refreshing templates...'); await handleRefreshTemplates(); }
                           else { const err = await res.json(); setStatus(`Error: ${err.error || 'Save failed'}`); }
                        } catch (e) { setStatus('Could not save — is the server running?'); } finally { setIsLoading(prev => ({ ...prev, config: false })); }
                      }}>
                         <div className="space-y-5 lg:space-y-6">
                            <SimpleInput isSensitive={!revealCredentials} label="Phone Number ID" value={config.PHONE_NUMBER_ID} onChange={v => setConfig({...config, PHONE_NUMBER_ID: v})} placeholder="From Meta Business Portal" />
                            <SimpleInput isSensitive={!revealCredentials} label="WABA ID" value={config.WABA_ID} onChange={v => setConfig({...config, WABA_ID: v})} placeholder="From Meta Business Portal" />
                            <div className="space-y-2 relative group">
                               <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Access Token</label>
                               <textarea value={config.ACCESS_TOKEN} onChange={e => setConfig({...config, ACCESS_TOKEN: e.target.value})} className={cn("w-full h-28 lg:h-32 bg-bg-surface border border-border-dim rounded-xl p-4 text-xs font-mono outline-none focus:border-emerald-500/30 resize-none transition-all", !revealCredentials ? "text-transparent select-none filter blur-[2px]" : "text-white")} placeholder="Paste your Meta Graph API access token..." />
                               {!revealCredentials && config.ACCESS_TOKEN && (<div className="absolute inset-0 top-6 flex items-center justify-center pointer-events-none"><span className="text-[10px] font-bold text-slate-700 uppercase tracking-[0.5em] tracking-widest px-4 py-2 border border-dashed border-slate-800 rounded-lg">CREDENTIALS MASKED</span></div>)}
                            </div>
                         </div>
                         <button type="submit" disabled={isLoading.config} className="simple-btn btn-primary w-full h-12 lg:h-14 flex items-center justify-center gap-2">
                            {isLoading.config ? 'Saving...' : <><CheckCircle weight="bold" size={18} /> Save Settings</>}
                         </button>
                      </form>

                      {/* --- EMAIL ALERTS SECTION --- */}
                      <div className="pt-8 border-t border-border-dim space-y-8">
                         <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 lg:gap-4">
                               <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500"><Envelope size={18} weight="bold" /></div>
                               <div><h3 className="text-sm lg:text-base font-bold">Email Alerts</h3><p className="text-[10px] lg:text-xs text-slate-500">Get notified when customers reply.</p></div>
                            </div>
                            <button 
                              onClick={() => setEmailConfig({...emailConfig, enabled: !emailConfig.enabled})}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] lg:text-[11px] font-bold uppercase tracking-widest",
                                emailConfig.enabled ? "bg-emerald-500 text-black border-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-white/5 text-slate-500 border-border-dim hover:text-white"
                              )}
                            >
                               {emailConfig.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                         </div>

                         {emailConfig.enabled && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-6 lg:space-y-8 pt-2">
                               <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
                                  <SimpleInput label="SMTP Host" value={emailConfig.smtpHost} onChange={v => setEmailConfig({...emailConfig, smtpHost: v})} placeholder="smtp.gmail.com" />
                                  <SimpleInput label="SMTP Port" value={String(emailConfig.smtpPort)} onChange={v => setEmailConfig({...emailConfig, smtpPort: parseInt(v) || 0})} placeholder="587" />
                               </div>
                               <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
                                  <SimpleInput label="SMTP Username" value={emailConfig.smtpUser} onChange={v => setEmailConfig({...emailConfig, smtpUser: v})} placeholder="your-email@gmail.com" />
                                  <SimpleInput isSensitive label="SMTP Password" value={emailConfig.smtpPass} onChange={v => setEmailConfig({...emailConfig, smtpPass: v})} placeholder="App Password" />
                               </div>
                               <SimpleInput label="Notify Recipient Email" value={emailConfig.notifyEmail} onChange={v => setEmailConfig({...emailConfig, notifyEmail: v})} placeholder="alerts@yourcompany.com" />
                               
                               <div className="flex flex-col lg:flex-row gap-4 pt-2">
                                  <button onClick={handleSaveEmailSettings} disabled={isSavingEmail} className="flex-1 simple-btn btn-primary h-12 flex items-center justify-center gap-2">
                                     {isSavingEmail ? 'Saving...' : <><CheckCircle weight="bold" size={16} /> Save Alerts</>}
                                  </button>
                                  <button onClick={handleTestEmail} disabled={isTestingEmail || !emailConfig.smtpHost} className="flex-1 simple-btn bg-white/5 border border-border-dim text-white hover:bg-white/10 h-12 flex items-center justify-center gap-2 transition-all">
                                     {isTestingEmail ? 'Testing...' : <><PaperPlaneTilt size={16} weight="bold" /> Send Test Email</>}
                                  </button>
                               </div>
                            </motion.div>
                         )}
                      </div>

                       <div className="pt-8 border-t border-border-dim space-y-6">
                          <div className="flex items-center gap-3">
                             <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500"><ShieldCheck size={18} weight="bold" /></div>
                             <div><h4 className="text-sm font-bold">Meta Phone Registration</h4><p className="text-[10px] text-slate-500">Only needed if your dashboard shows "Pending".</p></div>
                          </div>
                          <div className="space-y-4 bg-white/[0.01] p-5 rounded-2xl border border-border-dim">
                             <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">6-Digit PIN</label>
                                <input type="text" maxLength={6} value={registrationPin} onChange={e => setRegistrationPin(e.target.value.replace(/\D/g, ''))} className="w-full bg-bg-surface border border-border-dim rounded-xl p-3 text-center text-xl font-mono tracking-[0.5em] text-white outline-none focus:border-amber-500/30 font-bold" placeholder="000000" />
                             </div>
                             <button onClick={handleRegisterPhone} disabled={isRegistering || registrationPin.length !== 6} className="simple-btn bg-amber-500 text-black w-full h-12 font-bold flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 disabled:opacity-50">
                                {isRegistering ? 'Registering...' : 'Complete Meta Registration'}
                             </button>
                          </div>
                       </div>
                    </div>
                 </motion.div>
               )}

           </AnimatePresence>
        </div>

        <footer className="h-10 border-t border-border-dim px-6 lg:px-10 flex items-center justify-between text-[10px] font-bold text-slate-600 uppercase tracking-widest shrink-0">
           <div>© 2026 TIM Cloud</div>
           <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> SaaS MODE</span>
              <span>v2.0.0</span>
           </div>
        </footer>
      </main>

      {/* RESULT MODAL */}
      <AnimatePresence>
         {selectedResult && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedResult(null)} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-lg bg-bg-surface border border-border-dim rounded-3xl overflow-hidden shadow-2xl">
                 <div className="p-6 lg:p-8 space-y-6">
                    <div className="flex justify-between items-start">
                       <div className="space-y-1">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recipient Details</p>
                          <h3 className="text-xl font-bold text-white">{selectedResult.phone}</h3>
                       </div>
                       <button onClick={() => setSelectedResult(null)} className="p-2 hover:bg-white/5 rounded-full transition-colors"><X size={20} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                       <div className="p-4 rounded-2xl bg-white/[0.02] border border-border-dim">
                          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">Name</p>
                          <p className="text-sm font-bold text-white">{selectedResult.name || 'N/A'}</p>
                       </div>
                       <div className="p-4 rounded-2xl bg-white/[0.02] border border-border-dim">
                          <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">Status</p>
                          <p className={cn("text-sm font-bold", selectedResult.status?.includes('Sent') || selectedResult.status?.includes('Delivered') ? "text-emerald-500" : "text-red-500")}>{selectedResult.status}</p>
                       </div>
                    </div>
                    {selectedResult.error && (
                      <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/10 space-y-2">
                        <p className="text-[9px] font-bold text-red-500 uppercase tracking-widest">Error Logs</p>
                        <p className="text-xs text-red-500/70 leading-relaxed font-mono">{selectedResult.error}</p>
                      </div>
                    )}
                 </div>
              </motion.div>
           </div>
         )}
      </AnimatePresence>
    </div>
  );
}

function TemplatePreview({ template, mapping, csvHeaders, uploadedMediaId, localMediaUrl }) {
  if (!template) return null;

  const header = template.componentsData?.header;
  const body = template.componentsData?.body;
  const footer = template.componentsData?.footer;
  const buttons = template.componentsData?.buttons || [];

  const getMediaUrl = () => {
    if (localMediaUrl) return localMediaUrl;
    const url = mapping.header_media_url || '';
    if (url.startsWith('http')) return url;
    return null;
  };

  const mediaUrl = getMediaUrl();

  return (
    <div className="w-full max-w-[320px] mx-auto bg-[#efeae2] rounded-[2rem] p-4 shadow-2xl border-[8px] border-slate-900 relative overflow-hidden flex flex-col h-[580px]">
       {/* Status Bar */}
       <div className="flex justify-between items-center px-4 mb-4 text-[10px] font-bold text-slate-400">
          <span>9:41</span>
          <div className="flex gap-1.5 items-center">
             <div className="w-3 h-3 rounded-full border border-slate-400" />
             <div className="w-1.5 h-3 bg-slate-400 rounded-sm" />
             <div className="w-4 h-2 bg-emerald-500 rounded-sm" />
          </div>
       </div>

       {/* Conversation Header */}
       <div className="bg-[#f0f2f5] -mx-4 -mt-4 p-4 mb-4 flex items-center gap-3 border-b border-slate-200">
          <div className="w-10 h-10 rounded-full bg-slate-300 flex items-center justify-center"><Plus size={20} className="rotate-45 text-slate-500" /></div>
          <div>
             <p className="text-xs font-bold text-slate-800">Business Preview</p>
             <p className="text-[9px] text-slate-500">Online</p>
          </div>
       </div>

       {/* Chat Area - SCROLLABLE */}
       <div className={`flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-smooth scrollbar-hide`}>
          <div className="bg-white rounded-2xl rounded-tl-none p-2 shadow-sm relative max-w-[95%]">
             {/* Header Media */}
             {header?.type && ['IMAGE', 'VIDEO'].includes(header.type) && (
               <div className="w-full aspect-[1.91/1] bg-slate-100 rounded-lg mb-2 overflow-hidden border border-slate-100 flex items-center justify-center relative">
                  {mediaUrl ? (
                    <img src={mediaUrl} className="w-full h-full object-contain bg-slate-50" alt="Preview" />
                  ) : (
                    <div className="text-center space-y-1">
                       {header.type === 'IMAGE' ? <Plus size={24} className="mx-auto text-slate-300" /> : <Play size={24} className="mx-auto text-slate-300" weight="fill" />}
                       <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{header.type} PREVIEW</p>
                    </div>
                  )}
                  {uploadedMediaId && <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center"><CheckCircle size={20} className="text-emerald-500" weight="fill" /></div>}
               </div>
             )}

             {/* Message Content */}
             <div className="px-1 py-1 space-y-1.5 text-black">
                {header?.type === 'TEXT' && (
                  <p className="text-[11px] font-extrabold leading-tight">
                    {(header.text || '').replace(/{{([a-zA-Z0-9_]+)}}/g, (match, v) => {
                      const mapCol = mapping[v] || mapping[`Header Var ${v}`] || '';
                      return mapCol ? `[${mapCol}]` : `{{${v}}}`;
                    })}
                  </p>
                )}
                <p className="text-[11px] leading-relaxed whitespace-pre-wrap">
                  {(body?.text || '...').replace(/{{([a-zA-Z0-9_]+)}}/g, (match, v) => {
                    const mapCol = mapping[v] || mapping[`Body Var ${v}`] || '';
                    return mapCol ? `[${mapCol}]` : `{{${v}}}`;
                  })}
                </p>
                {footer?.text && <p className="text-[9px] text-slate-500 mt-1">{footer.text}</p>}
             </div>
             
             {/* Timestamp (fake) */}
             <div className="text-right mt-1.5">
                <span className="text-[8px] text-slate-400 font-bold">12:34 PM</span>
             </div>

             {/* Buttons Section */}
             {buttons.length > 0 && (
               <div className="mt-2 -mx-2 -mb-2 border-t border-slate-50 divide-y divide-slate-50 bg-white/50 rounded-b-2xl overflow-hidden">
                 {buttons.map((btn, idx) => (
                   <div key={idx} className="p-2.5 text-center text-[11px] font-bold text-sky-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5">
                     {btn.type === 'PHONE_NUMBER' && <Phone size={12} weight="fill" />}
                     {btn.type === 'URL' && <ArrowSquareOut size={12} />}
                     {btn.text}
                   </div>
                 ))}
               </div>
             )}

             {/* Tail */}
             <div className="absolute -left-[7px] top-0 w-2 h-4 bg-white" style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
          </div>
       </div>
    </div>
  );
}

/* ═══════════════════ COMPONENTS ═══════════════════ */

function SidebarLink({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button onClick={onClick} className={cn("w-full sidebar-item group relative", active ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/10" : "text-slate-500 hover:text-white hover:bg-white/[0.03]")}>
      <Icon size={18} weight={active ? "fill" : "bold"} className={cn("transition-transform group-hover:scale-110", active ? "text-black" : "text-slate-600 group-hover:text-emerald-500")} />
      <span className="font-bold flex-1 text-left">{label}</span>
      {badge && (
        <span className={cn(
          "px-1.5 py-0.5 rounded-full text-[9px] font-black min-w-[18px] text-center shadow-sm",
          active ? "bg-black/20 text-black" : "bg-emerald-500 text-black border border-emerald-500/20 shadow-emerald-500/10"
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}

function MetricCard({ label, value, icon: Icon, color = "text-white" }) {
  return (
    <div className="simple-card flex flex-col justify-between h-28 lg:h-36 relative overflow-hidden group">
       <div className="absolute top-0 right-0 p-4 lg:p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity"><Icon size={60} weight="fill" /></div>
       <div className="flex justify-between items-start relative z-10">
          <div className="space-y-1">
             <p className="text-[9px] lg:text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</p>
             <h3 className={cn("text-2xl lg:text-3xl font-bold tracking-tight", color)}>{value}</h3>
          </div>
          <div className={cn("p-2 rounded-lg bg-white/5", color)}><Icon size={16} weight="bold" /></div>
       </div>
       <div className="relative z-10"><div className="w-full h-1 bg-white/5 rounded-full overflow-hidden"><div className="w-2/3 h-full bg-emerald-500/20" /></div></div>
    </div>
  );
}

function MiniStat({ label, value, color = "text-white" }) {
  return (
    <div className="simple-card p-3 lg:p-4 text-center space-y-1">
       <p className="text-[8px] lg:text-[9px] font-bold text-slate-600 uppercase tracking-[0.15em] lg:tracking-[0.2em]">{label}</p>
       <p className={cn("text-base lg:text-lg font-bold", color)}>{value}</p>
    </div>
  );
}

function SimpleInput({ label, value, onChange, placeholder, isSensitive = false }) {
  return (
    <div className="space-y-2 pointer-events-auto">
       <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{label}</label>
       <input 
         type={isSensitive ? "password" : "text"}
         value={value} 
         onChange={e => onChange(e.target.value)} 
         placeholder={placeholder} 
         className={cn("w-full bg-bg-surface border border-border-dim rounded-xl p-3 lg:p-4 text-sm font-bold text-white outline-none focus:border-emerald-500/30 transition-all placeholder:text-slate-800", isSensitive && "tracking-[0.5em] font-mono")} 
       />
    </div>
  );
}

function FieldSelect({ label, value, onChange, options }) {
  return (
    <div className="space-y-2">
       <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{label}</label>
       <div className="relative">
          <select value={value} onChange={e => onChange(e.target.value)} className="w-full bg-bg-surface border border-border-dim rounded-xl p-3 text-xs font-bold text-white outline-none focus:border-emerald-500/20 appearance-none">
             <option value="">-- Select --</option>
             {options.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
          <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={12} />
       </div>
    </div>
  );
}
