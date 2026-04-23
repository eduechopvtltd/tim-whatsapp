import React, { useState, useEffect, useMemo, useRef } from 'react';
import { io } from "socket.io-client";
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
  Envelope,
  User,
  CircleDashed,
  ChatCenteredDots,
  DotsThreeVertical,
  Smiley,
  Check,
  Lock,
  Trash
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
  const [authView, setAuthView] = useState('login'); // login, signup, forgot, reset
  const [authForm, setAuthForm] = useState({ username: '', password: '', confirmPassword: '', email: '' });
  const [authError, setAuthError] = useState('');
  const [resetToken, setResetToken] = useState(null);

  // Check for reset token in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('resetToken');
    if (tokenFromUrl) {
      setResetToken(tokenFromUrl);
      setAuthView('reset');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

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
  const [socketConnected, setSocketConnected] = useState(false);
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
  const [historyStatusFilter, setHistoryStatusFilter] = useState('All');
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
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const messagesEndRef = useRef(null);

  // ═══════════ AUTH FUNCTIONS ═══════════
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    
    let endpoint = '/auth/login';
    let payload = { ...authForm };

    if (authView === 'signup') {
      if (authForm.password !== authForm.confirmPassword) {
        setAuthError('Passwords do not match');
        return;
      }
      endpoint = '/auth/register';
    }
    if (authView === 'forgot') {
      endpoint = '/auth/forgot-password';
      payload = { email: authForm.email };
    }
    if (authView === 'reset') {
      endpoint = '/auth/reset-password';
      payload = { token: resetToken, password: authForm.password };
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      if (authView === 'login') {
        setToken(data.token);
        setUser({ id: data.id, username: data.username });
        localStorage.setItem('tim_token', data.token);
        localStorage.setItem('tim_user', JSON.stringify({ id: data.id, username: data.username }));
      } else if (authView === 'signup') {
        setAuthView('login');
        setAuthError('Account created! Please login.');
      } else if (authView === 'forgot') {
        setAuthError('Success: Check your email for the reset link.');
      } else if (authView === 'reset') {
        setAuthView('login');
        setAuthError('Success: Password updated. You can now login.');
        setResetToken(null);
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

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== 'DELETE') return;
    setIsDeletingAccount(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/account/nuclear-reset`, { method: 'DELETE' });
      if (res.ok) {
        logout();
        setIsDeleteAccountModalOpen(false);
        setDeleteConfirmationText('');
        // Force refresh to clear any cached states
        window.location.reload();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to delete account');
      }
    } catch (e) {
      console.error('[DELETE ERROR]', e);
      alert('Request failed. Check your network or server logs.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // ═══════════ REAL-TIME CORE (SOCKET.IO) ═══════════
  const socket = useMemo(() => {
    if (!token) return null;
    return io(API_BASE);
  }, [token]);

  useEffect(() => {
    if (!socket || !user) return;

    socket.on('connect', () => {
      console.log('[Socket] Connected to server');
      setSocketConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from server');
      setSocketConnected(false);
    });

    // CRITICAL: Always join/re-join room when user state is confirmed
    const uId = user.id || user._id;
    if (uId) {
      console.log(`[Socket] Joining room: ${uId}`);
      socket.emit('join', uId);
    }

    socket.on('status_update', ({ jobId: updatedJobId, phone: updatedPhone, status: newStatus }) => {
      // ONLY update the active campaign status (Status Tab)
      if (String(jobId) === String(updatedJobId)) {
        setJobStatus(prev => {
          if (!prev) return null;
          const updatedResults = prev.results.map(r => 
            r.phone === updatedPhone ? { ...r, status: newStatus } : r
          );
          return { ...prev, results: updatedResults };
        });
      }

      // Live update History tab ONLY if it is currently open (prevents sending-lag)
      if (activeTab === 'history') {
        setHistoryData(prev => prev.map(job => {
          const jId = String(job.id || job._id || '');
          if (jId === String(updatedJobId) || jId.slice(-6) === String(updatedJobId).slice(-6)) {
            const updatedResults = job.results?.map(r => 
              r.phone === updatedPhone ? { ...r, status: newStatus } : r
            );
            return { ...job, results: updatedResults };
          }
          return job;
        }));

        // ALSO update the expanded detail view if user is looking at this job
        setExpandedHistoryJob(prev => {
          if (!prev) return null;
          const prevId = String(prev.id || prev._id || '');
          if (prevId === String(updatedJobId) || prevId.slice(-6) === String(updatedJobId).slice(-6)) {
            const updatedResults = prev.results?.map(r => 
              r.phone === updatedPhone ? { ...r, status: newStatus } : r
            );
            return { ...prev, results: updatedResults };
          }
          return prev;
        });
      }
    });

    socket.on('campaign_progress', ({ jobId: progJobId, status: newProgress }) => {
      // ONLY update the active campaign progress
      if (String(jobId) === String(progJobId)) {
        setJobStatus(newProgress);
        
        // Refresh history list if it's currently being viewed
        if (activeTab === 'history' || newProgress.status === 'Completed' || newProgress.status === 'Stopped') {
           fetchWithAuth(`${API_BASE}/api/history`).then(r => r.json()).then(d => { if (Array.isArray(d)) setHistoryData(d); });
        }
      }
    });

    socket.on('new_message', ({ phone, name, text, type }) => {
      // Refresh current chat history if open
      if (activeChatPhone === phone) {
        fetchWithAuth(`${API_BASE}/api/chats/${phone}`).then(r => r.json()).then(d => { 
          if (Array.isArray(d)) setActiveChatHistory(d); 
        });
      }
      // Refresh global chat list for unread counts
      fetchWithAuth(`${API_BASE}/api/chats`).then(r => r.json()).then(d => { 
        if (Array.isArray(d)) setChats(d); 
      });

      // Play sound and show notification if appropriate
      if (notificationSound) notificationSound.play().catch(() => {});
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`New message from ${name}`, { body: text });
      }
    });

    return () => {
      socket.off('connect');
      socket.off('status_update');
      socket.off('campaign_progress');
      socket.off('new_message');
    };
  }, [socket, user, jobId, activeChatPhone]);

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
      // Auto-repair user ID if missing (Critical for Socket.io)
      if (data.ID && (!user?.id || user.id !== data.ID)) {
        const updatedUser = { ...user, id: data.ID };
        setUser(updatedUser);
        localStorage.setItem('tim_user', JSON.stringify(updatedUser));
      }

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
  }, [token, activeTab]);

  // REAL-TIME CONNECTION CHECK
  useEffect(() => {
    if (!token) return;
    const isConfigured = !!(config.PHONE_NUMBER_ID && config.ACCESS_TOKEN);
    setIsConnected(isConfigured);
    if (!isConfigured) { setMetaSynced(false); return; }
  }, [config, token]);

  // JOB POLLING (Safety Fallback + Sockets)
  useEffect(() => {
    if (!jobId || !token) return;
    const fetchStatus = () => {
      fetchWithAuth(`${API_BASE}/api/status/${jobId}`).then(r => r.json()).then(d => {
        if (!d.error) setJobStatus(d);
        if (d.status === 'Completed' || d.status === 'Stopped') {
           fetchWithAuth(`${API_BASE}/api/history`).then(r => r.json()).then(d => { if (Array.isArray(d)) setHistoryData(d); });
        }
      }).catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000); // reduced frequency to 15s
    return () => clearInterval(interval);
  }, [jobId, token]);

  // INBOX (Initial load + 30s safety poll)
  useEffect(() => {
    if (!token) return;
    const fetchChats = () => {
      fetchWithAuth(`${API_BASE}/api/chats`).then(r => r.json()).then(d => { if (Array.isArray(d)) setChats(d); }).catch(() => {});
    };
    fetchChats();
    const interval = setInterval(fetchChats, 30000); // reduced to 30s
    return () => clearInterval(interval);
  }, [token, activeTab]);

  useEffect(() => {
    if (!token || activeTab !== 'inbox' || !activeChatPhone) return;
    const fetchHistory = () => {
      fetchWithAuth(`${API_BASE}/api/chats/${activeChatPhone}`).then(r => r.json()).then(d => { if (Array.isArray(d)) setActiveChatHistory(d); }).catch(() => {});
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 20000); // reduced to 20s
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
    let items = historyData;
    
    // Status Filter
    if (historyStatusFilter !== 'All') {
      items = items.filter(job => (job.status || 'Completed') === historyStatusFilter);
    }

    if (!debouncedHistorySearch) return items;
    return items.filter(job => 
      (job.name || job.templateName || '').toLowerCase().includes(debouncedHistorySearch.toLowerCase()) ||
      String(job.id || job._id || '').includes(debouncedHistorySearch)
    );
  }, [historyData, debouncedHistorySearch, historyStatusFilter]);

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      // Use numeric timestamps for precise comparison
      const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      
      // 1. Primary sort: last message timestamp (newest first)
      if (dateB !== dateA) return dateB - dateA;
      
      // 2. Absolute Tie-breaker (Descending based on ID/Phone)
      // This ensures that even in the same millisecond, the order never shifts.
      return (b._id || b.phone || '').localeCompare(a._id || a.phone || '');
    });
  }, [chats]);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(searchTerm), 300); return () => clearTimeout(t); }, [searchTerm]);
  useEffect(() => { const t = setTimeout(() => setDebouncedHistorySearch(historySearchTerm), 300); return () => clearTimeout(t); }, [historySearchTerm]);

  // INSTANT JUMP TO BOTTOM - OPTIMIZED
  useEffect(() => {
    if (activeChatPhone && activeChatHistory.length > 0) {
      // Use direct manipulation for maximum speed
      const scrollContainer = document.querySelector('.inbox-scroll-container');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
      
      // Fallback to scrollIntoView for safety (next tick)
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      });
    }
  }, [activeChatHistory, activeChatPhone]);

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
       <div className="min-h-screen bg-bg-base flex items-center justify-center p-6 lg:p-10 relative overflow-hidden">
        {/* Subtle background element */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-500/[0.02] rounded-full blur-[120px] pointer-events-none" />
        
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[400px] simple-card !p-10 space-y-8 relative z-10">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500 flex items-center justify-center text-black font-extrabold text-2xl mx-auto mb-6 shadow-xl shadow-emerald-500/10">T</div>
            <h1 className="text-2xl lg:text-3xl font-bold text-white tracking-tight">TIM Cloud</h1>
            <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-[0.2em] font-black">Professional WhatsApp CRM</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {(authView === 'login' || authView === 'signup') && (
              <SimpleInput 
                label={authView === 'login' ? "Username or Email" : "Username"} 
                value={authForm.username} 
                onChange={v => setAuthForm({...authForm, username: v})} 
                placeholder={authView === 'login' ? "Enter username or email" : "Choose a username"} 
              />
            )}
            
            {(authView === 'signup' || authView === 'forgot') && (
              <SimpleInput label="Email Address" value={authForm.email} onChange={v => setAuthForm({...authForm, email: v})} placeholder="name@company.com" />
            )}

            {(authView === 'login' || authView === 'signup' || authView === 'reset') && (
              <div className="space-y-1">
                <SimpleInput label={authView === 'reset' ? 'New Password' : 'Password'} value={authForm.password} onChange={v => setAuthForm({...authForm, password: v})} placeholder="••••••••" isSensitive={true} />
                {authView === 'signup' && (
                  <SimpleInput label="Confirm Password" value={authForm.confirmPassword} onChange={v => setAuthForm({...authForm, confirmPassword: v})} placeholder="••••••••" isSensitive={true} />
                )}
                {authView === 'login' && (
                  <div className="flex justify-end">
                    <button type="button" onClick={() => { setAuthView('forgot'); setAuthError(''); }} className="text-[10px] font-bold text-slate-500 hover:text-emerald-500 transition-colors uppercase tracking-widest">Forgot Password?</button>
                  </div>
                )}
              </div>
            )}

            {authError && (
              <div className={cn(
                "p-3 rounded-xl text-xs text-center font-bold",
                authError.toLowerCase().includes('success') || authError.toLowerCase().includes('created') 
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500' 
                  : 'bg-red-500/10 border border-red-500/20 text-red-500'
              )}>
                {authError}
              </div>
            )}

            <button type="submit" className="simple-btn btn-primary w-full h-12 flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-[11px]">
              {authView === 'login' && 'Sign In'}
              {authView === 'signup' && 'Create Account'}
              {authView === 'forgot' && 'Send Reset Link'}
              {authView === 'reset' && 'Update Password'}
            </button>
          </form>

          <div className="text-center space-y-3">
            {authView === 'forgot' || authView === 'reset' ? (
              <button onClick={() => { setAuthView('login'); setAuthError(''); }} className="text-slate-500 hover:text-white text-xs transition-colors font-bold">
                 Back to Sign In
              </button>
            ) : (
              <button onClick={() => { setAuthView(authView === 'login' ? 'signup' : 'login'); setAuthError(''); }} className="text-slate-500 hover:text-white text-xs transition-colors font-bold">
                {authView === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
              </button>
            )}
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
        "fixed inset-y-0 left-0 lg:sticky lg:h-screen lg:top-0 lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="px-4 mb-8 flex items-center justify-between">
           <div className="flex items-center gap-2">
             <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-black font-bold text-sm">T</div>
             <h1 className="text-lg font-bold">TIM Cloud</h1>
           </div>
           <button className="lg:hidden p-1 text-slate-500 hover:text-white" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto pr-2 custom-scrollbar">
          <SidebarLink active={activeTab === 'home'} onClick={() => switchTab('home')} icon={House} label="Home" />
          <SidebarLink active={activeTab === 'send'} onClick={() => switchTab('send')} icon={PaperPlaneTilt} label="Send" />
          <SidebarLink active={activeTab === 'status'} onClick={() => switchTab('status')} icon={ChartLine} label="Status" badge={jobStatus?.status === 'Running' ? '●' : null} />
          <SidebarLink active={activeTab === 'inbox'} onClick={() => switchTab('inbox')} icon={ChatCircleDots} label="Inbox" badge={unreadTotal > 0 ? unreadTotal : null} />
          <SidebarLink active={activeTab === 'history'} onClick={() => switchTab('history')} icon={Clock} label="History" badge={historyData.length > 0 ? historyData.length : null} />
          <div className="pt-4 border-t border-border-dim mt-4 opacity-50" />
          <SidebarLink active={activeTab === 'settings'} onClick={() => switchTab('settings')} icon={Gear} label="Settings" />
        </nav>

        <div className="mt-auto pt-6 px-2 space-y-3 shrink-0 border-t border-border-dim/50">
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

        <header className="h-16 lg:h-20 flex items-center justify-between px-4 lg:px-10 border-b border-border-dim shrink-0 bg-bg-base/50 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-3 lg:gap-4 min-w-0">
             <button className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-white bg-white/5 rounded-lg border border-border-dim transition-all shrink-0" onClick={() => setSidebarOpen(true)}><List size={20} weight="bold" /></button>
             <h2 className="text-base lg:text-xl font-bold tracking-tight truncate">{TAB_TITLES[activeTab]}</h2>
          </div>

          <div className="flex items-center gap-3 lg:gap-6 shrink-0">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${socketConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-red-500 anim-pulse'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-widest hidden sm:inline ${socketConnected ? 'text-emerald-500' : 'text-slate-500'}`}>
                {socketConnected ? 'Live Connection Active' : 'Live Offline (Polling)'}
              </span>
            </div>
            <div className="flex items-center gap-2 py-1 px-2 lg:px-3 rounded-lg bg-emerald-500/5 border border-border-dim">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${metaSynced ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-slate-700'}`} />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest hidden md:inline">
                {metaSynced ? 'Meta API Synced' : 'Meta Offline'}
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-10">
           <AnimatePresence mode="wait">

              {/* ═══ HOME TAB ═══ */}
              {activeTab === 'home' && (
                 <motion.div key="home" {...PAGE_TRANSITION} className="space-y-6 lg:space-y-10 max-w-6xl">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
                       <MetricCard label="Messages Sent" value={stats.totalSent} icon={PaperPlaneTilt} color="text-emerald-500" />
                       <MetricCard label="Success Rate" value={`${stats.totalSent > 0 ? (stats.totalSent / (stats.totalSent + stats.totalFailed) * 100).toFixed(1) : 0}%`} icon={CheckCircle} color="text-emerald-500" />
                       <MetricCard label="Active Campaigns" value={stats.totalCampaigns} icon={Database} color="text-emerald-500" />
                    </div>
                   <div className="flex flex-col md:flex-row gap-6 lg:gap-8">
                      <div className="flex-1 space-y-4">
                         <h3 className="text-xs lg:text-sm font-bold text-slate-500 uppercase tracking-widest">Weekly Activity</h3>
                         <div className="simple-card h-48 lg:h-64 flex items-end justify-between gap-1 lg:gap-3 px-2 lg:px-6 pt-10 pb-2">
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
                <div key="send" className="max-w-6xl mx-auto flex flex-col gap-8 pb-20">
                   
                   {/* SEGMENT 1: UPLOAD (FULL WIDTH) */}
                   <motion.div {...PAGE_TRANSITION} className="w-full">
                      <div className="simple-card space-y-4 lg:space-y-5">
                         <div className="flex items-center gap-4 border-b border-border-dim pb-4 mb-4">
                            <div>
                               <h3 className="text-base lg:text-lg font-bold">Upload Contacts</h3>
                               <p className="text-[10px] lg:text-xs text-slate-500">Pick a CSV file with your contacts.</p>
                            </div>
                         </div>
                         <label className="block group cursor-pointer">
                            <div className={cn("rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all", file ? "h-24 border-emerald-500/30 bg-emerald-500/5" : "h-32 border-border-dim bg-white/[0.01] hover:border-emerald-500/20")}>
                               {file ? (
                                  <div className="text-center px-4 flex flex-col items-center">
                                     <CheckCircle size={20} className="text-emerald-500 mb-1" weight="fill" />
                                     <p className="text-xs font-bold text-white truncate max-w-[280px]">{file.name}</p>
                                     <p className="text-[9px] text-emerald-500 font-bold uppercase mt-0.5">{csvData.length} Contacts Found</p>
                                  </div>
                               ) : (
                                  <div className="text-center"><Plus size={18} className="text-slate-600 mb-1 mx-auto" weight="bold" /><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Click to Upload CSV</p></div>
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
                   </motion.div>

                   {/* SEGMENT 2: PARALLEL WORK AREA */}
                   <div className="flex flex-col md:flex-row gap-8 items-start">
                      
                      {/* LEFT: SETTINGS */}
                      <motion.div {...PAGE_TRANSITION} className="flex-1 space-y-6 lg:space-y-8 min-w-0">
                         {/* 2. CHOOSE MESSAGE */}
                         <div className="simple-card space-y-4 lg:space-y-5">
                            <div className="flex items-center gap-4 border-b border-border-dim pb-4 mb-4">
                               <div className="flex-1">
                                  <h3 className="text-base lg:text-lg font-bold">Choose Message</h3>
                                  <p className="text-[10px] lg:text-xs text-slate-500">Pick a template or write a custom message.</p>
                               </div>
                            </div>
                            <div className="space-y-4">
                               <div className="flex gap-2 p-1 bg-white/[0.02] border border-border-dim rounded-xl w-fit">
                                  <button onClick={() => setMessageType('template')} className={cn("px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all", messageType === 'template' ? "bg-emerald-500 text-black shadow-lg" : "text-slate-500 hover:text-slate-300")}>Template</button>
                                  <button onClick={() => setMessageType('custom')} className={cn("px-6 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all", messageType === 'custom' ? "bg-emerald-500 text-black shadow-lg" : "text-slate-500 hover:text-slate-300")}>Custom</button>
                               </div>
                               
                               {messageType === 'template' ? (
                                  <div className="space-y-5">
                                     <div className="flex gap-2 items-end">
                                        <div className="flex-1 space-y-1.5">
                                           <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Template Name</label>
                                           <div className="relative">
                                              <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="w-full bg-bg-surface border border-border-dim rounded-xl p-3 text-xs font-bold text-white outline-none appearance-none focus:border-emerald-500/30 transition-all">
                                                 <option value="">-- Choose Template --</option>
                                                 {templates.map(t => <option key={t.name} value={t.name}>{t.name} ({t.language})</option>)}
                                              </select>
                                              <CaretDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={14} />
                                           </div>
                                        </div>
                                        <button onClick={handleRefreshTemplates} disabled={refreshingTemplates} className={cn("simple-btn bg-white/5 border border-border-dim text-slate-400 hover:text-emerald-500 hover:border-emerald-500/20 h-11 px-3 mb-[1px]", refreshingTemplates && "animate-pulse")} title="Refresh templates">
                                           <ArrowsClockwise size={18} className={refreshingTemplates ? "animate-spin" : ""} />
                                        </button>
                                     </div>

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

                                     {(bodyVariables.length > 0 || footerVariables.length > 0 || buttons.some(b => b.variables?.length > 0)) && (
                                        <div className="p-4 rounded-2xl bg-white/[0.01] border border-border-dim space-y-4">
                                           <div className="flex items-center gap-2 mb-1">
                                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Message Body & Variables</p>
                                           </div>
                                           
                                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                              {bodyVariables.map((v, i) => (
                                                 <FieldSelect key={`b-${i}`} label={`Body: ${v}`} value={mapping[v] || mapping[`Body Var ${v}`] || ''} onChange={val => setMapping({...mapping, [v]: val, [`Body Var ${v}`]: val})} options={csvHeaders} />
                                              ))}
                                              {footerVariables.map((v, i) => (
                                                 <FieldSelect key={`f-${i}`} label={`Footer: ${v}`} value={mapping[v] || mapping[`Footer Var ${v}`] || ''} onChange={val => setMapping({...mapping, [v]: val, [`Footer Var ${v}`]: val})} options={csvHeaders} />
                                              ))}
                                           </div>
                                           {buttons.map((btn, bIdx) => btn.variables?.length > 0 && (
                                              <div key={`btn-${bIdx}`} className="p-3 rounded-xl bg-white/[0.01] border border-emerald-500/5 space-y-3">
                                                 <p className="text-[9px] font-bold text-emerald-500/60 uppercase tracking-tighter">Button Parameter: {btn.text}</p>
                                                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    {btn.variables.map((v, vIdx) => (
                                                       <FieldSelect key={vIdx} label={`Button ${btn.text}: ${v}`} value={mapping[`btn_${bIdx}_${v}`] || mapping[`Btn ${bIdx} Var ${v}`] || ''} onChange={val => setMapping({...mapping, [`btn_${bIdx}_${v}`]: val, [`Btn ${bIdx} Var ${v}`]: val})} options={csvHeaders} />
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
                      </motion.div>

                      {/* RIGHT: LIVE PREVIEW (STICKY) */}
                      <div className="w-full lg:w-[350px] shrink-0 sticky top-24 space-y-4 z-10 pt-1.5">
                         <div className="flex items-center justify-between px-2">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Live Preview</h3>
                            <div className="flex items-center gap-2">
                               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                               <span className="text-[10px] font-bold text-emerald-500/60 uppercase">High Fidelity</span>
                            </div>
                         </div>
                         <TemplatePreview template={selectedTpl} mapping={mapping} csvHeaders={csvHeaders} uploadedMediaId={uploadedMediaId} localMediaUrl={localMediaUrl} />
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
                </div>
              )}
              {/* ═══ STATUS TAB ═══ */}
              {activeTab === 'status' && (
                <motion.div key="status" {...PAGE_TRANSITION} className="max-w-4xl mx-auto space-y-6 lg:space-y-8">
                   {jobStatus ? (
                     <>
                       <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
                          <MiniStat label="Processed" value={`${jobStatus.processed || 0}/${jobStatus.totalContacts || jobStatus.total || 0}`} />
                          <MiniStat label="Sent" value={jobStatus.results?.filter(r => r.status?.includes('Sent') || r.status?.includes('Delivered') || r.status?.includes('Read')).length || 0} color="text-emerald-500" />
                          <MiniStat label="Failed" value={jobStatus.results?.filter(r => r.status?.includes('Failed')).length || 0} color="text-red-500" />
                          <MiniStat label="Remaining" value={(jobStatus.totalContacts || jobStatus.total || 0) - (jobStatus.processed || 0)} />
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
                             <motion.div initial={{ width: 0 }} animate={{ width: `${(jobStatus.processed / (jobStatus.totalContacts || jobStatus.total || 1) * 100) || 0}%` }} className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
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
                <motion.div key="history" {...PAGE_TRANSITION} className="space-y-8 max-w-6xl pb-20">
                   
                   {/* 1. GLOBAL SUMMARY BAR (Visible only on list view) */}
                   {!expandedHistoryJob && (
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
                        <div className="simple-card flex items-center gap-5 group hover:border-emerald-500/10 transition-all">
                           <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/10 group-hover:scale-110 transition-transform">
                              <ChartLine size={24} weight="bold" />
                           </div>
                           <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Campaigns</p>
                              <p className="text-2xl font-bold text-white">{stats.totalCampaigns}</p>
                           </div>
                        </div>
                        <div className="simple-card flex items-center gap-5 group hover:border-emerald-500/10 transition-all">
                           <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/10 group-hover:scale-110 transition-transform">
                              <PaperPlaneTilt size={24} weight="bold" />
                           </div>
                           <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Messages Sent</p>
                              <p className="text-2xl font-bold text-white">{stats.totalSent}</p>
                           </div>
                        </div>
                        <div className="simple-card flex items-center gap-5 group hover:border-emerald-500/10 transition-all">
                           <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/10 group-hover:scale-110 transition-transform">
                              <CheckCircle size={24} weight="bold" />
                           </div>
                           <div>
                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Success Rate</p>
                              <p className="text-2xl font-bold text-white">
                                {stats.totalSent > 0 ? ((stats.totalSent / (stats.totalSent + stats.totalFailed)) * 100).toFixed(1) : '0'}%
                              </p>
                           </div>
                        </div>
                     </div>
                   )}

                   {/* 2. HEADER: TITLE & SEARCH/FILTER */}
                   <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 px-1">
                      <div className="flex items-center gap-4">
                        {expandedHistoryJob && (
                          <button onClick={() => setExpandedHistoryJob(null)} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-all border border-border-dim hover:border-emerald-500/20 group shadow-lg">
                            <ArrowLeft size={18} weight="bold" className="group-hover:-translate-x-1 transition-transform" />
                            <span className="text-xs font-bold uppercase tracking-widest">Back to Dashboard</span>
                          </button>
                        )}
                        <h3 className="text-xl lg:text-2xl font-bold tracking-tight">
                          {expandedHistoryJob ? 'Campaign Analytics' : 'Campaign History'}
                        </h3>
                      </div>
                      
                      {!expandedHistoryJob && (
                        <div className="flex flex-col md:flex-row items-center gap-3 w-full sm:w-auto">
                           <div className="flex items-center p-1 bg-white/[0.02] border border-border-dim rounded-xl">
                              {['All', 'Running', 'Completed', 'Stopped'].map(status => (
                                 <button
                                    key={status}
                                    onClick={() => setHistoryStatusFilter(status)}
                                    className={cn(
                                       "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                                       historyStatusFilter === status 
                                          ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/10" 
                                          : "text-slate-500 hover:text-slate-300"
                                    )}
                                 >
                                    {status === 'All' ? 'All Campaigns' : status}
                                 </button>
                              ))}
                           </div>
                           <div className="relative flex-1 sm:w-64 group">
                             <MagnifyingGlass size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-emerald-500 transition-colors" />
                             <input value={historySearchTerm} onChange={e => setHistorySearchTerm(e.target.value)} placeholder="Search by ID or name..." className="w-full bg-white/[0.04] border border-border-dim rounded-xl pl-11 pr-4 py-2.5 text-xs font-bold text-white outline-none focus:border-emerald-500/20 shadow-inner" />
                          </div>
                          {historyData.length > 0 && (
                            <button onClick={() => { if(confirm('Wipe all history? This action is irreversible.')) fetchWithAuth(`${API_BASE}/api/history/clear`, { method: 'POST' }).then(() => setHistoryData([])) }} className="p-3 bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 rounded-xl text-red-500 transition-all group" title="Clear All History">
                               <Square size={18} weight="bold" className="group-hover:rotate-90 transition-transform" />
                            </button>
                          )}
                        </div>
                      )}
                   </div>

                   {/* 3. CONTENT AREA */}
                   {expandedHistoryJob ? (
                     <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Analytics Header Card */}
                        <div className="simple-card border-emerald-500/5 !bg-gradient-to-br from-bg-surface to-bg-base">
                           <div className="flex flex-col md:flex-row justify-between gap-6 mb-8">
                              <div className="space-y-2">
                                 <div className="flex items-center gap-3">
                                    <div className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[9px] font-black uppercase tracking-widest leading-normal">
                                       {expandedHistoryJob.templateName || 'Custom Message'}
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">ID: #{String(expandedHistoryJob.id || expandedHistoryJob._id || '').slice(-8)}</span>
                                 </div>
                                 <h4 className="text-2xl font-bold text-white">{expandedHistoryJob.name || expandedHistoryJob.templateName || 'Untitled Campaign'}</h4>
                                 <div className="flex items-center gap-2 text-slate-500">
                                    <Clock size={14} />
                                    <p className="text-xs font-medium">{new Date(expandedHistoryJob.timestamp || expandedHistoryJob.createdAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</p>
                                 </div>
                              </div>
                              <div className="flex items-start md:items-center gap-3">
                                 {expandedHistoryJob.results && (
                                   <button onClick={() => handleExportHistoryCSV(expandedHistoryJob)} className="px-6 h-12 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-2xl flex items-center gap-3 text-xs font-bold transition-all shadow-lg active:scale-95 group">
                                      <DownloadSimple size={20} weight="bold" className="group-hover:translate-y-0.5 transition-transform" />
                                      Export Dataset
                                   </button>
                                 )}
                              </div>
                           </div>

                           <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-8 border-t border-white/5">
                              <div className="p-5 rounded-2xl bg-white/[0.01] border border-border-dim text-center hover:bg-white/[0.03] transition-colors">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Total Packets</p>
                                 <p className="text-2xl font-bold text-white tracking-tight">{expandedHistoryJob.totalContacts || expandedHistoryJob.total || 0}</p>
                              </div>
                              <div className="p-5 rounded-2xl bg-white/[0.01] border border-border-dim text-center hover:bg-white/[0.03] transition-colors">
                                 <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] mb-2">Successful</p>
                                 <p className="text-2xl font-bold text-emerald-500 tracking-tight">{expandedHistoryJob.sent || expandedHistoryJob.results?.filter(r => r.status?.includes('Sent')).length || 0}</p>
                              </div>
                              <div className="p-5 rounded-2xl bg-white/[0.01] border border-border-dim text-center hover:bg-white/[0.03] transition-colors">
                                 <p className="text-[10px] font-bold text-red-500 uppercase tracking-[0.2em] mb-2">Failed Delivery</p>
                                 <p className="text-2xl font-bold text-red-500 tracking-tight">{expandedHistoryJob.failed || expandedHistoryJob.results?.filter(r => r.status?.includes('Failed')).length || 0}</p>
                              </div>
                              <div className="p-5 rounded-2xl bg-white/[0.01] border border-border-dim text-center hover:bg-white/[0.03] transition-colors">
                                 <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Delivery Status</p>
                                 <p className="text-2xl font-bold text-white tracking-tight capitalize">{expandedHistoryJob.status || 'Completed'}</p>
                              </div>
                           </div>
                        </div>

                        {/* Contacts Data Table/List */}
                        <div className="simple-card space-y-6 !bg-transparent border-none p-0">
                           <div className="flex items-center justify-between px-2">
                              <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">Detailed Delivery Logs</h5>
                              <p className="text-[10px] font-medium text-slate-600">Total {expandedHistoryJob.results?.length || 0} records indexed</p>
                           </div>
                           
                           {expandedHistoryJob.results ? (
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                                {expandedHistoryJob.results.map((res, i) => (
                                  <div key={i} onClick={() => setSelectedResult(res)} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.01] hover:bg-white/[0.03] border border-border-dim/50 cursor-pointer transition-all group hover:scale-[1.01] overflow-hidden">
                                     <div className="flex items-center gap-4 flex-1 min-w-0">
                                        <div className={cn(
                                          "w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] shrink-0 group-hover:scale-110 transition-transform",
                                          res.status?.includes('Sent') ? "bg-emerald-500" : res.status?.includes('Skip') ? "bg-amber-500" : "bg-red-500"
                                        )} />
                                        <div className="min-w-0 flex-1">
                                           <div className="flex items-baseline gap-2">
                                              <p className="text-[14px] font-bold text-white tracking-tight">{res.phone}</p>
                                              <span className={cn(
                                                 "text-[9px] font-black uppercase tracking-widest truncate max-w-[120px] md:max-w-[180px]",
                                                 res.status?.includes('Sent') ? "text-emerald-500/70" : "text-red-500/70"
                                               )} title={res.status}>
                                                 {res.status}
                                              </span>
                                           </div>
                                           <p className="text-[11px] text-slate-500 truncate">{res.name || 'Anonymous Contact'}</p>
                                        </div>
                                     </div>
                                     <div className="flex items-center gap-3 shrink-0 ml-4">
                                        <div className="p-2 bg-white/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                           <Eye size={16} className="text-emerald-500" />
                                        </div>
                                     </div>
                                  </div>
                                ))}
                             </div>
                           ) : (
                             <div className="simple-card text-center py-20 opacity-20 border-dashed">
                                <Database size={40} className="mx-auto mb-4" />
                                <p className="text-xs font-bold uppercase tracking-widest">Metadata payload truncated</p>
                                 <p className="text-[10px] text-slate-700 mt-2">Full delivery details available in backend logs</p>
                              </div>
                           )}
                        </div>
                     </div>
                   ) : (
                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
                        {filteredHistory.map(job => {
                           const sent = job.sent || job.results?.filter(r => r.status?.includes('Sent')).length || 0;
                           const failed = job.failed || job.results?.filter(r => r.status?.includes('Failed')).length || 0;
                           const total = job.totalContacts || job.total || 0;
                           const rate = total > 0 ? (sent / total * 100).toFixed(0) : 0;
                           const isRunning = job.status === 'Running';
                           const status = job.status || 'Completed';

                           return (
                              <div key={job.id || job._id} onClick={() => handleExpandHistory(job)} className="p-5 rounded-2xl bg-bg-surface border border-border-dim/50 hover:bg-white/[0.02] hover:border-emerald-500/20 transition-all flex flex-col h-full group relative overflow-hidden">
                                 {isRunning && (
                                   <div className="absolute top-0 right-0 p-3">
                                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                                         <div className="w-1 h-1 rounded-full bg-emerald-500 animate-ping" />
                                         <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Active</span>
                                      </div>
                                   </div>
                                 )}
                                 <div className="flex justify-between items-start mb-3">
                                    <div className={cn(
                                       "w-10 h-10 rounded-xl flex items-center justify-center border transition-all",
                                       isRunning ? "bg-emerald-500 text-black border-emerald-400" : "bg-white/5 text-slate-500 border-white/5 group-hover:border-emerald-500/10 group-hover:text-emerald-500"
                                    )}>
                                       <PaperPlaneTilt size={18} weight={isRunning ? "fill" : "bold"} />
                                    </div>
                                    <div className="text-right">
                                       <div className={cn(
                                          "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest inline-block border leading-normal",
                                          status === 'Completed' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                          status === 'Running' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                                          "bg-red-500/10 text-red-500 border-red-500/20"
                                       )}>{status}</div>
                                       <p className="text-[9px] font-bold text-slate-600 mt-1 uppercase tracking-tighter">#{String(job.id || job._id || '').slice(-6)}</p>
                                    </div>
                                 </div>
                                 <div className="mb-4">
                                    <h4 className="text-[14px] font-bold text-white mb-0.5 truncate tracking-tight">{job.name || job.templateName || 'Campaign'}</h4>
                                    <p className="text-[10px] text-slate-500">{new Date(job.timestamp || job.createdAt || Date.now()).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'})}</p>
                                 </div>
                                 <div className="mt-auto space-y-4">
                                    <div className="grid grid-cols-3 gap-2 px-1">
                                     <div className="text-center"><p className="text-[8px] font-bold text-slate-500 uppercase mb-0.5">Sent</p><p className="text-xs font-bold text-emerald-500">{sent}</p></div>
                                     <div className="text-center"><p className="text-[8px] font-bold text-slate-500 uppercase mb-0.5">Failed</p><p className="text-xs font-bold text-red-500">{failed}</p></div>
                                     <div className="text-center"><p className="text-[8px] font-bold text-slate-500 uppercase mb-0.5">Total</p><p className="text-xs font-bold text-white">{total}</p></div>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 pt-2">
                                       <div className="flex-1 space-y-1.5">
                                          <div className="h-1 bg-white/5 rounded-full overflow-hidden flex">
                                             <div className="h-full bg-emerald-500" style={{ width: `${rate}%` }} />
                                             <div className="h-full bg-red-500/50" style={{ width: `${total > 0 ? (failed / total * 100) : 0}%` }} />
                                          </div>
                                       </div>
                                       <div className="flex items-center gap-3 shrink-0">
                                          <span className="text-[10px] font-black text-emerald-500">{rate}%</span>
                                          <button onClick={(e) => { e.stopPropagation(); handleExportHistoryCSV(job); }} className="p-1.5 bg-white/5 border border-border-dim rounded-lg text-slate-500 hover:text-emerald-500 transition-all"><DownloadSimple size={14} /></button>
                                       </div>
                                    </div>
                                 </div>
                              </div>
                           );
                        })}

                        {filteredHistory.length === 0 && (
                          <div className="col-span-full py-32 text-center animate-in zoom-in duration-300">
                             <div className="w-20 h-20 bg-white/[0.02] border border-dashed border-border-dim rounded-full flex items-center justify-center mx-auto mb-6">
                                <Clock size={40} className="text-slate-800" />
                             </div>
                             <h4 className="text-sm font-bold text-slate-600 uppercase tracking-[0.4em] mb-2">No Matching Records</h4>
                             <p className="text-[10px] text-slate-700 max-w-xs mx-auto">Try adjusting your search query or filters to find specific campaigns.</p>
                          </div>
                        )}
                     </div>
                   )}
                </motion.div>
              )}

              {/* ═══ INBOX TAB ═══ */}
              {activeTab === 'inbox' && (
                <motion.div key="inbox" {...PAGE_TRANSITION} className="h-[calc(100vh-12rem)] flex gap-0 bg-bg-surface border border-border-dim rounded-2xl overflow-hidden relative">
                   {/* LEFT SIDEBAR: CONVERSATIONS */}
                   <div className={cn(
                      "w-full lg:w-[350px] flex flex-col border-r border-border-dim bg-bg-base shrink-0 transition-all duration-300",
                      activeChatPhone ? "hidden lg:flex" : "flex"
                   )}>
                      {/* Sidebar Header */}
                      <div className="h-[70px] px-4 flex items-center justify-between border-b border-border-dim bg-white/[0.02]">
                         <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 overflow-hidden border border-white/5 shadow-inner">
                            <User size={22} weight="fill" />
                         </div>
                         <div className="flex items-center gap-0.5">
                            <button className="p-2.5 text-slate-500 hover:text-emerald-500 hover:bg-white/5 rounded-full transition-all"><CircleDashed size={20} /></button>
                            <button className="p-2.5 text-slate-500 hover:text-emerald-500 hover:bg-white/5 rounded-full transition-all"><ChatCenteredDots size={20} /></button>
                            <button className="p-2.5 text-slate-500 hover:text-emerald-500 hover:bg-white/5 rounded-full transition-all"><DotsThreeVertical size={20} weight="bold" /></button>
                         </div>
                      </div>

                      {/* Search Bar */}
                      <div className="px-4 py-2.5 border-b border-border-dim">
                         <div className="relative group">
                            <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-emerald-500 transition-colors" />
                            <input placeholder="Search or start new chat" className="w-full bg-white/[0.04] border border-transparent rounded-xl pl-11 pr-4 py-2 text-[13px] font-medium text-white outline-none placeholder:text-slate-600 focus:bg-white/[0.06] focus:border-border-dim transition-all h-9" />
                         </div>
                      </div>

                      {/* Chat List */}
                      <div className="flex-1 overflow-y-auto custom-scrollbar">
                         {sortedChats.length > 0 ? sortedChats.map(chat => (
                            <button 
                               key={chat.phone} 
                               onClick={async () => { 
                                  setActiveChatPhone(chat.phone); 
                                  setActiveChatHistory([]);
                                  try { fetchWithAuth(`${API_BASE}/api/chats/${chat.phone}/read`, { method: 'POST' }); } catch(e){}
                                  setChats(prev => prev.map(c => c.phone === chat.phone ? { ...c, unreadCount: 0 } : c));
                               }}
                               className={cn(
                                  "w-full flex items-center gap-4 px-4 py-3 border-b border-border-dim/30 transition-all relative group text-left",
                                  activeChatPhone === chat.phone ? "bg-white/[0.07] shadow-sm" : "hover:bg-white/[0.03]"
                               )}
                            >
                               <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex-shrink-0 flex items-center justify-center text-emerald-500 border border-emerald-500/10 font-bold overflow-hidden shadow-inner uppercase text-lg">
                                  {(chat.name || chat.phone).charAt(0)}
                               </div>
                               <div className="flex-1 min-w-0 py-1">
                                  <div className="flex justify-between items-baseline mb-0.5">
                                     <span className="text-[15.5px] font-semibold text-[#e9edef] truncate tracking-tight">{chat.name || chat.phone}</span>
                                     {(chat.lastMessageAt || chat.updatedAt) && <span className={cn("text-[11px] font-bold uppercase tracking-wider", chat.unreadCount > 0 ? "text-emerald-500" : "text-slate-600")}>{new Date(chat.lastMessageAt || chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                                  </div>
                                  <div className="flex items-center justify-between">
                                     <p className="text-[13.5px] text-slate-500 truncate flex-1 pr-4 leading-snug">
                                        {chat.messages?.[chat.messages.length - 1]?.from === 'me' && <Check size={14} className="inline mr-1.5 text-sky-400" />}
                                        {chat.messages?.[chat.messages.length - 1]?.text || 'No messages'}
                                     </p>
                                     {chat.unreadCount > 0 && <span className="bg-emerald-500 text-black text-[9px] font-black px-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full shadow-lg shadow-emerald-500/20">{chat.unreadCount}</span>}
                                  </div>
                               </div>
                            </button>
                         )) : (
                             <div class="p-8 text-center opacity-40"><ChatTeardropDots size={40} className="mx-auto mb-3 text-slate-700" weight="fill" /><p className="text-[13px] text-slate-500">No conversations found</p></div>
                         )}
                      </div>
                   </div>

                   {/* RIGHT SIDE: CHAT WINDOW */}
                   <div className={cn(
                      "flex-1 flex flex-col bg-wa-chat-bg relative min-w-0 transition-all duration-300",
                      !activeChatPhone ? "hidden lg:flex" : "flex"
                   )}>
                      {activeChatPhone ? (
                        <>
                           {/* Chat Header */}
                           <div className="h-16 px-4 flex items-center justify-between border-b border-border-dim bg-white/[0.02] z-10">
                              <div className="flex items-center gap-3">
                                 <button onClick={() => setActiveChatPhone(null)} className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-white transition-all shrink-0"><ArrowLeft size={20} weight="bold" /></button>
                                 <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/10 font-bold overflow-hidden cursor-pointer shrink-0">
                                    {(chats.find(c => c.phone === activeChatPhone)?.name || 'C').charAt(0).toUpperCase()}
                                 </div>
                                 <div className="min-w-0 cursor-pointer flex flex-col justify-center">
                                    <h3 className="text-[15px] font-medium text-[#e9edef] truncate h-5 leading-none mt-1">{chats.find(c => c.phone === activeChatPhone)?.name || 'Customer'}</h3>
                                    <p className="text-[12px] text-slate-500 font-medium h-4 leading-none mb-1">online</p>
                                 </div>
                              </div>
                              <div className="flex items-center gap-2 text-slate-500">
                                 <button className="p-2 hover:bg-white/5 rounded-full transition-all"><MagnifyingGlass size={20} /></button>
                                 <button className="p-2 hover:bg-white/5 rounded-full transition-all"><DotsThreeVertical size={20} weight="bold" /></button>
                              </div>
                           </div>

                           {/* Message Area */}
                           <div className="flex-1 overflow-y-auto p-4 lg:p-6 lg:px-16 space-y-2 custom-scrollbar flex flex-col relative inbox-scroll-container">
                              <div className="wa-doodle" />
                              {activeChatHistory.map((msg, i) => {
                                 const isMe = msg.from === 'me' || msg.from === 'bot';
                                 
                                 // Date grouping logic
                                 const msgDate = new Date(parseInt(msg.timestamp || Date.now()));
                                 const prevMsg = activeChatHistory[i-1];
                                 const prevDate = prevMsg ? new Date(parseInt(prevMsg.timestamp || Date.now())) : null;
                                 const showDate = !prevDate || msgDate.toDateString() !== prevDate.toDateString();
                                 
                                 let dateLabel = msgDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
                                 if (msgDate.toDateString() === new Date().toDateString()) dateLabel = 'Today';
                                 else if (msgDate.toDateString() === new Date(Date.now() - 86400000).toDateString()) dateLabel = 'Yesterday';

                                 return (
                                    <React.Fragment key={i}>
                                       {showDate && <div className="date-separator relative z-10">{dateLabel}</div>}
                                       <div className={cn("flex flex-col relative z-10 mb-1", isMe ? "items-end" : "items-start")}>
                                          <div className={cn(
                                            "chat-bubble shadow-sm", 
                                            isMe ? "chat-bubble-outgoing" : "chat-bubble-incoming"
                                          )}>
                                             {/* MEDIA CONTENT */}
                                             {['image', 'video', 'document'].includes(msg.type) && (
                                                <div className={cn(
                                                   "mb-2 -mx-1 -mt-1 rounded-lg overflow-hidden bg-black/10 transition-all group/media",
                                                   msg.type === 'document' ? "p-3 bg-white/5 border border-white/5 border-b-border-dim/20" : ""
                                                )}>
                                                   {msg.type === 'image' && (msg.mediaId || msg.mediaUrl) ? (
                                                      <div className="relative">
                                                         <img 
                                                            src={msg.mediaId ? `${API_BASE}/api/media/${msg.mediaId}?token=${encodeURIComponent(token)}` : msg.mediaUrl} 
                                                            alt="msg" 
                                                            className="max-w-full h-auto object-cover max-h-64 cursor-pointer hover:opacity-90 transition-opacity"
                                                            onClick={() => window.open(msg.mediaId ? `${API_BASE}/api/media/${msg.mediaId}?token=${encodeURIComponent(token)}` : msg.mediaUrl, '_blank')}
                                                         />
                                                         <a 
                                                            href={msg.mediaId ? `${API_BASE}/api/media/${msg.mediaId}?token=${encodeURIComponent(token)}` : msg.mediaUrl} 
                                                            download={`image_${msg.id}.jpg`}
                                                            className="absolute bottom-2 right-2 p-2 bg-black/60 backdrop-blur-md border border-white/10 text-white rounded-lg opacity-0 group-hover/media:opacity-100 transition-all hover:bg-emerald-500 hover:text-black"
                                                         >
                                                            <DownloadSimple size={16} weight="bold" />
                                                         </a>
                                                      </div>
                                                   ) : msg.type === 'video' && msg.mediaId ? (
                                                      <video controls className="max-w-full h-auto bg-black rounded-lg">
                                                         <source src={`${API_BASE}/api/media/${msg.mediaId}?token=${encodeURIComponent(token)}`} type="video/mp4" />
                                                         Your browser does not support the video tag.
                                                      </video>
                                                   ) : msg.type === 'document' && msg.mediaId ? (
                                                      <div className="flex items-center justify-between gap-4 py-1">
                                                         <div className="flex items-center gap-3 overflow-hidden">
                                                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0 border border-emerald-500/10">
                                                               <FileText size={20} weight="fill" />
                                                            </div>
                                                            <div className="min-w-0">
                                                               <p className="text-xs font-bold text-white truncate pr-2" title={msg.filename}>{msg.filename || 'Document'}</p>
                                                               <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-0.5">Ready to download</p>
                                                            </div>
                                                         </div>
                                                         <a 
                                                            href={`${API_BASE}/api/media/${msg.mediaId}?token=${encodeURIComponent(token)}`} 
                                                            download={msg.filename || 'document'} 
                                                            className="p-2.5 bg-emerald-500 text-black rounded-xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                                                         >
                                                            <DownloadSimple size={18} weight="bold" />
                                                         </a>
                                                      </div>
                                                   ) : (
                                                      <div className="p-4 flex items-center gap-2 text-[10px] font-bold opacity-50 uppercase">
                                                         {msg.type === 'image' ? <ImageSquare size={16} /> : msg.type === 'video' ? <Video size={16} /> : <FileText size={16} />}
                                                         {msg.type} Received
                                                      </div>
                                                   )}
                                                </div>
                                             )}
                                             
                                             {/* TEXT CONTENT */}
                                             <div className="text-[14px] leading-[19px] whitespace-pre-wrap break-words">
                                                {(msg.type === 'text' || !msg.type) && msg.text}
                                                {msg.type !== 'text' && msg.type && msg.text && msg.text !== msg.filename && (
                                                   <div className="mt-2 pt-2 border-t border-black/5 opacity-80">{msg.text}</div>
                                                )}
                                                
                                                <div className="chat-meta">
                                                   <span className="chat-time">{msg.timestamp ? new Date(parseInt(msg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                                   {isMe && <Check size={16} weight="fill" className="text-sky-400" />}
                                                </div>
                                             </div>
                                          </div>
                                       </div>
                                    </React.Fragment>
                                 );
                              })}
                              <div ref={messagesEndRef} />
                           </div>

                           {/* Input Area */}
                           <form onSubmit={handleSendReply} className="px-4 py-2 bg-white/[0.04] border-t border-border-dim flex items-center gap-2 relative z-20">
                              <button type="button" className="p-2 text-slate-500 hover:text-wa-text transition-all"><Smiley size={24} /></button>
                              <button type="button" onClick={() => setShowAttachmentMenu(!showAttachmentMenu)} className={cn("p-2 transition-all", showAttachmentMenu ? "text-emerald-500" : "text-slate-500 hover:text-wa-text")}>
                                 <Paperclip size={24} />
                              </button>
                              
                              <AnimatePresence>
                                 {showAttachmentMenu && (
                                    <motion.div 
                                      initial={{ opacity: 0, scale: 0.95, y: 5 }}
                                      animate={{ opacity: 1, scale: 1, y: 0 }}
                                      exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                      className="absolute bottom-full left-4 mb-4 bg-[#233138] border border-border-dim rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 z-50 min-w-[200px]"
                                    >
                                       <button type="button" onClick={() => document.getElementById('inbox-img').click()} className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-[#d1d7db] transition-all text-[14px] font-medium">
                                          <div className="w-8 h-8 rounded-full bg-[#bf59cf] flex items-center justify-center text-white"><ImageSquare size={18} weight="fill" /></div>
                                           Photos & Videos
                                        </button>
                                       <button type="button" onClick={() => document.getElementById('inbox-doc').click()} className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-[#d1d7db] transition-all text-[14px] font-medium">
                                          <div className="w-8 h-8 rounded-full bg-[#7f66ff] flex items-center justify-center text-white"><FileText size={18} weight="fill" /></div>
                                          Document
                                       </button>
                                       <input id="inbox-img" type="file" className="hidden" accept="image/*,video/*" onChange={(e) => handleSelectAttachment(e.target.files[0], 'image')} />
                                       <input id="inbox-doc" type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => handleSelectAttachment(e.target.files[0], 'document')} />
                                    </motion.div>
                                 )}
                              </AnimatePresence>

                              <textarea 
                                 value={replyText} 
                                 onChange={e => { setReplyText(e.target.value); if(showAttachmentMenu) setShowAttachmentMenu(false); }} 
                                 placeholder="Type a message" 
                                 className="flex-1 bg-[#2a3942] border-none rounded-lg p-2.5 px-4 text-[15px] font-medium text-white outline-none placeholder:text-slate-500 resize-none min-h-[42px] max-h-32 transition-all" 
                                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendReply(e); } }} 
                               />

                              <button type="submit" disabled={isSendingReply || (!replyText.trim() && !pendingAttachment)} className="p-2 text-slate-500 hover:text-emerald-500 disabled:opacity-30 transition-colors">
                                 {isSendingReply ? <ArrowsClockwise size={24} className="animate-spin" /> : <PaperPlaneTilt size={24} weight="fill" />}
                              </button>
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
                 <motion.div key="settings" {...PAGE_TRANSITION} className="max-w-3xl mx-auto py-8 lg:py-12 space-y-8">
                    
                    {/* 1. META API CONFIGURATION */}
                    <div className="simple-card p-6 lg:p-10 space-y-8">
                       <div className="flex items-center justify-between border-b border-white/5 pb-6">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/10">
                                <Gear size={22} weight="bold" />
                             </div>
                             <div>
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Meta API Configuration</h3>
                                <p className="text-[10px] text-slate-500 font-medium">Configure your Business API credentials</p>
                             </div>
                          </div>
                          <button type="button" onClick={() => setRevealCredentials(!revealCredentials)} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-widest", revealCredentials ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-white/5 text-slate-400 border-border-dim hover:text-white")}>
                             {revealCredentials ? <><EyeSlash size={14} weight="bold" /> Mask</> : <><Eye size={14} weight="bold" /> Reveal</>}
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
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                             <SimpleInput isSensitive={!revealCredentials} label="Phone Number ID" value={config.PHONE_NUMBER_ID} onChange={v => setConfig({...config, PHONE_NUMBER_ID: v})} placeholder="From Meta Business Portal" />
                             <SimpleInput isSensitive={!revealCredentials} label="WABA ID" value={config.WABA_ID} onChange={v => setConfig({...config, WABA_ID: v})} placeholder="From Meta Business Portal" />
                          </div>
                          <div className="space-y-2 relative group">
                             <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Access Token</label>
                             <textarea value={config.ACCESS_TOKEN} onChange={e => setConfig({...config, ACCESS_TOKEN: e.target.value})} className={cn("w-full h-28 lg:h-32 bg-bg-surface border border-border-dim rounded-xl p-4 text-xs font-mono outline-none focus:border-emerald-500/30 resize-none transition-all", !revealCredentials ? "text-transparent select-none filter blur-[2px]" : "text-white")} placeholder="Paste your Meta Graph API access token..." />
                             {!revealCredentials && config.ACCESS_TOKEN && (<div className="absolute inset-0 top-6 flex items-center justify-center pointer-events-none"><span className="text-[10px] font-bold text-slate-700 uppercase tracking-[0.5em] tracking-widest px-4 py-2 border border-dashed border-slate-800 rounded-lg">CREDENTIALS MASKED</span></div>)}
                          </div>
                          <button type="submit" disabled={isLoading.config} className="simple-btn btn-primary w-full h-12 lg:h-14 flex items-center justify-center gap-2">
                             {isLoading.config ? 'Saving...' : <><CheckCircle weight="bold" size={18} /> Save Settings</>}
                          </button>
                       </form>
                    </div>

                    {/* 2. AUTOMATION & EMAIL ALERTS */}
                    <div className="simple-card p-6 lg:p-10 space-y-8">
                       <div className="flex items-center justify-between border-b border-white/5 pb-6">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/10">
                                <Envelope size={22} weight="bold" />
                             </div>
                             <div>
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Notification Alerts</h3>
                                <p className="text-[10px] text-slate-500 font-medium">SMTP settings for email campaign updates</p>
                             </div>
                          </div>
                          <button 
                             onClick={() => setEmailConfig({...emailConfig, enabled: !emailConfig.enabled})}
                             className={cn(
                               "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-[10px] font-bold uppercase tracking-widest",
                               emailConfig.enabled ? "bg-emerald-500 text-black border-emerald-500 shadow-lg shadow-emerald-500/10" : "bg-white/5 text-slate-500 border-border-dim"
                             )}
                          >
                             {emailConfig.enabled ? 'Service Active' : 'Enable SMTP'}
                          </button>
                       </div>

                       {emailConfig.enabled && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 lg:space-y-8 pt-4">
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <SimpleInput label="SMTP Host" value={emailConfig.smtpHost} onChange={v => setEmailConfig({...emailConfig, smtpHost: v})} placeholder="smtp.gmail.com" />
                                <SimpleInput label="SMTP Port" value={String(emailConfig.smtpPort)} onChange={v => setEmailConfig({...emailConfig, smtpPort: parseInt(v) || 0})} placeholder="587" />
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <SimpleInput label="SMTP Username" value={emailConfig.smtpUser} onChange={v => setEmailConfig({...emailConfig, smtpUser: v})} placeholder="your-email@gmail.com" />
                                <SimpleInput isSensitive label="SMTP Password" value={emailConfig.smtpPass} onChange={v => setEmailConfig({...emailConfig, smtpPass: v})} placeholder="App Password" />
                             </div>
                             <SimpleInput label="Global Recipient Email" value={emailConfig.notifyEmail} onChange={v => setEmailConfig({...emailConfig, notifyEmail: v})} placeholder="alerts@yourcompany.com" />
                             
                             <div className="flex flex-col sm:flex-row gap-4 pt-4">
                                <button onClick={handleSaveEmailSettings} disabled={isSavingEmail} className="flex-1 simple-btn btn-primary h-12 flex items-center justify-center gap-2">
                                   {isSavingEmail ? 'Saving...' : <><CheckCircle weight="bold" size={16} /> Save Alerts</>}
                                </button>
                                <button onClick={handleTestEmail} disabled={isTestingEmail || !emailConfig.smtpHost} className="flex-1 simple-btn bg-white/5 border border-border-dim text-white hover:bg-white/10 h-12 flex items-center justify-center gap-2 transition-all">
                                   {isTestingEmail ? 'Testing...' : <><PaperPlaneTilt size={16} weight="bold" /> Send Test Email</>}
                                </button>
                             </div>
                          </motion.div>
                       )}
                       {!emailConfig.enabled && (
                          <div className="py-12 text-center opacity-30 select-none">
                             <EnvelopeSimple size={48} className="mx-auto text-slate-800 mb-4" />
                             <p className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">SMTP Service Disabled</p>
                          </div>
                       )}
                    </div>

                    {/* 3. SECURITY & VERIFICATION */}
                    <div className="simple-card p-6 lg:p-10 space-y-8">
                       <div className="flex items-center justify-between border-b border-white/5 pb-6">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/10">
                                <ShieldCheck size={22} weight="bold" />
                             </div>
                             <div>
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest">Security & Verification</h3>
                                <p className="text-[10px] text-slate-500 font-medium">Meta verification and registration</p>
                             </div>
                          </div>
                       </div>
                       
                       <div className="bg-bg-base/30 p-6 rounded-2xl border border-border-dim space-y-6">
                          <div className="space-y-4">
                             <div className="space-y-2">
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Meta 6-Digit PIN</label>
                                <input type="text" maxLength={6} value={registrationPin} onChange={e => setRegistrationPin(e.target.value.replace(/\D/g, ''))} className="w-full bg-bg-surface border border-border-dim rounded-xl p-4 text-center text-2xl font-mono tracking-[0.5em] text-white outline-none focus:border-amber-500/30 transition-all font-bold placeholder:text-slate-800" placeholder="000000" />
                                <p className="text-[9px] text-slate-600 font-medium px-1">Required for Meta Cloud API phone registration.</p>
                             </div>
                             <button onClick={handleRegisterPhone} disabled={isRegistering || registrationPin.length !== 6} className="simple-btn bg-amber-500 hover:bg-amber-400 text-black w-full h-12 lg:h-14 font-bold flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 disabled:opacity-50 transition-all">
                                {isRegistering ? 'Processing...' : <><ShieldCheck size={18} weight="bold" /> Complete Registration</>}
                             </button>
                          </div>
                       </div>
                    </div>
                    
                    {/* 4. DANGER ZONE */}
                    <div className="p-6 lg:p-10 space-y-8 rounded-3xl border border-red-500/20 bg-red-500/[0.02]">
                       <div className="flex items-center justify-between border-b border-red-500/10 pb-6">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/10">
                                <Trash size={22} weight="bold" />
                             </div>
                             <div>
                                <h3 className="text-sm font-bold text-red-500 uppercase tracking-widest">Danger Zone</h3>
                                <p className="text-[10px] text-slate-500 font-medium">Irreversible account actions</p>
                             </div>
                          </div>
                       </div>
                       
                       <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                          <div className="space-y-1 text-left">
                             <h4 className="text-sm font-bold text-white">Delete Account & Data</h4>
                             <p className="text-xs text-slate-500 max-w-md">Permanently wipe all campaigns, chats, configuration, and delete your account credentials from our database.</p>
                          </div>
                          <button 
                             onClick={() => setIsDeleteAccountModalOpen(true)}
                             className="px-6 h-12 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 transition-all font-bold text-xs uppercase tracking-widest flex items-center gap-2 shrink-0"
                          >
                             <Trash size={18} weight="bold" /> Delete Everything
                          </button>
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
    <button 
      onClick={onClick} 
      className={cn(
        "w-full sidebar-item group relative transition-all duration-200", 
        active 
          ? "bg-emerald-500/10 text-emerald-500 border-l-2 border-emerald-500 !rounded-l-none" 
          : "text-slate-500 hover:text-white hover:bg-white/[0.03]"
      )}
    >
      <Icon 
        size={18} 
        weight={active ? "fill" : "bold"} 
        className={cn("transition-transform group-hover:scale-105", active ? "text-emerald-500" : "text-slate-600 group-hover:text-emerald-500")} 
      />
      <span className="font-bold flex-1 text-left">{label}</span>
      {badge && (
        <span className={cn(
          "px-1.5 py-0.5 rounded-full text-[9px] font-black min-w-[18px] text-center",
          active ? "bg-emerald-500/20 text-emerald-500" : "bg-white/10 text-slate-400"
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}

function MetricCard({ label, value, icon: Icon, color = "text-white" }) {
  return (
    <div className="simple-card card-hover flex flex-col justify-between h-28 lg:h-36 relative overflow-hidden group">
       <div className="absolute top-0 right-0 p-4 lg:p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
          <Icon size={64} weight="fill" />
       </div>
       <div className="flex justify-between items-start relative z-10">
          <div className="space-y-1">
             <p className="text-[9px] lg:text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">{label}</p>
             <h3 className={cn("text-2xl lg:text-3xl font-bold tracking-tight mt-1", color)}>{value}</h3>
          </div>
          <div className={cn("w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center", color)}>
            <Icon size={16} weight="bold" />
          </div>
       </div>
       <div className="mt-auto relative z-10 w-full h-1 bg-white/5 rounded-full overflow-hidden">
         <div className="h-full bg-emerald-500/10" style={{ width: '40%' }} />
       </div>
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
  const [show, setShow] = useState(false);
  const type = isSensitive ? (show ? 'text' : 'password') : 'text';

  return (
    <div className="space-y-2 pointer-events-auto">
       <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{label}</label>
       <div className="relative">
         <input 
           type={type}
           value={value} 
           onChange={e => onChange(e.target.value)} 
           placeholder={placeholder} 
           className={cn(
             "w-full bg-bg-surface border border-border-dim rounded-xl p-3 lg:p-4 text-sm font-bold text-white outline-none focus:border-emerald-500/30 transition-all placeholder:text-slate-800 pr-12", 
             (isSensitive && !show) && "tracking-[0.5em] font-mono"
           )} 
         />
         {isSensitive && (
           <button 
             type="button" 
             onClick={() => setShow(!show)} 
             className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-emerald-500 transition-colors"
           >
             {show ? <EyeSlash size={18} /> : <Eye size={18} />}
           </button>
         )}
       </div>
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
