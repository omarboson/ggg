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

function compact(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '').replace(/[−–—]/g, '-');
}

function recentUserMessages(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'user')
    .map((m) => String(m.content || ''))
    .slice(-4);
}

function mathFallback(message, language, history = []) {
  const raw = String(message || '').trim();
  const text = compact(raw);
  const previous = recentUserMessages(history).map(compact).join(' | ');

  // Context-aware path for the demo equation shown in the UI.
  const isEquationThread = /3x\+?7=22|3x=22-7|3x=15|x=5/.test(`${previous}|${text}`);
  if (isEquationThread) {
    if (/x=5/.test(text)) {
      if (language === 'French') return 'Oui — x = 5. Vérification : 3 × 5 + 7 = 22. Tu as terminé le raisonnement. Veux-tu essayer une équation semblable ?';
      if (language === 'Arabic') return 'صحيح — x = 5. للتحقق: 3 × 5 + 7 = 22. أحسنت إنهاء الخطوات. هل تريد مسألة مشابهة؟';
      return 'Correct — x = 5. Quick check: 3 × 5 + 7 = 22. You finished the reasoning. Want a similar equation to try on your own?';
    }
    if (/3x=15/.test(text)) {
      if (language === 'French') return 'Oui, 3x = 15 est correct. Maintenant il faut isoler x. Quelle opération peux-tu faire aux deux côtés pour enlever le 3 ?';
      if (language === 'Arabic') return 'نعم، 3x = 15 صحيحة. الآن نريد عزل x. ما العملية التي تطبقها على الطرفين للتخلص من 3؟';
      return 'Yes — 3x = 15 is correct. Now isolate x. What operation should you apply to both sides to remove the 3?';
    }
    if (/3x=22-7|22-7/.test(text)) {
      if (language === 'French') return 'Bonne étape : tu as soustrait 7 des deux côtés. Maintenant simplifie 22 − 7. À quoi est égal 3x ?';
      if (language === 'Arabic') return 'خطوة صحيحة: طرحت 7 من الطرفين. الآن بسّط 22 − 7. ما قيمة 3x؟';
      return 'Good step: you subtracted 7 from both sides. Now simplify 22 − 7. What does 3x equal?';
    }
    if (/3x\+7=22|solve3x\+7=22/.test(text)) {
      if (language === 'French') return 'Commençons par isoler le terme avec x. Quelle opération annule le +7 des deux côtés ?';
      if (language === 'Arabic') return 'لنبدأ بعزل الحد الذي يحتوي على x. ما العملية التي تلغي +7 من الطرفين؟';
      return 'Start by isolating the term with x. What operation would undo the +7 on both sides?';
    }
  }

  // Recognize a student showing any algebra attempt instead of repeating the opening question.
  if (/x|=/.test(text) && /\d/.test(text)) {
    if (language === 'French') return `Je vois ton étape « ${raw} ». Explique-moi en une phrase quelle opération tu viens d'appliquer aux deux côtés ; je te dirai si elle est correcte et quelle est la prochaine étape.`;
    if (language === 'Arabic') return `أرى خطوتك «${raw}». أخبرني بجملة واحدة ما العملية التي طبّقتها على الطرفين، وسأتحقق منها ثم أعطيك الخطوة التالية.`;
    return `I can see your step: “${raw}”. Tell me what operation you applied to both sides, and I’ll check that exact step and guide you to the next one.`;
  }

  if (text.includes('fraction')) {
    if (language === 'French') return 'Regardons d’abord les dénominateurs. Sont-ils déjà identiques, ou faut-il trouver un dénominateur commun ?';
    if (language === 'Arabic') return 'لننظر أولاً إلى المقامات. هل هي متساوية أم نحتاج إلى مقام مشترك؟';
    return 'Let’s work it out together. First look at the denominators. Are they already the same, or do we need a common denominator?';
  }

  if (language === 'French') return 'Je vais suivre ton raisonnement étape par étape. Écris seulement ta première étape, même si tu n’es pas sûr(e), et je la vérifierai.';
  if (language === 'Arabic') return 'سأتابع معك خطوة بخطوة. اكتب أول خطوة تفكر بها حتى لو لم تكن متأكدًا، وسأتحقق منها.';
  return 'Let’s do this one step at a time. Write just your first step, even if you are not sure, and I’ll check that specific step rather than repeat the question.';
}

function scienceFallback(message, language, history = []) {
  const text = compact(message);
  const hasHistory = recentUserMessages(history).length > 0;
  if (text.includes('photosynthesis')) {
    if (language === 'French') return 'La photosynthèse permet aux plantes d’utiliser la lumière pour fabriquer du glucose à partir de CO2 et d’eau. Quelle partie de la plante capte la plupart de la lumière ?';
    if (language === 'Arabic') return 'البناء الضوئي هو استخدام النبات للضوء لصنع الجلوكوز من ثاني أكسيد الكربون والماء. أي جزء من النبات يلتقط معظم الضوء؟';
    return 'Photosynthesis is how plants use light energy to make glucose from carbon dioxide and water. Which part of the plant captures most of the light?';
  }
  if (hasHistory) {
    if (language === 'French') return 'Je suis ton raisonnement. Donne-moi ta prochaine idée ou observation, et je te dirai précisément ce qui est juste et ce qu’il faut corriger.';
    if (language === 'Arabic') return 'أنا أتابع تفكيرك. أعطني فكرتك أو ملاحظتك التالية، وسأوضح بدقة ما هو صحيح وما يحتاج إلى تصحيح.';
    return 'I’m following your reasoning. Give me your next idea or observation, and I’ll respond to that exact step rather than restart the explanation.';
  }
  if (language === 'French') return 'Explique-moi ce que tu penses qu’il se passe d’abord. Ensuite je t’aiderai à vérifier l’étape suivante.';
  if (language === 'Arabic') return 'أخبرني أولاً ماذا تعتقد أنه يحدث، ثم سأساعدك في التحقق من الخطوة التالية.';
  return 'Tell me what you think is happening first, and I’ll help you check the next step.';
}

function fallbackTutor(message, subject, language, history = []) {
  return subject === 'Science'
    ? scienceFallback(message, language, history)
    : mathFallback(message, language, history);
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
      reply: fallbackTutor(message, subject, language, history),
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
      reply: fallbackTutor(message, subject, language, history),
      remaining: quota.remaining,
      mode: 'demo-fallback'
    });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.AI_API_KEY), dailyLimit: DAILY_LIMIT }));

app.listen(PORT, '0.0.0.0', () => console.log(`Essential AI Tutor running on port ${PORT}`));
