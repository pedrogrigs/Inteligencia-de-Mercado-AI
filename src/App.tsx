import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, BarChart, Bar, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { Search, TrendingUp, AlertCircle, Loader2, Download, FileText, CheckCircle2, Maximize2, X, Sparkles, Target, Zap, Settings, User } from 'lucide-react';
// @ts-ignore
import html2pdf from 'html2pdf.js';
import { cn } from './lib/utils';

export default function App() {
  const [tab, setTab] = useState<'monitoramento' | 'planos'>('monitoramento');
  
  const [showSettings, setShowSettings] = useState(false);
  const [userProfile, setUserProfile] = useState({ profession: '', goal: '', style: 'Agressivo (Oceano Azul)' });

  useEffect(() => {
    try {
      const saved = localStorage.getItem('userProfile');
      if (saved) setUserProfile(JSON.parse(saved));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('userProfile', JSON.stringify(userProfile));
    setShowSettings(false);
  };

  const [topic, setTopic] = useState('');
  
  const [formState, setFormState] = useState<'idle' | 'generating_form' | 'form' | 'analyzing' | 'done'>('idle');
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customAnswer, setCustomAnswer] = useState('');

  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<{
    topic: string;
    keywords: string[];
    trends: any[];
  } | null>(null);

  const [insights, setInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [hoveredKeyword, setHoveredKeyword] = useState<string | null>(null);
  const [expandedChart, setExpandedChart] = useState<'main' | 'bar' | null>(null);

  const colors = ["#f59e0b", "#fbbf24", "#fcd34d", "#fde68a", "#fffbeb"];

  const handleInitialSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setFormState('generating_form');
    setError('');

    try {
      const response = await fetch('/api/generate-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, userProfile, previousAnswers: {} }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      if (data.isSatisfied) {
        setAnswers({}); 
        setCustomAnswer('');
        runAnalysis({}, ''); // Fast path if AI says it doesn't need info
      } else {
        setQuestions(data.questions || []);
        setAnswers({});
        setCustomAnswer('');
        setFormState('form');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao gerar o formulário.');
      setFormState('idle');
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormState('generating_form');
    // Check with AI if it needs more info or is satisfied
    try {
      const response = await fetch('/api/generate-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, userProfile, previousAnswers: answers }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      if (data.isSatisfied || data.questions?.length === 0) {
        runAnalysis(answers, customAnswer);
      } else {
        // AI sent another form to refine further
        setQuestions(data.questions);
        setCustomAnswer('');
        setFormState('form');
      }
    } catch (err: any) {
      setError('Falha ao negociar perguntas com a IA.');
      setFormState('form');
    }
  };

  const runAnalysis = async (finalAnswers: any, finalCustomAnswer: string) => {
    setFormState('analyzing');
    setError('');
    setResults(null);
    setInsights(null);

    try {
      const response = await fetch('/api/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, answers: finalAnswers, customAnswer: finalCustomAnswer, userProfile }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ocorreu um erro.');

      const formattedTrends = data.trends.map((item: any) => {
        const pointData: any = { time: item.formattedAxisTime || item.formattedTime };
        data.keywords.forEach((keyword: string, index: number) => {
          pointData[keyword] = item.value[index] || 0;
        });
        return pointData;
      });

      setResults({
        topic: data.topic,
        keywords: data.keywords,
        trends: formattedTrends,
      });
      setFormState('done');

      // Now fetch insights based on these keywords without blocking
      setInsightsLoading(true);
      fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, keywords: data.keywords, answers: finalAnswers, customAnswer: finalCustomAnswer, userProfile }),
      }).then(res => res.json()).then(insightsData => {
        if(insightsData.executiveSummary) {
          setInsights(insightsData);
        }
      }).catch(console.error).finally(() => setInsightsLoading(false));

    } catch (err: any) {
      setError(err.message || 'Falha na conexão.');
      setFormState('idle');
    }
  };

  const exportToPDF = async () => {
    if (!results) return;
    setPdfLoading(true);
    try {
      const res = await fetch('/api/report', { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ topic: results.topic, contextInfo: JSON.stringify(answers), keywords: results.keywords, userProfile, insights })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error);

      const reportHtml = data.html;

      const extractChartHTML = (className: string) => {
        const el = document.querySelector(`.${className} .recharts-wrapper`);
        return el ? el.outerHTML : '';
      };

      const lineChartHtml = extractChartHTML('main-chart-container');
      const barChartHtml = extractChartHTML('bar-chart-container');
      const radarChartHtml = extractChartHTML('radar-chart-container');

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '-10000px';
      iframe.style.width = '800px';
      iframe.style.height = '1200px';
      document.body.appendChild(iframe);
      
      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=Inter:wght@400;500;600&display=swap');
                body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: #0a0a0a; color: #e5e5e5; }
                h1, h2, h3 { font-family: 'Playfair Display', serif; }
                p { font-size: 13.5px; line-height: 1.6; color: #a3a3a3; margin-bottom: 20px; }
                ul { padding-left: 20px; font-size: 13.5px; color: #a3a3a3; line-height: 1.6; margin-bottom: 24px; }
                li { padding-left: 8px; margin-bottom: 8px; }
                strong { color: #facc15; font-weight: 600; }
                
                .pdf-page { width: 100%; box-sizing: border-box; padding: 48px 56px; background: #0a0a0a; }
                
                .header-container { display: flex; justify-content: space-between; border-bottom: 1px solid #333; padding-bottom: 24px; margin-bottom: 36px; align-items: flex-end;}
                .header-title h1 { font-size: 28px; line-height: 1.1; font-weight: 700; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: -0.5px; color: #fff; }
                .header-subtitle { color: #888; font-size: 13px; font-weight: 500; letter-spacing: 0.5px;text-transform: uppercase; margin:0;}
                .header-meta { text-align: right; border-left: 1px solid #333; padding-left: 20px; }
                .meta-label { font-size: 10px; font-weight: 600; color: #f59e0b; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;}
                .meta-value { font-size: 13px; font-weight: 600; color: #fff; text-transform: capitalize; margin: 0; }
                
                .keywords-box { background: #111; border: 1px solid #222; border-radius: 8px; padding: 24px; margin-bottom: 40px; text-align: center; }
                .keywords-title { font-size: 11px; text-transform: uppercase; font-weight: 600; color: #666; letter-spacing: 1px; margin: 0 0 16px 0; }
                .kw-pill { background: #1a1a1a; color: #f59e0b; padding: 6px 14px; border-radius: 4px; border: 1px solid #333; font-size: 11px; font-weight: 500; font-family: monospace; display: inline-block; margin: 4px; letter-spacing: 0.5px; }

                .content-box { border-left: 3px solid #f59e0b; padding-left: 20px; margin-bottom: 40px; background: #111; padding: 16px 16px 16px 20px; border-radius: 0 8px 8px 0; }
                .content-disclaimer { font-family: 'Playfair Display', serif; font-size: 16px; font-style: italic; color: #888; margin: 0; }

                .generated-content h2 { font-size: 18px; text-transform: uppercase; letter-spacing: 1px; color: #f59e0b; border-bottom: 1px solid #333; padding-bottom: 8px; margin-top: 40px; margin-bottom: 16px; }
                .generated-content h3 { font-size: 15px; color: #fff; margin-top: 24px; margin-bottom: 12px; }
                
                .footer { margin-top: 60px; padding-top: 24px; border-top: 1px solid #333; display: flex; justify-content: space-between; font-size: 10px; color: #666; font-family: monospace; text-transform: uppercase; }

                .chart-section { background: #111; padding: 24px; border-radius: 12px; border: 1px solid #222; page-break-inside: avoid; margin-bottom: 40px; }
                .chart-title { font-size: 16px; color: #fff; font-family: 'Playfair Display', serif; margin-bottom: 16px; }
                .chart-subtitle { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
                .chart-wrapper { width: 100%; display: flex; justify-content: center; overflow: hidden;}
              </style>
            </head>
            <body>
              <div class="pdf-page">
                <div class="header-container">
                  <div class="header-title">
                    <h1>TrendIntel Executive Report</h1>
                    <p class="header-subtitle"><strong style="color: #fff;">Dossiê Estratégico:</strong> ${results.topic}</p>
                  </div>
                  <div class="header-meta">
                    <p class="meta-label">ID de Sessão</p>
                    <p class="meta-value" style="margin-bottom: 12px;">TX-${Math.floor(Math.random()*10000)}</p>
                    <p class="meta-label">Perfil / Orientação</p>
                    <p class="meta-value">${userProfile.profession || 'Geral'} / ${userProfile.style}</p>
                  </div>
                </div>

                <div class="keywords-box">
                  <p class="keywords-title">Vetores Mapeados pelo Algoritmo</p>
                  <div>
                    ${results.keywords.map((kw: string) => `<span class="kw-pill">${kw}</span>`).join('')}
                  </div>
                </div>

                <div class="content-box">
                   <p class="content-disclaimer">
                     “Este dossiê foi construído através de dados live do Google Trends. As conclusões a seguir são desenhadas exclusivamente para capitalizar sobre falhas mercadológicas atuais.”
                   </p>
                </div>
                
                ${lineChartHtml ? `
                <div class="chart-section">
                  <div class="chart-subtitle">Interesse Combinado</div>
                  <div class="chart-title">Tendência Macro de Mercado (12 Meses)</div>
                  <div class="chart-wrapper">
                    ${lineChartHtml}
                  </div>
                </div>` : ''}

                <div style="display: flex; gap: 24px; page-break-inside: avoid; margin-bottom: 40px;">
                  ${barChartHtml ? `
                  <div class="chart-section" style="flex: 1; margin: 0;">
                    <div class="chart-subtitle">Análise de GAP</div>
                    <div class="chart-title">Oceano Azul / Oportunidade</div>
                    <div class="chart-wrapper">
                      ${barChartHtml}
                    </div>
                  </div>` : ''}
                  
                  ${radarChartHtml ? `
                  <div class="chart-section" style="flex: 1; margin: 0;">
                    <div class="chart-subtitle">Indicadores</div>
                    <div class="chart-title">Fator de Risco Global</div>
                    <div class="chart-wrapper">
                      ${radarChartHtml}
                    </div>
                  </div>` : ''}
                </div>

                <div class="generated-content">
                  ${reportHtml}
                </div>
                
                <div class="footer">
                  <div>Documento Exclusivo e Confidencial</div>
                  <div>TrendIntel AI • ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}</div>
                </div>
              </div>
            </body>
          </html>
        `);
        doc.close();
        
        await new Promise(resolve => setTimeout(resolve, 800));

        const opt: any = {
          margin:       0.2,
          filename:     `TrendIntel_Dossie_${results.topic.replace(/\s+/g, '_')}.pdf`,
          image:        { type: 'jpeg', quality: 0.98 },
          html2canvas:  { scale: 2, useCORS: true, logging: false, backgroundColor: '#0a0a0a' },
          jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        
        // @ts-ignore
        await html2pdf().set(opt).from(doc.body.firstElementChild as HTMLElement).save();
      }

      // Cleanup
      document.body.removeChild(iframe);
      
    } catch (err: any) {
      console.error(err);
      alert("Erro ao exportar PDF: " + err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="w-full min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-sans flex flex-col overflow-x-hidden">
      
      {/* Top Navigation / Header (From Design Theme) */}
      <nav className="h-24 border-b border-white/10 flex items-center justify-between px-6 sm:px-10 bg-[#0d0d0d] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-amber-500 to-amber-200 rounded-sm rotate-45 flex items-center justify-center">
            <div className="w-4 h-4 bg-[#0a0a0a] rounded-full"></div>
          </div>
          <span className="text-xl font-light tracking-[0.2em] uppercase text-white hidden sm:inline">Trend<span className="font-bold">Intel</span> <span className="text-amber-400">AI</span></span>
        </div>
        
        <div className="flex gap-4 sm:gap-6 text-[10px] sm:text-xs tracking-widest uppercase opacity-80 font-medium">
          <span 
            onClick={() => setTab('monitoramento')} 
            className={`cursor-pointer transition-colors ${tab === 'monitoramento' ? 'text-amber-500 font-bold border-b border-amber-500 pb-1' : 'hover:text-white'}`}
          >
            Monitoramento
          </span>
          <span onClick={() => setTab('planos')} className={`cursor-pointer transition-colors ${tab === 'planos' ? 'text-amber-500 font-bold border-b border-amber-500 pb-1' : 'hover:text-white'}`}>Planos</span>
          <span onClick={() => setShowSettings(true)} className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors"><Settings className="w-4 h-4"/> Configurações</span>
        </div>
      </nav>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8 md:py-12 flex flex-col items-center">
      
        {tab === 'planos' && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-serif mb-4 text-white">Escolha seu Plano Estratégico</h2>
              <p className="text-white/50 max-w-2xl mx-auto">Desbloqueie o poder total da inteligência de dados. Exporte relatórios densos com IA e personalize sua análise.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Plan 1 */}
              <div className="bg-[#111111] border border-white/5 rounded-2xl p-8 flex flex-col relative transition-transform hover:-translate-y-1 hover:shadow-xl">
                <h3 className="text-xl font-bold mb-2">Starter</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-bold">R$30</span>
                  <span className="text-white/40 text-sm">/mês</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1 text-sm text-white/70">
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-500"/> 50 Pesquisas por mês</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-500"/> Exportação de Gráficos Básicos</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-500"/> Análise IA Standard</li>
                </ul>
                <button className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-bold uppercase text-xs tracking-wider transition-colors">Assinar Starter</button>
              </div>
              
              {/* Plan 2 */}
              <div className="bg-[#1a1511] border border-amber-500/50 rounded-2xl p-8 flex flex-col relative transform md:scale-105 shadow-2xl shadow-amber-500/10 z-10 transition-transform hover:-translate-y-1">
                <div className="absolute top-0 right-0 bg-amber-500 text-black text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg rounded-tr-xl">Mais Popular</div>
                <h3 className="text-xl font-bold mb-2 text-amber-500">Pro</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-bold text-white">R$50</span>
                  <span className="text-white/40 text-sm">/mês</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1 text-sm text-white/80">
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> Pesquisas Ilimitadas</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> <strong className="text-amber-500">Exportação PDF Detalhado (Estratégia)</strong></li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> <strong className="text-amber-500">Filtro de Intenção Personalizado</strong></li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> Suporte Prioritário</li>
                </ul>
                <button className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-full font-bold uppercase text-xs tracking-wider transition-colors">Assinar Pro</button>
              </div>
              
              {/* Plan 3 */}
              <div className="bg-[#111111] border border-white/5 rounded-2xl p-8 flex flex-col relative transition-transform hover:-translate-y-1 hover:shadow-xl">
                <h3 className="text-xl font-bold mb-2">Enterprise</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-bold">R$100</span>
                  <span className="text-white/40 text-sm">/mês</span>
                </div>
                <ul className="space-y-4 mb-8 flex-1 text-sm text-white/70">
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> Tudo do plano Pro</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> Acesso Full à API</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> PDFs White-label (Marca D'água Própria)</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"/> Analista Dedicado de Contas</li>
                </ul>
                <button className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full font-bold uppercase text-xs tracking-wider transition-colors">Falar com Consultor</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'monitoramento' && (
          <>
            {/* Header Section */}
            <header className="text-center mb-10 space-y-4">
              <h1 className="text-4xl sm:text-5xl md:text-5xl font-serif text-white">
                Inteligência de Mercado
              </h1>
              <p className="text-sm sm:text-base opacity-60 font-medium max-w-xl mx-auto">
                Transforme dados brutos em estratégias. Escolha seu objetivo e deixe nossa IA identificar as tendências mais lucrativas para você.
              </p>
            </header>

            {/* Search Bar */}
            <form onSubmit={handleInitialSearch} className="w-full max-w-2xl relative group mb-12">
              <div className="flex flex-col sm:flex-row gap-2 mb-4 bg-[#111111] p-2 rounded-2xl border border-white/10">
                <div className="flex-1 relative flex items-center">
                  <div className="pl-4 text-white/50">
                    <Search className="w-5 h-5" />
                  </div>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Ex: Sustentabilidade 2024..."
                    className="w-full py-3 px-4 bg-transparent outline-none text-white placeholder:text-white/40 text-sm italic font-serif"
                    disabled={formState !== 'idle' && formState !== 'done'}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={formState === 'generating_form' || !topic.trim()}
                  className="w-full sm:w-auto px-8 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold uppercase text-xs tracking-widest rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {formState === 'generating_form' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Interagindo com IA...
                    </>
                  ) : (
                    'Otimizar IA'
                  )}
                </button>
              </div>
            </form>

            {/* Error State */}
            {error && (
              <div className="w-full max-w-4xl p-4 sm:p-5 mb-8 rounded-2xl bg-[#111111] border border-red-500/20 text-red-400 flex items-start gap-3 mt-4 animate-in fade-in">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="flex flex-col">
                  <span className="font-semibold text-red-300">Erro na Análise</span>
                  <span className="text-sm opacity-90">{error}</span>
                </div>
              </div>
            )}

            {/* Loading State Skeleton */}
            {formState === 'analyzing' && (
              <div className="w-full max-w-4xl flex flex-col items-center justify-center py-20 space-y-8 animate-pulse text-white/50">
                <div className="flex gap-4">
                  <div className="w-24 h-8 bg-white/5 rounded-full"></div>
                  <div className="w-32 h-8 bg-white/5 rounded-full"></div>
                  <div className="w-20 h-8 bg-white/5 rounded-full"></div>
                </div>
                <div className="w-full h-80 bg-[#111111] border border-white/5 rounded-2xl" />
              </div>
            )}

            {/* Results Area */}
            {results && formState === 'done' && (
              <div className="w-full max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out space-y-10 mb-20">
                
                <div className="p-1 border border-amber-500/30 bg-amber-500/10 rounded-2xl flex items-center justify-between px-6 py-4">
                   <div>
                      <h4 className="text-xs uppercase tracking-widest text-amber-500 font-bold mb-1">Status da Análise</h4>
                      <p className="text-sm font-serif italic text-white/80">Dados Otimizados</p>
                   </div>
                   <button 
                     onClick={exportToPDF}
                     disabled={pdfLoading}
                     className={`px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold uppercase text-[10px] tracking-widest rounded-lg transition-colors flex items-center gap-2 ${pdfLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                   >
                     {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4" />}
                     {pdfLoading ? 'Gerando Relatório...' : 'Exportar Relatório PDF (Pro)'}
                   </button>
                </div>

                {/* AI Selected Keywords */}
                <div className="flex flex-col items-start space-y-4">
                  <h3 className="text-[10px] uppercase tracking-[0.3em] opacity-40">
                    Vetores de Expansão (Otimizados por IA)
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    {results.keywords.map((kw, i) => (
                      <span
                        key={kw}
                        onMouseEnter={() => setHoveredKeyword(kw)}
                        onMouseLeave={() => setHoveredKeyword(null)}
                        className={`px-4 py-1.5 rounded-full text-xs font-serif italic border cursor-default transition-all duration-300 ${hoveredKeyword === kw ? 'bg-white/20 scale-105 shadow-lg' : 'bg-white/5'}`}
                        style={{ borderColor: colors[i % colors.length] + '40', color: colors[i % colors.length], boxShadow: hoveredKeyword === kw ? `0 0 15px ${colors[i % colors.length]}40` : '' }}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Main Trend Chart */}
                <div className="p-4 sm:p-6 md:p-8 bg-[#111111] rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden backdrop-blur-sm group">
                  <button onClick={() => setExpandedChart('main')} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity bg-white/5 p-2 rounded-lg hover:bg-white/10 z-10 text-white/60 hover:text-white">
                    <Maximize2 className="w-5 h-5"/>
                  </button>
                  <div className="mb-8">
                    <h3 className="text-[10px] uppercase tracking-[0.3em] opacity-40">Interesse Combinado</h3>
                    <h2 className="text-2xl font-serif mt-1 flex items-center gap-3">
                       Tendência de 12 Meses
                    </h2>
                  </div>

                  <div className="w-full h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={results.trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" vertical={false} />
                        <XAxis 
                          dataKey="time" 
                          stroke="#ffffff33" 
                          tick={{ fill: '#ffffff66', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }} 
                          tickMargin={10}
                          minTickGap={30}
                        />
                        <YAxis 
                          stroke="#ffffff33" 
                          tick={{ fill: '#ffffff66', fontSize: 10 }} 
                          tickLine={false}
                          axisLine={false}
                        />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#ffffff1a', borderRadius: '8px', color: '#e0e0e0' }}
                          itemStyle={{ color: '#e0e0e0', fontSize: '12px', padding: '2px 0' }}
                          labelStyle={{ color: '#ffffff80', marginBottom: '8px', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                        />
                        <Legend 
                          wrapperStyle={{ paddingTop: '20px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.6 }} 
                          iconType="circle"
                        />
                        
                        {results.keywords.map((kw, idx) => {
                          const isHovered = hoveredKeyword === kw;
                          const isAnyHovered = hoveredKeyword !== null;
                          const opacity = isAnyHovered ? (isHovered ? 1 : 0.2) : 1;
                          const strokeWidth = isHovered ? 4 : 2;

                          return (
                            <Line
                              key={kw}
                              type="monotone"
                              dataKey={kw}
                              stroke={colors[idx % colors.length]}
                              strokeWidth={strokeWidth}
                              strokeOpacity={opacity}
                              dot={false}
                              activeDot={isHovered ? { r: 8, strokeWidth: 0, fill: colors[idx % colors.length] } : { r: 6, strokeWidth: 0 }}
                              className="transition-all duration-300"
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-6 text-[10px] text-white/40 uppercase tracking-widest text-center flex items-center justify-center gap-2">
                    <Zap className="w-3 h-3 text-amber-500/50" />
                    Gráfico demonstra o interesse relativo. Processado por TrendIntel AI Pipeline.
                  </div>
                </div>

                {/* Insights Area */}
                {insightsLoading && (
                   <div className="w-full flex-col items-center justify-center py-10 space-y-4 animate-pulse text-white/50 bg-[#111111] border border-white/5 rounded-2xl p-6">
                     <span className="text-xs uppercase tracking-widest">A inteligência artificial está computando os insights...</span>
                     <div className="w-full h-24 bg-white/5 rounded-xl"></div>
                   </div>
                )}

                {insights && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-[#111111] p-6 lg:p-8 rounded-2xl border border-white/5 shadow-xl">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-4 flex items-center gap-2">
                        <Sparkles className="w-4 h-4"/> Resumo Estratégico
                      </h3>
                      <p className="text-white/80 text-sm leading-relaxed mb-6 font-serif italic">"{insights.executiveSummary}"</p>
                      <h4 className="text-[10px] uppercase tracking-widest opacity-40 mb-3">Plano de Ação (Curto Prazo)</h4>
                      <ul className="space-y-3">
                        {insights.bulletPoints.map((b: string, i: number) => (
                          <li key={i} className="flex gap-3 text-sm text-white/70">
                             <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                             <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-[#111111] p-6 lg:p-8 rounded-2xl border border-white/5 shadow-xl relative group flex flex-col">
                      <button onClick={() => setExpandedChart('bar')} className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity bg-white/5 p-2 rounded-lg hover:bg-white/10 z-10 text-white/60 hover:text-white">
                        <Maximize2 className="w-5 h-5"/>
                      </button>
                      <h3 className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-2 flex items-center gap-2">
                        <Target className="w-4 h-4"/> Nível de Oportunidade
                      </h3>
                      <p className="text-[10px] text-white/40 uppercase tracking-widest mb-6">Potencial vs Concorrência (0-100)</p>
                      
                      <div className="flex-1 w-full min-h-[250px] bar-chart-container">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={insights.nichesChart} layout="vertical" margin={{ top: 0, right: 30, left: 40, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" horizontal={true} vertical={false} />
                            <XAxis type="number" domain={[0, 100]} hide />
                            <YAxis dataKey="name" type="category" stroke="#ffffff66" tick={{ fill: '#ffffff99', fontSize: 11 }} tickLine={false} axisLine={false} width={100} />
                            <RechartsTooltip 
                              cursor={{fill: '#ffffff0a'}}
                              contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#ffffff1a', borderRadius: '8px', color: '#e0e0e0' }}
                            />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                              {insights.nichesChart.map((entry: any, index: number) => (
                                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="bg-[#111111] p-6 lg:p-8 rounded-2xl border border-white/5 shadow-xl md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-6 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4"/> Dicas Táticas Avançadas (Insider)
                        </h3>
                        <ul className="space-y-4">
                          {insights?.advancedTips?.map((tip: string, i: number) => (
                            <li key={i} className="flex gap-4 p-4 bg-emerald-900/10 border border-emerald-900/30 rounded-xl">
                              <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 font-bold text-xs">
                                {i + 1}
                              </div>
                              <p className="text-sm text-white/80 leading-relaxed">{tip}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                      
                      <div className="w-full h-[300px] radar-chart-container">
                        <h3 className="text-[10px] text-center text-white/40 uppercase tracking-widest mb-2">Índices do Fator de Risco & Oportunidade</h3>
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={insights?.radarChart || []}>
                            <PolarGrid stroke="#ffffff1a" />
                            <PolarAngleAxis dataKey="subject" tick={{ fill: '#ffffff66', fontSize: 10, textTransform: 'uppercase' }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                            <Radar name="Scoring" dataKey="A" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                            <RechartsTooltip 
                              contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#ffffff1a', borderRadius: '8px', color: '#e0e0e0' }}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </>
        )}
      </main>

      {/* Blurred Form Modal */}
      {formState === 'form' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-[#111111] border border-white/10 w-full max-w-xl p-8 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-500">
            <h2 className="text-2xl font-serif text-white mb-2">Refine sua Análise</h2>
            <p className="text-white/50 text-sm mb-8">Nossa inteligência gerou estas perguntas para calibrar a precisão dos dados sobre <strong className="text-white">"{topic}"</strong>.</p>
            
            <form onSubmit={handleFormSubmit} className="space-y-6">
               {questions.map((q) => (
                 <div key={q.id} className="space-y-3">
                   <label className="block text-sm font-bold text-amber-500">{q.label}</label>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                     {q.options.map((opt: string) => (
                       <div key={opt} onClick={() => setAnswers(prev => ({ ...prev, [q.id]: opt }))} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${answers[q.id] === opt ? 'bg-amber-500/10 border-amber-500/50 text-amber-100' : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10'}`}>
                         <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${answers[q.id] === opt ? 'border-amber-500' : 'border-white/30'}`}>
                           {answers[q.id] === opt && <div className="w-2 h-2 bg-amber-500 rounded-full" />}
                         </div>
                         <span className="text-xs">{opt}</span>
                       </div>
                     ))}
                   </div>
                 </div>
               ))}
               
               <div className="space-y-3 pt-2">
                 <label className="block text-sm font-bold text-amber-500">Outros detalhes ou objetivos específicos (opcional)</label>
                 <textarea 
                   rows={3}
                   value={customAnswer}
                   onChange={e => setCustomAnswer(e.target.value)}
                   placeholder="Digite aqui se o seu objetivo não se encaixa perfeitamente nas opções acima..."
                   className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white placeholder:text-white/30 outline-none focus:border-amber-500/50 transition-colors resize-none"
                 />
               </div>

               <div className="flex gap-4 pt-4 border-t border-white/5">
                 <button type="button" onClick={() => setFormState('idle')} className="px-6 py-3 rounded-xl border border-white/10 text-white/60 hover:text-white hover:bg-white/5 text-xs font-bold uppercase tracking-widest transition-colors">
                   Cancelar
                 </button>
                 <button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-400 text-black px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors flex justify-center items-center gap-2">
                   <Sparkles className="w-4 h-4" /> Gerar Inteligência Total
                 </button>
               </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-[#111111] border border-white/10 w-full max-w-md p-8 rounded-3xl shadow-2xl animate-in zoom-in-95 duration-500">
            <h2 className="text-2xl font-serif text-amber-500 mb-2 flex items-center gap-2"><User className="w-6 h-6"/> Perfil Estratégico</h2>
            <p className="text-white/50 text-sm mb-6 pb-6 border-b border-white/10">Configure o contexto da sua atuação para que a IA gere relatórios e perguntas adaptados ao seu modelo de negócios e necessidades.</p>
            
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-white/50">Área de Atuação / Profissão</label>
                <input 
                  type="text" 
                  value={userProfile.profession}
                  onChange={e => setUserProfile(p => ({ ...p, profession: e.target.value }))}
                  placeholder="Ex: Gestor de Tráfego, E-commerce, YouTuber"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white placeholder:text-white/30 focus:border-amber-500/50 outline-none transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-white/50">Objetivo Principal do App</label>
                <input 
                  type="text" 
                  value={userProfile.goal}
                  onChange={e => setUserProfile(p => ({ ...p, goal: e.target.value }))}
                  placeholder="Ex: Encontrar nichos para vender PLR"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white placeholder:text-white/30 focus:border-amber-500/50 outline-none transition-colors"
                />
              </div>

              <div className="space-y-2 pb-6 border-b border-white/10">
                <label className="text-xs font-bold uppercase tracking-widest text-white/50">Tom de Análise</label>
                <select 
                  value={userProfile.style}
                  onChange={e => setUserProfile(p => ({ ...p, style: e.target.value }))}
                  className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl p-4 text-sm text-white focus:border-amber-500/50 outline-none transition-colors"
                >
                  <option value="Agressivo (Oceano Azul)">Agressivo (Explorar Oportunidades Ocultas)</option>
                  <option value="Conservador (Validação Segura)">Conservador (Onde está o dinheiro seguro?)</option>
                  <option value="Criativo (Tendências Virais)">Criativo (Marketing, Redes Sociais, Viral)</option>
                  <option value="Técnico (Dados e SEO)">Técnico (Dados brutos, SEO e Escala)</option>
                </select>
              </div>

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowSettings(false)} className="px-6 py-3 rounded-xl border border-white/10 text-white/60 hover:text-white hover:bg-white/5 text-xs font-bold uppercase tracking-widest transition-colors">
                  Fechar
                </button>
                <button type="submit" className="flex-1 bg-amber-500 hover:bg-amber-400 text-black px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors text-center">
                  Salvar Perfil
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Expanded Chart Modal */}
      {expandedChart && results && (
         <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-3xl p-4 sm:p-12 flex flex-col animate-in fade-in zoom-in-95 duration-300">
           <div className="flex justify-between items-center mb-8">
             <h2 className="text-xl font-serif text-white">{expandedChart === 'main' ? 'Tendência Macro de 12 Meses' : 'Oportunidades de Nicho'}</h2>
             <button onClick={() => setExpandedChart(null)} className="p-2 border border-white/10 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors">
               <X className="w-6 h-6" />
             </button>
           </div>
           
           <div className="flex-1 w-full bg-[#111111] p-4 sm:p-8 rounded-3xl border border-white/5">
              <ResponsiveContainer width="100%" height="100%">
                 {expandedChart === 'main' ? (
                   <LineChart data={results.trends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" vertical={false} />
                      <XAxis dataKey="time" stroke="#ffffff33" tick={{ fill: '#ffffff66', fontSize: 12 }} />
                      <YAxis stroke="#ffffff33" tick={{ fill: '#ffffff66', fontSize: 12 }} />
                      <RechartsTooltip contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#ffffff1a' }} />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />
                      {results.keywords.map((kw, idx) => (
                        <Line key={kw} type="monotone" dataKey={kw} stroke={colors[idx % colors.length]} strokeWidth={3} dot={false} activeDot={{ r: 8, strokeWidth: 0, fill: colors[idx % colors.length] }} />
                      ))}
                    </LineChart>
                 ) : (
                    <BarChart data={insights?.nichesChart} layout="vertical" margin={{ left: 60, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" horizontal={true} vertical={false} />
                      <XAxis type="number" domain={[0, 100]} stroke="#ffffff33" />
                      <YAxis dataKey="name" type="category" stroke="#ffffff66" width={150} tick={{ fill: '#ffffff99', fontSize: 13 }} />
                      <RechartsTooltip cursor={{fill: '#ffffff0a'}} contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#ffffff1a', borderRadius: '8px', color: '#e0e0e0' }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {insights?.nichesChart.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                 )}
              </ResponsiveContainer>
           </div>
         </div>
      )}

      {/* Footer Bar */}
      <footer className="h-12 bg-[#0d0d0d] border-t border-white/10 flex items-center justify-between px-6 sm:px-10 text-[9px] sm:text-[10px] uppercase tracking-widest opacity-50 mt-auto flex-shrink-0">
        <div>TrendIntel AI • {new Date().getFullYear()}</div>
        <div className="flex gap-4 sm:gap-8">
          <span className="hidden sm:inline">Session: Active</span>
          <span className="text-amber-500 font-bold">● Live Data Feed</span>
        </div>
      </footer>
    </div>
  );
}

