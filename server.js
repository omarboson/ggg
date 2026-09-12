import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 20);
const counters = new Map();

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getClientId(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || 'demo-user';
}

function takeQuota(clientId) {
  const key = `${todayKey()}:${clientId}`;
  const used = counters.get(key) || 0;
  if (used >= DAILY_LIMIT) return { ok: false, used, remaining: 0 };
  counters.set(key, used + 1);
  return { ok: true, used: used + 1, remaining: Math.max(0, DAILY_LIMIT - used - 1) };
}

function tutorPrompt({ grade, subject, language }) {
  return `You are Essential AI Tutor, a patient school tutor for Grade ${grade}, ${subject}.\n\n` +
    `Teaching language: ${language}. Keep vocabulary suitable for Grade ${grade}.\n` +
    `You are a coach, not an answer machine. For homework-style problems, do not give the final answer immediately. Start with one useful hint or one guiding question. If the student shows work, diagnose the exact misconception and guide one step at a time. For concept questions, give a short clear explanation and then ask one checking question.\n` +
    `Use short paragraphs and examples. Praise specific reasoning, not generic effort. If unsure, say so. Stay on ${subject} and redirect unrelated requests. Never claim to know the student's grades or private school records.\n` +
    `For mathematics, use simple notation. For science, explain cause-and-effect clearly. End most replies with one small question that keeps the student thinking.`;
}

function fallbackTutor(message, subject, language) {
  const text = String(message || '').toLowerCase();
  const lang = language === 'Arabic' ? 'ar' : language === 'French' ? 'fr' : 'en';
  const responses = {
    en: {
      math: text.includes('fraction')
        ? 'Let’s work it out together. First, look at the denominators. Are they already the same, or do we need a common denominator?'
        : 'I can help step by step. What have you tried so far, and at which step did you get stuck?',
      science: text.includes('photosynthesis')
        ? 'Photosynthesis is how green plants use light energy to make sugar from carbon dioxide and water. Which part of the plant do you think captures most of the light?'
        : 'Let’s make the idea clearer. Tell me what you think is happening first, and I’ll help you check the next step.'
    },
    fr: {
      math: 'On va le faire étape par étape. Qu’as-tu déjà essayé, et à quelle étape es-tu bloqué(e) ?',
      science: 'Explique-moi d’abord ce que tu penses qu’il se passe. Ensuite, je t’aiderai à vérifier l’étape suivante.'
    },
    ar: {
      math: 'لنحلّها خطوة خطوة. ماذا جرّبت حتى الآن، وفي أي خطوة توقفت؟',
      science: 'أخبرني أولاً ماذا تعتقد أنه يحدث، ثم سأساعدك في التحقق من الخطوة التالية.'
    }
  };
  return responses[lang][subject === 'Science' ? 'science' : 'math'];
}

app.post('/api/chat', async (req, res) => {
  const { message, grade = 7, subject = 'Mathematics', language = 'English', history = [] } = req.body || {};
  if (!message || String(message).trim().length < 2) {
    return res.status(400).json({ error: 'Please enter a question.' });
  }

  const quota = takeQuota(getClientId(req));
  if (!quota.ok) {
    return res.status(429).json({ error: `Daily demo limit reached (${DAILY_LIMIT} questions).`, remaining: 0 });
  }

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-5.6-luna';

  if (!apiKey) {
    return res.json({
      reply: fallbackTutor(message, subject, language),
      remaining: quota.remaining,
      mode: 'demo'
    });
  }

  try {
    const cleanHistory = Array.isArray(history) ? history.slice(-8).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 3000)
    })) : [];

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: tutorPrompt({ grade, subject, language }) },
          ...cleanHistory,
          { role: 'user', content: String(message).slice(0, 5000) }
        ],
        temperature: 0.4,
        max_tokens: 650
      })
    });

    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('AI provider returned an empty response');

    res.json({ reply, remaining: quota.remaining, mode: 'ai' });
  } catch (error) {
    console.error(error);
    res.json({
      reply: fallbackTutor(message, subject, language),
      remaining: quota.remaining,
      mode: 'demo-fallback'
    });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.AI_API_KEY), dailyLimit: DAILY_LIMIT }));

app.listen(PORT, '0.0.0.0', () => console.log(`Essential AI Tutor running on port ${PORT}`));
