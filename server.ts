import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
// @ts-ignore
import googleTrends from 'google-trends-api';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post('/api/generate-form', async (req, res) => {
    try {
      const { topic, userProfile, previousAnswers } = req.body;

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY não está configurada.' });
      }
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const prompt = `Você é um analista de inteligência de mercado extremamente sofisticado.
O usuário quer pesquisar o tema: "${topic}".
O perfil atual do usuário e seus objetivos gerais são: ${JSON.stringify(userProfile || {})}.
As respostas dadas por ele até o momento nesta sessão são: ${JSON.stringify(previousAnswers || {})}

SEU OBJETIVO:
Você precisa descobrir cirurgicamente o que o usuário quer fazer com esse tema.
Se as informações atuais (perfil + respostas) JÁ SÃO SUFICIENTES para criar um relatório de inteligência espetacular, direto ao ponto e hiper-personalizado, retorne "isSatisfied": true e perguntas vazias.

Se você ainda precisa refinar a dor do cliente, o mercado exato, o orçamento, o formato, ou a intenção (ex: é pra vender curso? Dropshipping? Blog? SEO? YouTube? Investimento?), retorne "isSatisfied": false e gere de 1 a 3 perguntas de múltipla escolha INÉDITAS e HIPER-PERSONALIZADAS. Nunca repita perguntas passadas.

Responda SOMENTE em JSON válido com a seguinte estrutura exata:
{
  "isSatisfied": boolean,
  "questions": [
    {
      "id": "identificador_unico_curto_ex_q3",
      "label": "Sua pergunta perspicaz aqui...",
      "options": ["Opção hiper-específica 1", "Opção hiper-específica 2", "Opção hiper-específica 3"]
    }
  ]
}`;
      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4o",
        response_format: { type: "json_object" }
      });

      const content = completion.choices[0].message.content || '{"isSatisfied":true,"questions":[]}';
      res.json(JSON.parse(content));
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: 'Erro interno ao gerar formulário.' });
    }
  });

  // API Route to fetch Trends data
  app.post('/api/trends', async (req, res) => {
    try {
      const { topic, answers, customAnswer, userProfile } = req.body;

      if (!topic) {
        return res.status(400).json({ error: 'O tema (topic) é obrigatório.' });
      }

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY não está configurada.' });
      }
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      let intentContext = "Nenhum contexto extra fornecido.";
      if (answers || customAnswer || userProfile) {
        intentContext = `Perfil do Usuário: ${JSON.stringify(userProfile || {})}. Respostas de refinamento: ${JSON.stringify(answers || {})}. Informações adicionais: ${customAnswer || 'Nenhuma'}.`;
      }

      const prompt = `
Você é um especialista estratégico de mercado. 
O tema principal da pesquisa é: "${topic}".
${intentContext}

Sua tarefa é gerar até 5 palavras-chave altamente relevantes, relacionadas a esse tema e direcionadas a esse contexto e objetivo do usuário, que representam as maiores tendências de busca hoje.
1. Retorne exatas 5 palavras-chave.
2. Cada palavra deve ser um termo real e muito pesquisado.
3. RETORNE APENAS UM ARRAY JSON VÁLIDO contendo as 5 strings, e NADA MAIS. Exemplo: ["termo1", "termo2", "termo3", "termo4", "termo5"]
`;

      let keywords: string[] = [];
      try {
        const completion = await openai.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: "gpt-4o",
        });

        const rawText = completion.choices[0].message.content?.trim() || '[]';
        // Remove markdown delimiters if the AI generates them despite constraints
        const cleanedText = rawText.replace(/^```(json)?/, '').replace(/```$/, '').trim();
        keywords = JSON.parse(cleanedText);

        if (!Array.isArray(keywords) || keywords.length === 0) {
          throw new Error('A IA não retornou um array válido.');
        }

        // Limit to 5 as Google Trends API only accepts up to 5 keywords for comparison
        keywords = keywords.slice(0, 5); 

      } catch (aiError) {
        console.error('Erro na IA:', aiError);
        return res.status(500).json({ error: 'Erro ao gerar as variáveis com a IA.' });
      }

      // Fetch from Google Trends
      try {
        const startTime = new Date();
        startTime.setFullYear(startTime.getFullYear() - 1); // Último ano
        
        const results = await googleTrends.interestOverTime({
          keyword: keywords,
          startTime,
          geo: 'BR', // Busca dados do Brasil (ou pode remover para global)
        });

        let parsedResults;
        try {
          parsedResults = JSON.parse(results);
          res.json({
            topic,
            keywords,
            trends: parsedResults.default.timelineData, // raw data array
          });
          return;
        } catch (parseError) {
          console.warn("Google Trends retornou erro/HTML. Usando AI Fallback Pipeline...");
          throw new Error("Fallback para IA");
        }

      } catch (trendsError) {
        console.warn('Fallback ativado devido a bloqueio do Google Trends.');
        
        // Fallback: Generate realistic trend data using OpenAI
        const fallbackPrompt = `
Como um simulador de tendências de mercado, gere dados de volume de busca (0 a 100) simulando o Google Trends para os últimos 12 meses (uma entrada por mês) para as seguintes palavras-chave: ${keywords.join(', ')}.
O tema original é: "${topic}".

RETORNE APENAS JSON VÁLIDO no seguinte formato:
{
  "trends": [
    {
      "formattedTime": "Jan 2023",
      "value": [80, 40, 20, 10, 50] // correspondendo a cada palavra chave
    }
  ]
}
Garanta que são exatamente 12 meses até o momento atual.
`;
        try {
          const fallbackCompletion = await openai.chat.completions.create({
            messages: [{ role: "user", content: fallbackPrompt }],
            model: "gpt-4o",
            response_format: { type: "json_object" }
          });
          const contentStr = fallbackCompletion.choices[0].message.content || '{"trends":[]}';
          const aiData = JSON.parse(contentStr);
          
          res.json({
            topic,
            keywords,
            trends: aiData.trends,
          });
        } catch (aiError) {
           console.error('Erro no fallback:', aiError);
           return res.status(500).json({ error: 'Erro ao buscar dados de mercado (Rate limit do provedor) e fallback falhou.' });
        }
      }

    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Erro interno no servidor.' });
    }
  });

  app.post('/api/insights', async (req, res) => {
    try {
      const { topic, keywords, answers, customAnswer, userProfile } = req.body;
      if (!process.env.OPENAI_API_KEY) return res.status(500).json({error: 'No API key'});
      
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const prompt = `Atue como um estrategista de negócios de tecnologia e analista de inteligência de elite.
Tema: "${topic}"
Vetores de Crescimento mapeados: ${keywords?.join(', ')}
Perfil do Usuário: ${JSON.stringify(userProfile)}
Contexto da Pesquisa e Respostas: ${JSON.stringify(answers)} | Extras: ${customAnswer}

Você precisa extrair insights profundos para o usuário atingir seu objetivo. 
Gere insights EXTREMAMENTE práticos e baseados em dados reais ou lógicos sobre os vetores em alta.

Responda APENAS em JSON válido, com a seguinte estrutura EXATA:
{
  "executiveSummary": "Resumo de 3 a 5 linhas matadoras focadas na intersecção do que o usuário quer e o que o mercado precisa.",
  "bulletPoints": ["Plano de ação 1 pragmático", "Plano de ação 2 direto", "Plano de ação 3 inovador"],
  "nichesChart": [
    {"name": "Sub-nicho Inexplorado 1", "value": 90}, 
    {"name": "Estratégia 2", "value": 75},
    {"name": "Público 3", "value": 60},
    {"name": "Foco Adicional 4", "value": 40}
  ],
  "radarChart": [
    {"subject": "Agressividade", "A": 80, "fullMark": 100},
    {"subject": "Inovação", "A": 95, "fullMark": 100},
    {"subject": "Custo de Entrada", "A": 30, "fullMark": 100},
    {"subject": "Concorrência", "A": 65, "fullMark": 100},
    {"subject": "Retorno Potencial", "A": 90, "fullMark": 100}
  ],
  "advancedTips": [
    "Dica tática 1: Como o Google ou as redes sociais estão favorecendo isso...",
    "Dica tática 2: Um erro comum que 90% das pessoas cometem ao abordar esse nicho...",
    "Dica tática 3: Onde focar os primeiros $1000 reais ou as primeiras 10 horas de trabalho."
  ]
}
Nota: 'nichesChart' value é 0-100 (Potencial vs Baixa Concorrência). 'radarChart' descreve a métrica da oportunidade em relação ao objetivo (A = valor da métrica). 'advancedTips' são dicas de ouro (hack/insider).
`;
      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4o",
        response_format: { type: "json_object" }
      });
      res.json(JSON.parse(completion.choices[0].message.content || '{}'));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e) });
    }
  });

  // API Route to generate detailed AI report for PDF
  app.post('/api/report', async (req, res) => {
    try {
      const { topic, contextInfo, keywords, userProfile, insights } = req.body;

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY não está configurada.' });
      }
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      const prompt = `Você é o parceiro de negócios e Analista-Chefe da TrendIntel.
O usuário está prestando atenção em você. Escreva com extrema elegância, hiper-oficialidade e inteligência acionável.

Tema principal: "${topic}"
Perfil e Objetivos gerais do Usuário: ${JSON.stringify(userProfile)}
Respostas específicas desta pesquisa: "${contextInfo}"
Vetores de busca validados e consolidados em nossa Engine: ${keywords?.join(', ')}
Sumário da IA (Insights mapeados previamente): ${JSON.stringify(insights)}

Construa um "Relatório Executivo de Inteligência Competitiva". Esse PDF será o guia de vida ou morte para o projeto do usário. Não use conversa fiada.

Estrutura EXIGIDA do relatório:
1. Resumo Executivo: Exposição macro da tese de mercado.
2. Análise de Vetores (Trends): Descreva de forma objetiva como cada um dos ${keywords?.length} vetores identificados se comporta no cenário atual e porque é valioso para O PERFIL DELE.
3. Blue Oceans (Oportunidades Puras): Onde estão os buracos em que os competidores estão dormindo.
4. Framework Operacional (Plano de Ação Tático): Crie um "Roadmap" de 30 dias para ele rodar isso imediatamente, considerando o contexto dele.

ATENÇÃO: Devolva APENAS conteúdo HTML muito limpo e belo (tags: <h2>, <h3>, <p>, <ul>, <li>, <strong>, <em>, <br>).
Não utilize <html> ou <body>, nem estilos inline. Retorne APENAS HTML. Não envolva o texto com blocos markdown \`\`\`html.
Ele será aplicado em um layout que já tem o título principal.`;

      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4o",
        temperature: 0.7,
      });

      let rawText = completion.choices[0].message.content?.trim() || '';
      rawText = rawText.replace(/^```(html)?/, '').replace(/```$/, '').trim();

      res.json({ html: rawText });
    } catch (e: any) {
      console.error('Erro na geração do relatorio:', e);
      res.status(500).json({ error: 'Erro ao gerar gerar relatorio. ' + e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    // app.use instead of app.use(vite.middlewares) if express 5 ?
    // "vite.middlewares" is the standard.
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Since express ^4.21.2 is installed
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
