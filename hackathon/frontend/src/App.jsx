import React, { useState, useEffect } from 'react';
import { 
  Search, Globe, Building, MapPin, Phone, Mail, 
  Code, Copy, Check, RotateCw, List, Grid, 
  Download, ExternalLink, Plus, AlertCircle, 
  CheckCircle2, HelpCircle, FileText, Activity
} from 'lucide-react';

const API_BASE = window.location.origin;

export default function App() {
  // Core state
  const [websiteName, setWebsiteName] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [enrichMode, setEnrichMode] = useState('single'); // 'single' | 'bulk'
  
  // Results states
  const [scrapedResults, setScrapedResults] = useState([]);
  const [activeResult, setActiveResult] = useState(null);
  const [isEnriching, setIsEnriching] = useState(false);
  const [status, setStatus] = useState({ type: null, message: '' });

  // Loading pipeline steps state
  const [loadingSteps, setLoadingSteps] = useState([
    { id: 'discover', label: 'Discovering pages...', icon: '🔍', status: 'idle' },
    { id: 'scrape', label: 'Scraping content...', icon: '📄', status: 'idle' },
    { id: 'extract', label: 'Extracting contacts...', icon: '📧', status: 'idle' },
    { id: 'results', label: 'Generating results...', icon: '🤖', status: 'idle' },
    { id: 'complete', label: 'Complete', icon: '✅', status: 'idle' }
  ]);
  
  // Tab within ResultCard
  const [activeCardTab, setActiveCardTab] = useState('profile'); // 'profile' | 'json'

  // Queue state for Bulk
  const [bulkQueue, setBulkQueue] = useState([]); // Array of { id, url, status: 'pending'|'active'|'done'|'failed', error: null }
  const [bulkLog, setBulkLog] = useState([]);

  // Toolbar states
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'cards'
  const [hasLoadedResults, setHasLoadedResults] = useState(false);
  
  // Modal state
  const [modalResult, setModalResult] = useState(null);
  const [modalTab, setModalTab] = useState('profile'); // 'profile' | 'json'

  // Copy-to-clipboard state
  const [copiedId, setCopiedId] = useState(null);

  // Load results from backend
  const loadResults = async (silent = false) => {
    if (!silent) {
      setStatus({ type: 'loading', message: 'Fetching company profiles...' });
    }
    try {
      const res = await fetch(`${API_BASE}/results`);
      if (!res.ok) throw new Error('Failed to load dataset');
      const data = await res.json();
      setScrapedResults(data);
      setHasLoadedResults(true);
      if (!silent) {
        setStatus({ type: 'success', message: `Loaded ${data.length} profiles successfully.` });
      }
    } catch (err) {
      console.error(err);
      if (!silent) {
        setStatus({ type: 'error', message: err.message || 'Failed to fetch results' });
      }
    }
  };

  // Perform a single enrichment
  const handleSingleEnrich = async (urlToEnrich, nameToEnrich) => {
    let cleanUrl = urlToEnrich.trim();
    if (!cleanUrl) {
      setStatus({ type: 'error', message: 'Please enter a company URL' });
      return;
    }

    setIsEnriching(true);
    setStatus({ type: 'loading', message: 'Processing started...' });
    
    // Set a loading placeholder card
    setActiveResult({
      website_name: nameToEnrich || 'Loading...',
      company_name: 'Getting data...',
      address: '',
      mobile_number: '',
      mail: [],
      core_service: 'Checking services...',
      target_customer: 'Checking target customers...',
      probable_pain_point: 'Checking pain points...',
      outreach_opener: 'Drafting message...',
      source_url: cleanUrl
    });

    const timers = [];
    const updateStepStatus = (id, newStatus) => {
      setLoadingSteps(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
    };

    setLoadingSteps([
      { id: 'discover', label: 'Discovering pages...', icon: '🔍', status: 'active' },
      { id: 'scrape', label: 'Scraping content...', icon: '📄', status: 'idle' },
      { id: 'extract', label: 'Extracting contacts...', icon: '📧', status: 'idle' },
      { id: 'results', label: 'Generating results...', icon: '🤖', status: 'idle' },
      { id: 'complete', label: 'Complete', icon: '✅', status: 'idle' }
    ]);

    // Transition to scrape after 1.5s
    timers.push(setTimeout(() => {
      updateStepStatus('discover', 'done');
      updateStepStatus('scrape', 'active');
    }, 1500));

    // Transition to extract after 3.5s
    timers.push(setTimeout(() => {
      updateStepStatus('scrape', 'done');
      updateStepStatus('extract', 'active');
    }, 3500));

    // Transition to generate results after 5.5s
    timers.push(setTimeout(() => {
      updateStepStatus('extract', 'done');
      updateStepStatus('results', 'active');
    }, 5500));

    try {
      const res = await fetch(`${API_BASE}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: cleanUrl, 
          website_name: nameToEnrich 
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to enrich profile');
      }

      const data = await res.json();
      
      // Ensure source_url is populated
      if (!data.source_url) {
        data.source_url = cleanUrl;
      }

      timers.forEach(clearTimeout);
      setLoadingSteps([
        { id: 'discover', label: 'Discovering pages...', icon: '🔍', status: 'done' },
        { id: 'scrape', label: 'Scraping content...', icon: '📄', status: 'done' },
        { id: 'extract', label: 'Extracting contacts...', icon: '📧', status: 'done' },
        { id: 'results', label: 'Generating results...', icon: '🤖', status: 'done' },
        { id: 'complete', label: 'Complete', icon: '✅', status: 'done' }
      ]);

      setActiveResult(data);
      setStatus({ 
        type: 'success', 
        message: `Successfully enriched: ${data.company_name || data.website_name || cleanUrl}` 
      });
      
      // Silent reload dataset to keep in sync
      loadResults(true);
    } catch (err) {
      console.error(err);
      timers.forEach(clearTimeout);
      setLoadingSteps(prev => prev.map(s => 
        s.status === 'active' || s.status === 'idle' 
          ? { ...s, status: 'failed' } 
          : s
      ));
      setStatus({ type: 'error', message: err.message });
      setActiveResult({
        website_name: nameToEnrich || 'Enrichment Failed',
        company_name: 'Analysis failed',
        source_url: cleanUrl,
        error: err.message
      });
    } finally {
      setIsEnriching(false);
    }
  };

  // Perform bulk URL list enrichment sequentially
  const handleBulkEnrich = async () => {
    const urls = urlInput
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0);

    if (urls.length === 0) {
      setStatus({ type: 'error', message: 'Please enter at least one URL in the list' });
      return;
    }

    setIsEnriching(true);
    setStatus({ type: 'loading', message: `Processing bulk queue of ${urls.length} website(s)...` });
    
    // Set up queue state
    const initialQueue = urls.map((url, index) => ({
      id: index,
      url,
      status: 'pending',
      error: null
    }));
    setBulkQueue(initialQueue);
    
    const updateStepStatus = (id, newStatus) => {
      setLoadingSteps(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
    };

    // Sequential async processing
    for (let i = 0; i < initialQueue.length; i++) {
      // Set active in queue
      setBulkQueue(prev => prev.map(q => q.id === i ? { ...q, status: 'active' } : q));
      setBulkLog(prev => [...prev, `[${i + 1}/${urls.length}] Scraping & analyzing ${urls[i]}...`]);
      
      // Load placeholder card
      setActiveResult({
        website_name: websiteName || 'Loading Bulk...',
        company_name: `Enriching (${i+1}/${urls.length})`,
        core_service: `Scraping: ${urls[i]}`,
        source_url: urls[i]
      });

      // Reset steps for this URL
      setLoadingSteps([
        { id: 'discover', label: 'Discovering pages...', icon: '🔍', status: 'active' },
        { id: 'scrape', label: 'Scraping content...', icon: '📄', status: 'idle' },
        { id: 'extract', label: 'Extracting contacts...', icon: '📧', status: 'idle' },
        { id: 'insights', label: 'Generating insights...', icon: '🤖', status: 'idle' },
        { id: 'complete', label: 'Complete', icon: '✅', status: 'idle' }
      ]);

      const localTimers = [];
      localTimers.push(setTimeout(() => {
        updateStepStatus('discover', 'done');
        updateStepStatus('scrape', 'active');
      }, 1000));

      localTimers.push(setTimeout(() => {
        updateStepStatus('scrape', 'done');
        updateStepStatus('extract', 'active');
      }, 2200));

      localTimers.push(setTimeout(() => {
        updateStepStatus('extract', 'done');
        updateStepStatus('insights', 'active');
      }, 3500));

      try {
        let cleanUrl = urls[i];
        const res = await fetch(`${API_BASE}/enrich`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            url: cleanUrl, 
            website_name: websiteName 
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.detail || 'Enrichment failed');
        }

        const data = await res.json();
        if (!data.source_url) {
          data.source_url = cleanUrl;
        }

        localTimers.forEach(clearTimeout);
        setLoadingSteps([
          { id: 'discover', label: 'Discovering pages...', icon: '🔍', status: 'done' },
          { id: 'scrape', label: 'Scraping content...', icon: '📄', status: 'done' },
          { id: 'extract', label: 'Extracting contacts...', icon: '📧', status: 'done' },
          { id: 'insights', label: 'Generating insights...', icon: '🤖', status: 'done' },
          { id: 'complete', label: 'Complete', icon: '✅', status: 'done' }
        ]);

        // Set queue success
        setBulkQueue(prev => prev.map(q => q.id === i ? { ...q, status: 'done' } : q));
        setBulkLog(prev => [...prev, `✅ Finished: ${data.company_name || data.website_name || cleanUrl}`]);
        
        // Show result on the right
        setActiveResult(data);
        
        // Silent reload
        loadResults(true);
      } catch (err) {
        console.error(err);
        localTimers.forEach(clearTimeout);
        setLoadingSteps(prev => prev.map(s => 
          s.status === 'active' || s.status === 'idle' 
            ? { ...s, status: 'failed' } 
            : s
        ));
        // Set queue fail
        setBulkQueue(prev => prev.map(q => q.id === i ? { ...q, status: 'failed', error: err.message } : q));
        setBulkLog(prev => [...prev, `❌ Failed ${urls[i]}: ${err.message}`]);
      }
    }

    setIsEnriching(false);
    setStatus({ type: 'success', message: `Bulk processing completed for ${urls.length} websites.` });
  };

  const handleEnrichSubmit = (e) => {
    e.preventDefault();
    if (isEnriching) return;
    
    if (enrichMode === 'single') {
      handleSingleEnrich(urlInput, websiteName);
    } else {
      handleBulkEnrich();
    }
  };

  // Safe renderer for email array
  const renderEmails = (mailData) => {
    let emails = [];
    if (Array.isArray(mailData)) {
      emails = mailData;
    } else if (typeof mailData === 'string' && mailData.trim()) {
      emails = [mailData];
    }
    
    if (emails.length === 0) return <span className="text-muted">—</span>;
    
    return (
      <div className="pill-container">
        {emails.map((e, idx) => (
          <span key={idx} className="pill">{e}</span>
        ))}
      </div>
    );
  };

  // Helper to copy code string
  const copyText = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export results to JSON file
  const exportToJSON = () => {
    if (scrapedResults.length === 0) return;
    const blob = new Blob([JSON.stringify(scrapedResults, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enriched_companies_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filtered dataset
  const filteredResults = scrapedResults.filter(r => {
    const term = searchTerm.toLowerCase();
    return (
      (r.company_name || '').toLowerCase().includes(term) ||
      (r.website_name || '').toLowerCase().includes(term) ||
      (r.source_url || '').toLowerCase().includes(term) ||
      (r.core_service || '').toLowerCase().includes(term)
    );
  });

  // Pre-load current results silently on mount
  useEffect(() => {
    loadResults(true);
  }, []);

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header>
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">
              <Globe size={18} />
            </div>
            <span>Prospect Research Agent</span>
          </div>
          <span className="badge">
            <span className="badge-dot"></span>
            AI-Engine Activated
          </span>
        </div>
      </header>

      {/* ── Main Container ── */}
      <main>
        {/* Top Section: Form on Left, Single Result Card on Right */}
        <div className="dashboard-grid">
          
          {/* Left Column: Control Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="panel">
              <div className="panel-title">
                <Building size={14} className="text-accent" />
                <span>Enrich Companies</span>
              </div>

              {/* Enrichment Mode Toggles */}
              <div className="tabs-header">
                <button 
                  className={`tab-btn ${enrichMode === 'single' ? 'active' : ''}`}
                  onClick={() => { setEnrichMode('single'); setUrlInput(''); }}
                  disabled={isEnriching}
                >
                  Single Website
                </button>
                <button 
                  className={`tab-btn ${enrichMode === 'bulk' ? 'active' : ''}`}
                  onClick={() => { setEnrichMode('bulk'); setUrlInput(''); }}
                  disabled={isEnriching}
                >
                  Bulk URL List
                </button>
              </div>

              <form onSubmit={handleEnrichSubmit}>
                {/* Website Name Field */}
                <div className="form-group">
                  <label htmlFor="website-name">
                    Website Name {enrichMode === 'single' ? '(optional)' : '(for record category)'}
                  </label>
                  <input 
                    type="text" 
                    id="website-name" 
                    value={websiteName}
                    onChange={(e) => setWebsiteName(e.target.value)}
                    placeholder={enrichMode === 'single' ? 'e.g. Acme Corp' : 'e.g. Lead Batch May'}
                    disabled={isEnriching}
                  />
                </div>

                {/* Single URL vs Bulk Textarea Input */}
                <div className="form-group">
                  {enrichMode === 'single' ? (
                    <>
                      <label htmlFor="company-url">Company URL</label>
                      <input 
                        type="url" 
                        id="company-url" 
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://example.com"
                        required
                        disabled={isEnriching}
                      />
                    </>
                  ) : (
                    <>
                      <label htmlFor="company-url-list">URL List (One URL per line)</label>
                      <textarea 
                        id="company-url-list" 
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://site1.com&#10;https://site2.com&#10;https://site3.com"
                        required
                        disabled={isEnriching}
                      />
                    </>
                  )}
                </div>

                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ width: '100%' }}
                  disabled={isEnriching}
                >
                  {isEnriching ? (
                    <>
                      <div className="spinner"></div>
                      <span>Enriching...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={16} />
                      <span>{enrichMode === 'single' ? 'Enrich Company' : 'Start Bulk Enrichment'}</span>
                    </>
                  )}
                </button>
              </form>

              {/* Status Banner */}
              {status.type && (
                <div className={`status-indicator ${status.type}`}>
                  {status.type === 'loading' && <div className="spinner"></div>}
                  {status.type === 'success' && <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '2px' }} />}
                  {status.type === 'error' && <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />}
                  <span>{status.message}</span>
                </div>
              )}

              {/* Real-time Enrichment Pipeline Progress */}
              {isEnriching && (
                <div style={{
                  marginTop: '1.25rem',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--warning)', marginBottom: '4px' }}>
                    <div className="spinner" style={{ width: '10px', height: '10px', color: 'var(--warning)' }}></div>
                    <span>AI Enrichment Agent Activity</span>
                  </div>
                  {loadingSteps.map((step) => {
                    const isDone = step.status === 'done';
                    const isActive = step.status === 'active';
                    const isFailed = step.status === 'failed';
                    return (
                      <div 
                        key={step.id} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '10px',
                          opacity: isDone || isActive ? 1 : 0.35,
                          transition: 'opacity 0.2s ease'
                        }}
                      >
                        <span style={{ fontSize: '15px' }}>{step.icon}</span>
                        <span style={{ 
                          fontSize: '13px', 
                          fontWeight: isActive ? '500' : '400',
                          color: isActive ? 'var(--warning)' : (isFailed ? 'var(--error)' : 'var(--text-primary)')
                        }}>
                          {step.label}
                        </span>
                        {isDone && <span style={{ marginLeft: 'auto', color: 'var(--success)', fontSize: '12px', fontWeight: 'bold' }}>✓</span>}
                        {isActive && <div className="spinner" style={{ marginLeft: 'auto', width: '10px', height: '10px', color: 'var(--warning)' }}></div>}
                        {isFailed && <span style={{ marginLeft: 'auto', color: 'var(--error)', fontSize: '12px', fontWeight: 'bold' }}>✗</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Queue Log for Bulk */}
              {enrichMode === 'bulk' && bulkQueue.length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <label>Enrichment Queue Status</label>
                  <div className="queue-box">
                    {bulkQueue.map((item) => (
                      <div key={item.id} className="queue-item">
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                          {item.url}
                        </span>
                        <span className={`queue-badge ${item.status}`}>
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Pipeline Process Panel */}
            <div className="panel" style={{ padding: '1.25rem 1.5rem' }}>
              <div className="panel-title" style={{ fontSize: '11px', marginBottom: '0.75rem' }}>
                <Activity size={12} className="text-accent" />
                <span>AI Pipeline Architecture</span>
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: '600' }}>1.</span>
                  <span>Robots.txt & XML sitemap link discovery</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: '600' }}>2.</span>
                  <span>Fuzzy keyword targeting of profiles / contact pages</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: '600' }}>3.</span>
                  <span>Token & raw boilerplate cleaning</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: '600' }}>4.</span>
                  <span>Structured business metrics extraction via Gemini AI</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: '600' }}>5.</span>
                  <span>Upsert database preservation to results.json</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Single Active Result Display */}
          <div>
            {activeResult ? (
              <div className="result-card highlighted">
                {/* Header */}
                <div className="result-card-header">
                  <div>
                    <h3>{activeResult.company_name || activeResult.website_name || 'Generic Company'}</h3>
                    {activeResult.source_url && (
                      <a href={activeResult.source_url} target="_blank" rel="noreferrer" className="source-url-link">
                        <Globe size={11} />
                        <span>{activeResult.source_url}</span>
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  {activeResult.website_name && (
                    <span className="badge" style={{ marginTop: '2px' }}>
                      {activeResult.website_name}
                    </span>
                  )}
                </div>

                {/* Tabs inside Result card to switch between Visual and JSON View */}
                <div className="card-nav">
                  <button 
                    className={`tab-btn ${activeCardTab === 'profile' ? 'active' : ''}`}
                    onClick={() => setActiveCardTab('profile')}
                  >
                    Visual Profile
                  </button>
                  <button 
                    className={`tab-btn ${activeCardTab === 'json' ? 'active' : ''}`}
                    onClick={() => setActiveCardTab('json')}
                  >
                    Raw JSON Format
                  </button>
                </div>

                {/* Body Content depending on Active Tab */}
                {activeCardTab === 'profile' ? (
                  <div className="card-body">
                    {activeResult.error ? (
                      <div className="empty-state" style={{ color: 'var(--error)', padding: '3rem 1.5rem' }}>
                        <AlertCircle size={32} style={{ marginBottom: '10px' }} />
                        <h4>Failed to Enrich Site</h4>
                        <p>{activeResult.error}</p>
                      </div>
                    ) : (
                      <div className="card-grid">
                        <div className="card-field">
                          <div className="field-label">Website Reference</div>
                          <div className="field-value">{activeResult.website_name || '—'}</div>
                        </div>
                        <div className="card-field">
                          <div className="field-label">Phone Contacts</div>
                          <div className="field-value mono">{activeResult.mobile_number || '—'}</div>
                        </div>
                        <div className="card-field full-width">
                          <div className="field-label">Postal Address</div>
                          <div className="field-value">{activeResult.address || '—'}</div>
                        </div>
                        <div className="card-field full-width">
                          <div className="field-label">Detected Emails</div>
                          <div className="field-value">
                            {renderEmails(activeResult.mail)}
                          </div>
                        </div>
                        <div className="card-field full-width">
                          <div className="field-label">Core Business Offering</div>
                          <div className="field-value">{activeResult.core_service || '—'}</div>
                        </div>
                        <div className="card-field">
                          <div className="field-label">Target Audience</div>
                          <div className="field-value">{activeResult.target_customer || '—'}</div>
                        </div>
                        <div className="card-field">
                          <div className="field-label">Key Customer Pain Point</div>
                          <div className="field-value">{activeResult.probable_pain_point || '—'}</div>
                        </div>
                        <div className="card-field full-width last-row">
                          <div className="field-label">Personalized Outreach Opener</div>
                          <div className="field-value opener-box">
                            {activeResult.outreach_opener || '—'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="json-view-container">
                    <button 
                      className="json-copy-btn"
                      onClick={() => copyText(JSON.stringify(activeResult, null, 2), 'active')}
                    >
                      {copiedId === 'active' ? (
                        <>
                          <Check size={12} className="text-success" />
                          <span className="text-success">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Copy JSON</span>
                        </>
                      )}
                    </button>
                    <pre style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                      <code>{JSON.stringify(activeResult, null, 2)}</code>
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="result-card">
                <div className="empty-state">
                  <div className="logo-icon empty-state-icon">
                    <FileText size={24} />
                  </div>
                  <h3>Waiting for Company Enrichment</h3>
                  <p>Input a website and click enrich to trigger structured analysis. The extracted profile will render here.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Dataset/Results Section ── */}
        <div className="panel results-section" style={{ marginTop: '1rem' }}>
          <div className="results-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '600' }}>Enriched Company Dataset</h2>
              <span className="badge" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
                {filteredResults.length} Record(s)
              </span>
            </div>

            {/* Actions Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => loadResults(false)}
                title="Fetch entire dataset from database"
                style={{ padding: '8px 14px', fontSize: '13px' }}
              >
                <RotateCw size={14} />
                <span>Show All Results</span>
              </button>
              
              <button 
                className="btn btn-secondary" 
                onClick={exportToJSON}
                disabled={scrapedResults.length === 0}
                title="Export entire dataset to JSON file"
                style={{ padding: '8px 14px', fontSize: '13px' }}
              >
                <Download size={14} />
                <span>Export Dataset</span>
              </button>

              <div className="view-toggle-group">
                <button 
                  className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setViewMode('table')}
                  title="List Table View"
                >
                  <List size={16} />
                </button>
                <button 
                  className={`view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                  onClick={() => setViewMode('cards')}
                  title="Grid Cards View"
                >
                  <Grid size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Search Filter */}
          <div className="search-filter-box">
            <div className="search-input-wrapper">
              <Search size={15} className="search-icon" />
              <input 
                type="text" 
                placeholder="Search by company name, category, url, service offering..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Results Views */}
          {filteredResults.length > 0 ? (
            viewMode === 'table' ? (
              /* Table Layout */
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Category</th>
                      <th>Core Service Offer</th>
                      <th>Emails</th>
                      <th>Phone</th>
                      <th style={{ width: '80px', textAlign: 'center' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <div className="table-company-cell">
                            <span className="table-company-name">{r.company_name || 'Generic Company'}</span>
                            {r.source_url && (
                              <a href={r.source_url} target="_blank" rel="noreferrer" className="table-company-url">
                                {r.source_url.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="badge" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', fontSize: '10px' }}>
                            {r.website_name || '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {r.core_service || '—'}
                          </span>
                        </td>
                        <td>{renderEmails(r.mail)}</td>
                        <td className="mono" style={{ fontSize: '12px' }}>{r.mobile_number || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={() => { setModalResult(r); setModalTab('profile'); }}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Grid Cards Layout */
              <div className="cards-grid">
                {filteredResults.map((r, i) => (
                  <div key={i} className="result-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="result-card-header" style={{ padding: '1.25rem' }}>
                      <div style={{ maxWidth: '75%' }}>
                        <h4 style={{ fontSize: '15px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.company_name || r.website_name || 'Generic Company'}
                        </h4>
                        {r.source_url && (
                          <a href={r.source_url} target="_blank" rel="noreferrer" className="source-url-link" style={{ fontSize: '11px' }}>
                            <span>{r.source_url.replace(/^https?:\/\//, '')}</span>
                          </a>
                        )}
                      </div>
                      {r.website_name && (
                        <span className="badge" style={{ fontSize: '10px', padding: '2px 8px' }}>
                          {r.website_name}
                        </span>
                      )}
                    </div>
                    
                    <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                      <div>
                        <div className="field-label" style={{ fontSize: '9px' }}>Offering</div>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {r.core_service || '—'}
                        </p>
                      </div>
                      <div>
                        <div className="field-label" style={{ fontSize: '9px' }}>Pain Point</div>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {r.probable_pain_point || '—'}
                        </p>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {Array.isArray(r.mail) ? `${r.mail.length} Email(s)` : (r.mail ? '1 Email' : 'No Emails')}
                        </span>
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={() => { setModalResult(r); setModalTab('profile'); }}
                        >
                          Show Profile
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="result-card">
              <div className="empty-state" style={{ padding: '3rem 2rem' }}>
                <HelpCircle className="empty-state-icon" />
                {hasLoadedResults ? (
                  <>
                    <h3>No Matching Records</h3>
                    <p>No enriched records match the specified search filters. Try clearing your search parameters.</p>
                  </>
                ) : (
                  <>
                    <h3>Results Database Standby</h3>
                    <p>Click "Show All Results" above to load all enriched companies from the database.</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Modal Overlay for Detailed View ── */}
      {modalResult && (
        <div className="modal-overlay" onClick={() => setModalResult(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Company Details Profile</h2>
              <button className="modal-close-btn" onClick={() => setModalResult(null)}>✕</button>
            </div>
            
            <div className="modal-body">
              {/* Modal Tabs */}
              <div className="card-nav" style={{ padding: '0 1.75rem', background: 'var(--bg-secondary)' }}>
                <button 
                  className={`tab-btn ${modalTab === 'profile' ? 'active' : ''}`}
                  onClick={() => setModalTab('profile')}
                >
                  Visual Profile
                </button>
                <button 
                  className={`tab-btn ${modalTab === 'json' ? 'active' : ''}`}
                  onClick={() => setModalTab('json')}
                >
                  Raw JSON Code
                </button>
              </div>

              {modalTab === 'profile' ? (
                <div className="card-grid">
                  <div className="card-field">
                    <div className="field-label">Legal/Trading Name</div>
                    <div className="field-value" style={{ fontWeight: '600' }}>
                      {modalResult.company_name || 'Generic Company'}
                    </div>
                  </div>
                  <div className="card-field">
                    <div className="field-label">Website Reference</div>
                    <div className="field-value">{modalResult.website_name || '—'}</div>
                  </div>
                  <div className="card-field">
                    <div className="field-label">Source URL</div>
                    <div className="field-value">
                      {modalResult.source_url ? (
                        <a href={modalResult.source_url} target="_blank" rel="noreferrer" className="source-url-link" style={{ marginTop: 0 }}>
                          <span>{modalResult.source_url}</span>
                          <ExternalLink size={10} style={{ marginLeft: '4px' }} />
                        </a>
                      ) : '—'}
                    </div>
                  </div>
                  <div className="card-field">
                    <div className="field-label">Telephone Contacts</div>
                    <div className="field-value mono">{modalResult.mobile_number || '—'}</div>
                  </div>
                  <div className="card-field full-width">
                    <div className="field-label">Postal Address</div>
                    <div className="field-value">{modalResult.address || '—'}</div>
                  </div>
                  <div className="card-field full-width">
                    <div className="field-label">Detected Emails</div>
                    <div className="field-value">{renderEmails(modalResult.mail)}</div>
                  </div>
                  <div className="card-field full-width">
                    <div className="field-label">Core Business Offering</div>
                    <div className="field-value">{modalResult.core_service || '—'}</div>
                  </div>
                  <div className="card-field">
                    <div className="field-label">Target Audience</div>
                    <div className="field-value">{modalResult.target_customer || '—'}</div>
                  </div>
                  <div className="card-field">
                    <div className="field-label">Key Customer Pain Point</div>
                    <div className="field-value">{modalResult.probable_pain_point || '—'}</div>
                  </div>
                  <div className="card-field full-width last-row" style={{ borderBottom: 'none' }}>
                    <div className="field-label">Personalized Outreach Opener</div>
                    <div className="field-value opener-box">{modalResult.outreach_opener || '—'}</div>
                  </div>
                </div>
              ) : (
                <div className="json-view-container" style={{ maxHeight: '500px' }}>
                  <button 
                    className="json-copy-btn"
                    onClick={() => copyText(JSON.stringify(modalResult, null, 2), 'modal')}
                  >
                    {copiedId === 'modal' ? (
                      <>
                        <Check size={12} className="text-success" />
                        <span className="text-success">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                  <pre style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    <code>{JSON.stringify(modalResult, null, 2)}</code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
