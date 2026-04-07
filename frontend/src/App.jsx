import React, { useState, useEffect } from 'react';

function App() {
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0); // Forces file input reset
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageType, setMessageType] = useState('template');
  const [customMessage, setCustomMessage] = useState('');
  const [csvData, setCsvData] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [status, setStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  
  const [activeTab, setActiveTab] = useState('compose');
  const [historyData, setHistoryData] = useState([]);
  
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);

  useEffect(() => {
    fetch('/api/templates')
      .then(res => res.json())
      .then(data => {
        setTemplates(data);
        if (data.length > 0) setSelectedTemplate(data[0].name);
      })
      .catch(err => console.error("Could not fetch templates", err));
  }, []);

  // Fetch active job on mount
  useEffect(() => {
    fetch('/api/active-job')
      .then(res => res.json())
      .then(data => {
        if (data.jobId) {
          setJobId(data.jobId);
          setJobStatus(data.status);
          setStatus('Campaign recovered from background!');
          setActiveTab('active');
        }
      })
      .catch(err => console.error("Could not fetch active job", err));
  }, []);

  // Poll status endpoint while jobId exists
  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) throw new Error('Network error');
        const data = await res.json();
        
        if (data.error) {
          clearInterval(interval);
          setStatus('Job expired or not found.');
          setJobId(null);
          return;
        }
        setJobStatus(data);
        if (data.status === 'Completed' || data.status === 'Stopped') {
          clearInterval(interval);
          setStatus(`Campaign ${data.status}!`);
        }
      } catch (err) {
        console.error("Polling error", err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [jobId]);

  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setStatus('Uploading and parsing CSV...');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      setCsvHeaders(result.headers);
      setCsvData(result.data);
      setStatus(`Loaded ${result.data.length} valid rows.`);
      
      const newMapping = {};
      result.headers.forEach(h => {
        if (h.toLowerCase().includes('phone')) newMapping['phone'] = h;
      });
      setMapping(newMapping);
      
    } catch (err) {
      console.error(err);
      setStatus('Failed to upload/parse CSV.');
    }
  };

  const handleMappingChange = (variable, header) => {
    setMapping(prev => ({ ...prev, [variable]: header }));
  };

  const handleSend = async () => {
    if (!mapping.phone) {
      alert("Please map the 'phone' field!");
      return;
    }
    
    setStatus('Sending messages...');
    setJobId(null);
    setJobStatus(null);

    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: csvData,
          templateName: selectedTemplate,
          mapping,
          messageType,
          customMessage,
          allowDuplicates
        }),
      });
      const data = await res.json();
      if (data.jobId) {
        setJobId(data.jobId);
        setStatus('Campaign started: processing backend queue.');
        setActiveTab('active');
      } else {
        setStatus(`Failed to get Job ID: ${data.error || 'Unknown Error'}`);
      }
    } catch (err) {
      console.error(err);
      setStatus('Failed to start sending. Ensure backend is running.');
    }
  };

  const handleExportCSV = () => {
    if (!jobStatus || !jobStatus.results.length) return;

    const headers = "Name,Phone,Status\n";
    const csvContent = headers + jobStatus.results.map(r => `"${r.name}","${r.phone}","${r.status.replace(/"/g, '""')}"`).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `campaign_results_${jobId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRestart = () => {
    setJobId(null);
    setJobStatus(null);
    setCsvData([]);
    setFile(null);
    setFileKey(prev => prev + 1);
    setStatus('');
    setMapping({});
    setMessageType('template');
    setCustomMessage('');
    setActiveTab('compose');
  };

  const handlePause = async () => {
    if (!jobId) return;
    try {
      await fetch(`/api/pause/${jobId}`, { method: 'POST' });
    } catch (err) {
      console.error("Pause error", err);
    }
  };

  const handleResume = async () => {
    if (!jobId) return;
    try {
      await fetch(`/api/resume/${jobId}`, { method: 'POST' });
    } catch (err) {
      console.error("Resume error", err);
    }
  };

  const handleStop = async () => {
    if (!jobId) return;
    try {
      await fetch(`/api/stop/${jobId}`, { method: 'POST' });
    } catch (err) {
      console.error("Stop error", err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      setHistoryData(data);
    } catch(err) {
      console.error(err);
    }
  };
  
  const handleExportHistoryCSV = (job) => {
    if (!job || !job.results || !job.results.length) return;
    const headers = "Name,Phone,Status\n";
    const csvContent = headers + job.results.map(r => `"${r.name}","${r.phone}","${r.status.replace(/"/g, '""')}"`).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `campaign_history_${job.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentTemplate = templates.find(t => t.name === selectedTemplate);

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans pb-24">
      <div className="max-w-4xl mx-auto bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-200">
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-6 text-white text-center">
          <h1 className="text-3xl font-bold mb-2">WhatsApp Bulk Sender</h1>
          <p className="text-emerald-100">Local Tool • No Auth • Meta API</p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          <button 
            className={`flex-1 py-4 font-semibold text-sm transition-colors ${activeTab === 'compose' ? 'border-b-2 border-emerald-500 text-emerald-600 bg-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            onClick={() => setActiveTab('compose')}
          >
            🚀 Compose Campaign
          </button>
          <button 
            className={`flex-1 py-4 font-semibold text-sm transition-colors ${activeTab === 'active' ? 'border-b-2 border-emerald-500 text-emerald-600 bg-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            onClick={() => setActiveTab('active')}
          >
            🏃 Active Campaign
          </button>
          <button 
            className={`flex-1 py-4 font-semibold text-sm transition-colors ${activeTab === 'history' ? 'border-b-2 border-emerald-500 text-emerald-600 bg-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            onClick={() => { setActiveTab('history'); fetchHistory(); }}
          >
            🕒 Campaign History
          </button>
        </div>

        <div className="p-8 space-y-8">
          {activeTab === 'compose' && (
            <div className="space-y-8">
          
          {/* Step 1: Upload */}
          <div className={`bg-gray-50 rounded-xl p-6 border ${csvData.length === 0 ? 'border-l-4 border-l-emerald-500' : 'border-gray-200'}`}>
            <h2 className="text-xl font-semibold mb-4 text-gray-800 flex items-center gap-2">
              <span className="bg-emerald-100 text-emerald-800 w-8 h-8 rounded-full flex items-center justify-center font-bold shadow-inner">1</span>
              Upload CSV Contacts
            </h2>
            <form onSubmit={handleFileUpload} className="flex gap-4 items-center flex-wrap">
              <input 
                key={fileKey}
                type="file" 
                accept=".csv"
                onChange={e => setFile(e.target.files[0])}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 transition-colors"
                required
              />
              <button 
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-6 rounded-md shadow-sm transition-all whitespace-nowrap disabled:opacity-50"
                disabled={csvData.length > 0 && !jobId}
              >
                {csvData.length > 0 ? 'Uploaded ✅' : 'Upload & Parse'}
              </button>
            </form>
            {status && !jobId && (
              <p className="mt-4 text-sm font-medium text-emerald-600 bg-emerald-50 inline-block px-3 py-1 rounded-md">{status}</p>
            )}
          </div>

          {/* Stepper Logic for Mapping */}
          {csvData.length > 0 && !jobId && (
            <div className="space-y-8 animate-fade-in-up">
              {/* Step 2: Message Type and Template Selection */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-200 border-l-4 border-l-emerald-500">
                <h2 className="text-xl font-semibold mb-4 text-gray-800 flex items-center gap-2">
                  <span className="bg-emerald-100 text-emerald-800 w-8 h-8 rounded-full flex items-center justify-center font-bold shadow-inner">2</span>
                  Compose Message
                </h2>

                <div className="flex gap-4 mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="template" checked={messageType === 'template'} onChange={() => setMessageType('template')} className="text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
                    <span className="font-medium text-gray-700">Pre-approved Template</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="text" checked={messageType === 'text'} onChange={() => setMessageType('text')} className="text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
                    <span className="font-medium text-gray-700">Custom Text Message</span>
                  </label>
                </div>

                {messageType === 'template' ? (
                  <select 
                    className="w-full border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm text-gray-700 bg-white"
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                  >
                    <option value="" disabled>-- Select a Template --</option>
                    {templates.map(t => (
                      <option key={t.name} value={t.name}>{t.name}</option>
                    ))}
                  </select>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Message Body (Use {'{{Column}}'} to insert CSV dynamic fields)</label>
                    <textarea 
                      className="w-full border border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm text-gray-700 bg-white h-32"
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      placeholder="Hi {{Name}}, your appointment is confirmed!"
                    ></textarea>
                  </div>
                )}

                {/* Allow Duplicates Toggle */}
                <div className="mt-6 flex items-center justify-between bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Allow Duplicate Messages</h3>
                    <p className="text-xs text-gray-500">If ON, the same template will be sent again to numbers that previously received it.</p>
                  </div>
                  <button 
                    type="button" 
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${allowDuplicates ? 'bg-emerald-500' : 'bg-gray-200'}`}
                    role="switch" 
                    tabIndex="0"
                    aria-checked={allowDuplicates}
                    onClick={() => setAllowDuplicates(!allowDuplicates)}
                  >
                    <span 
                      aria-hidden="true" 
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${allowDuplicates ? 'translate-x-5' : 'translate-x-0'}`}
                    ></span>
                  </button>
                </div>

              </div>

              {/* Step 3: Mapping */}
              {((messageType === 'template' && currentTemplate) || messageType === 'text') && (
                <div className="bg-gray-50 rounded-xl p-6 border border-gray-200 border-l-4 border-l-emerald-500">
                  <h2 className="text-xl font-semibold mb-4 text-gray-800 flex items-center gap-2">
                    <span className="bg-emerald-100 text-emerald-800 w-8 h-8 rounded-full flex items-center justify-center font-bold shadow-inner">3</span>
                    Field Mapping
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Optional Name Mapping */}
                    <div className="flex flex-col gap-2 p-4 bg-white rounded-lg border border-gray-100 shadow-sm">
                      <label className="text-sm font-bold text-gray-700">Name (Optional)</label>
                      <select 
                        className="border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={mapping['name'] || ''}
                        onChange={(e) => handleMappingChange('name', e.target.value)}
                      >
                        <option value="">-- Select CSV Column --</option>
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>

                    {/* Mandatory Phone Mapping */}
                    <div className="flex flex-col gap-2 p-4 bg-emerald-50/50 rounded-lg border border-emerald-100 shadow-sm">
                      <label className="text-sm font-bold text-emerald-800">Phone (Required for sending)</label>
                      <select 
                        className="border border-emerald-300 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-medium"
                        value={mapping['phone'] || ''}
                        onChange={(e) => handleMappingChange('phone', e.target.value)}
                      >
                        <option value="">-- Select CSV Column --</option>
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>

                    {/* Template Variables */}
                    {messageType === 'template' && currentTemplate && currentTemplate.variables && currentTemplate.variables.map(variable => (
                      <div key={variable} className="flex flex-col gap-2 p-4 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <label className="text-sm font-semibold text-gray-700 flex items-center justify-between">
                          <span>{`{{${variable}}}`}</span>
                          <span className="text-xs text-gray-400 font-normal">Template Variable</span>
                        </label>
                        <select 
                          className="border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                          value={mapping[variable] || ''}
                          onChange={(e) => handleMappingChange(variable, e.target.value)}
                        >
                          <option value="">-- Select CSV Column --</option>
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  {messageType === 'text' && (
                     <div className="mt-4 text-sm text-gray-500 bg-white p-3 rounded border border-gray-200">
                        <strong>Note:</strong> For custom text messages, any <code>{`{{Column Name}}`}</code> used in your message body will automatically be replaced with row data if it exactly matches a CSV column name!
                     </div>
                  )}
                </div>
              )}

              {/* Step 4: Send */}
              <div className="text-center pb-4">
                <button
                  onClick={handleSend}
                  disabled={!mapping.phone || (messageType === 'template' ? !selectedTemplate : !customMessage.trim())}
                  className={`px-12 py-4 rounded-xl font-bold text-lg text-white shadow-lg transform transition-all hover:scale-105 active:scale-95 ${
                    (!mapping.phone || (messageType === 'template' ? !selectedTemplate : !customMessage.trim()))
                    ? 'bg-gray-400 cursor-not-allowed shadow-none hover:scale-100' 
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-emerald-500/30'
                  }`}
                >
                  🚀 Start Sending Campaign
                </button>
              </div>
            </div>
          )}
          </div>
          )}

          {/* Result Output UI - CRM Style Dashboard */}
          {activeTab === 'active' && (
            <div className="animate-fade-in-up">
              {!jobId || !jobStatus ? (
                 <div className="text-center p-12 bg-gray-50 rounded-xl border border-gray-200">
                    <span className="text-4xl block mb-4">⏸️</span>
                    <p className="text-gray-500 font-medium">No campaign is currently running.</p>
                 </div>
              ) : (
                (() => {
                  const total = jobStatus.total || 0;
                  const sent = jobStatus.results.filter(r => r.status.includes('✅')).length;
                  const failed = jobStatus.results.filter(r => r.status.includes('❌')).length;
                  const skipped = jobStatus.results.filter(r => r.status.includes('⏭️')).length;

            const filteredResults = jobStatus.results.filter(r => 
              r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
              r.phone.includes(searchTerm)
            );

            return (
              <div className="bg-gray-50 rounded-xl p-8 border border-gray-200 shadow-inner animate-fade-in-up mt-8">
                <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-4">
                  <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-4">
                    <span>Campaign Output CRM</span>
                    {jobStatus.status === 'Completed' || jobStatus.status === 'Stopped' ? (
                      <span className="text-sm bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full font-semibold text-xs border border-emerald-200">{jobStatus.status.toUpperCase()}</span>
                    ) : (
                      <div className="flex gap-2">
                        {jobStatus.status === 'Running' && (
                          <button 
                            onClick={handlePause}
                            className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg font-bold border border-amber-200 hover:bg-amber-100 transition-all flex items-center gap-1.5 shadow-sm"
                          >
                            <span className="text-sm">⏸️</span> Pause Campaign
                          </button>
                        )}
                        {jobStatus.status === 'Paused' && (
                          <button 
                            onClick={handleResume}
                            className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg font-bold border border-emerald-200 hover:bg-emerald-100 transition-all flex items-center gap-1.5 shadow-sm"
                          >
                            <span className="text-sm">▶️</span> Resume Campaign
                          </button>
                        )}
                        <button 
                          onClick={handleStop}
                          className="text-xs bg-red-50 text-red-700 px-3 py-1.5 rounded-lg font-bold border border-red-200 hover:bg-red-100 transition-all flex items-center gap-1.5 shadow-sm"
                        >
                          <span className="text-sm">🛑</span> Stop
                        </button>
                      </div>
                    )}
                  </h2>
                  <div className="text-right flex items-center gap-4">
                     <div className="relative">
                        <input 
                          type="text" 
                          placeholder="Search name or phone..." 
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="border border-gray-300 rounded-lg px-4 py-2 text-sm shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                        />
                     </div>
                  </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="bg-white p-4 rounded-lg shadow border border-gray-200 text-center">
                    <p className="text-sm text-gray-500 font-semibold mb-1">Total Checked</p>
                    <p className="text-3xl font-bold text-blue-600">{jobStatus.processed} <span className="text-lg text-gray-400">/ {total}</span></p>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow border border-gray-200 text-center border-b-4 border-b-emerald-500">
                    <p className="text-sm text-gray-500 font-semibold mb-1">Deliveries</p>
                    <p className="text-3xl font-bold text-emerald-600">{sent}</p>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow border border-gray-200 text-center border-b-4 border-b-red-500">
                    <p className="text-sm text-gray-500 font-semibold mb-1">Failed</p>
                    <p className="text-3xl font-bold text-red-600">{failed}</p>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow border border-gray-200 text-center border-b-4 border-b-gray-400">
                    <p className="text-sm text-gray-500 font-semibold mb-1">Skipped (Dup)</p>
                    <p className="text-3xl font-bold text-gray-600">{skipped}</p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-3 mb-8 shadow-inner overflow-hidden relative border border-gray-300">
                  <div 
                    className={`bg-emerald-500 h-3 rounded-full transition-all duration-300 relative ${jobStatus.status === 'Running' ? 'animate-pulse' : ''}`}
                    style={{ width: `${(jobStatus.processed / (jobStatus.total || 1)) * 100}%` }}
                  >
                     {jobStatus.status === 'Running' && (
                       <div className="absolute top-0 left-0 bottom-0 right-0 overflow-hidden rounded-full">
                         <div className="w-full h-full bg-white opacity-20 transform -skew-x-12 animate-translate-x-loop"></div>
                       </div>
                     )}
                  </div>
                </div>

                {/* Status Table */}
                <div className="bg-white shadow ring-1 ring-black ring-opacity-5 rounded-lg mb-8 max-h-[400px] overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-300 relative">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact Name</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Phone Directory</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Queue Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {filteredResults.map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                          <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium text-gray-900">{r.name}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-sm text-gray-500 font-mono tracking-tight">{r.phone}</td>
                          <td className="px-3 py-3 text-sm">
                            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${
                              r.status.includes('✅') 
                                ? 'bg-green-50 text-green-700 ring-green-600/20' 
                                : r.status.includes('⏭️')
                                ? 'bg-gray-100 text-gray-600 ring-gray-500/20 font-semibold'
                                : 'bg-red-50 text-red-700 ring-red-600/10'
                            }`}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {filteredResults.length === 0 && jobStatus.results.length > 0 && (
                        <tr>
                          <td colSpan="3" className="text-center py-8 text-gray-500 italic">No matches for "{searchTerm}"</td>
                        </tr>
                      )}
                      {jobStatus.results.length === 0 && (
                        <tr>
                          <td colSpan="3" className="text-center py-8 text-gray-500 italic">Initializing safe API queue...</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

              {(jobStatus.status === 'Completed' || jobStatus.status === 'Stopped') && (
                <div className="flex gap-4 justify-center animate-bounce-short">
                  <button 
                    onClick={handleExportCSV} 
                    className="flex-1 max-w-xs text-white bg-blue-600 hover:bg-blue-700 font-bold px-6 py-3 rounded-lg shadow transition-colors block text-center"
                  >
                    📥 Download Results (CSV)
                  </button>
                  <button 
                    onClick={handleRestart} 
                    className="flex-1 max-w-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-bold px-6 py-3 border border-emerald-200 rounded-lg shadow-sm transition-colors block text-center"
                  >
                    🔄 Create New Campaign
                  </button>
                </div>
              )}
            </div>
          );
        })()
      )}
      </div>
    )}

    {activeTab === 'history' && (
            <div className="animate-fade-in-up">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">Past Campaigns</h2>
              {historyData.length === 0 ? (
                <div className="text-center p-12 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-4xl block mb-4">📭</span>
                  <p className="text-gray-500 font-medium">No campaigns found in history.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {historyData.map(job => {
                    const deliveredCount = job.results?.filter(r => r.status.includes('Sent'))?.length || 0;
                    const failedCount = job.results?.filter(r => r.status.includes('Failed'))?.length || 0;
                    const skippedCount = job.results?.filter(r => r.status.includes('Skipped'))?.length || 0;
                    const date = new Date(job.createdAt || parseInt(job.id)).toLocaleString();

                    return (
                      <div key={job.id} className="bg-white border text-left border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="text-lg font-bold text-gray-800">{job.templateName || 'Message'}</h3>
                            <p className="text-sm text-gray-500">{date}</p>
                          </div>
                          <button 
                            onClick={() => handleExportHistoryCSV(job)}
                            className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded font-medium flex items-center gap-2"
                          >
                            📥 Download CSV
                          </button>
                        </div>
                        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100">
                            <div className="text-center px-4">
                              <p className="text-xs text-gray-500 font-semibold">TOTAL</p>
                              <p className="text-lg font-bold text-gray-700 text-left">{job.total}</p>
                            </div>
                            <div className="text-center px-4 border-l border-gray-200">
                              <p className="text-xs text-emerald-600 font-semibold">DELIVERED</p>
                              <p className="text-lg font-bold text-emerald-600 text-left">{deliveredCount}</p>
                            </div>
                            <div className="text-center px-4 border-l border-gray-200">
                              <p className="text-xs text-red-500 font-semibold">FAILED</p>
                              <p className="text-lg font-bold text-red-500 text-left">{failedCount}</p>
                            </div>
                            <div className="text-center px-4 border-l border-gray-200">
                              <p className="text-xs text-gray-500 font-semibold">SKIPPED</p>
                              <p className="text-lg font-bold text-gray-600 text-left">{skippedCount}</p>
                            </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;
