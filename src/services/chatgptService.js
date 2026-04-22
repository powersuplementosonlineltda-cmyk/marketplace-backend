function extractResponseText(data) {
  if (data?.output_text && String(data.output_text).trim()) {
    return String(data.output_text).trim();
  }

  const output = Array.isArray(data?.output) ? data.output : [];
  const parts = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (typeof c?.text === 'string' && c.text.trim()) {
        parts.push(c.text.trim());
      }
      if (typeof c?.output_text === 'string' && c.output_text.trim()) {
        parts.push(c.output_text.trim());
      }
    }
  }

  return parts.join('\n').trim();
}

async function generateStrategyWithChatGPT({ shopId, profile, recommendations }) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return { enabled: false, message: 'OPENAI_API_KEY not set' };
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const prompt = [
    'You are a senior Shopee Ads strategist.',
    `Shop ID: ${shopId}`,
    'Profile JSON:',
    JSON.stringify(profile || {}, null, 2),
    'Recommendations JSON:',
    JSON.stringify(recommendations || [], null, 2),
    'Return concise strategy in Portuguese with: priorities, risks, and next 24h actions.',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 900,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return {
      enabled: true,
      error: data?.error?.message || 'ChatGPT API error',
    };
  }

  const text = extractResponseText(data);
  return {
    enabled: true,
    model,
    text,
  };
}

async function chatWithAdsSpecialist({ shopId, message, context }) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      enabled: false,
      message:
        'OPENAI_API_KEY not set. Configure the key to enable conversational analysis with ChatGPT.',
      fallback:
        'Sem ChatGPT conectado. Posso seguir com analise baseada em regras: treinar, recomendar, aprovar e executar com confirmacao em duas etapas.',
    };
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const prompt = [
    'You are an expert Marketplace Ads operator focused on Shopee Ads.',
    'Speak in Brazilian Portuguese, concise and practical.',
    'IMPORTANT: Never ask the user to confirm or authorize anything. Just answer directly.',
    'IMPORTANT: The Shopee Ads API does NOT expose account balance (saldo). If asked about saldo, explain this and refer the user to Shopee Seller Center > Anúncios > Conta de Anúncios. Use account_summary.total_spend_period as reference for recent spend.',
    'METRICS AVAILABLE per campaign: expense (gasto), broad_gmv (GMV amplo), direct_gmv (GMV direto), roas (retorno amplo), direct_roas (retorno direto), acos (% custo/GMV), ctr (taxa de cliques), cpc (custo por clique), conversion (taxa conversão), direct_cr (conversão direta), cpdc (custo por conversão direta), avg_daily_spend (gasto médio diário), broad_order (pedidos), direct_order (pedidos diretos).',
    `Shop ID: ${shopId}`,
    'User message:',
    String(message || ''),
    'Operational context JSON:',
    JSON.stringify(context || {}, null, 2),
    'Return: diagnosis, priorities, and a safe action plan. Do NOT ask for confirmation or authorization in your response.',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: 1200,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return {
      enabled: true,
      error: data?.error?.message || 'ChatGPT API error',
    };
  }

  return {
    enabled: true,
    model,
    text: extractResponseText(data),
  };
}

module.exports = { generateStrategyWithChatGPT, chatWithAdsSpecialist };
