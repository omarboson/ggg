import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 20);
const counters = new Map();

app.use(express.json({ limit: '300kb' }));
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
  if (used >= DAILY_LIMIT) return { ok: false, remaining: 0 };
  counters.set(key, used + 1);
  return { ok: true, remaining: Math.max(0, DAILY_LIMIT - used - 1) };
}

function tutorPrompt({ grade, subject, language }) {
  return `You are Essential AI Tutor for a Grade ${grade} student studying ${subject}.

Teaching language: ${language}.

Your job is to teach naturally like an excellent patient tutor, not behave like a rigid script.
- Always understand short follow-ups from context. If you just offered a diagram and the student says "yes", show/explain that diagram topic. If they say "explanation", "example", "why", "picture", or "show me", continue the SAME topic.
- Match vocabulary and depth to Grade ${grade}.
- For a concept question, explain clearly first, then give a concrete example, then ask one short check-for-understanding question.
- For a homework/problem-solving question, guide one useful step at a time. Do not repeat "what have you tried?" if the student has already shown work.
- When the student gives a step, explicitly say whether that exact step is correct and why, then continue from there.
- For Science, proactively use concrete examples and visual thinking. When a diagram would help, clearly name the diagram and its labels/components so the app can render a matching visual when available.
- For Mathematics, use clean equations and brief worked sub-steps, but leave meaningful thinking for the student.
- Stay on the selected subject unless a brief clarification is necessary.
- Be concise enough for a phone screen: usually 80-180 words, shorter for simple follow-ups.
- Never claim access to school records, grades, or personal data that you were not given.
- If unsure, say so rather than inventing facts.`;
}

function compact(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '').replace(/[−–—]/g, '-');
}

function recentUserMessages(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && m.role === 'user')
    .map((m) => String(m.content || '').trim())
    .filter(Boolean)
    .slice(-6);
}

function fallbackTutor(message, subject, language, history = []) {
  const raw = String(message || '').trim();
  const text = compact(raw);
  const previousUsers = recentUserMessages(history);
  const previous = previousUsers.join(' ').toLowerCase();

  if (subject === 'Mathematics') {
    const thread = `${previous}|${text}`;
    if (/x=5/.test(text)) {
      return language === 'French' ? 'Oui — x = 5. Vérification : 3 × 5 + 7 = 22. Veux-tu essayer une équation semblable ?' :
        language === 'Arabic' ? 'صحيح — x = 5. للتحقق: 3 × 5 + 7 = 22. هل تريد مسألة مشابهة؟' :
        'Correct — x = 5. Quick check: 3 × 5 + 7 = 22. Want a similar equation?';
    }
    if (/3x=15/.test(text)) {
      return language === 'French' ? 'Oui, 3x = 15. Maintenant, quelle opération enlève le 3 devant x ?' :
        language === 'Arabic' ? 'نعم، 3x = 15. ما العملية التي تزيل 3 أمام x؟' :
        'Yes — 3x = 15. What operation removes the 3 in front of x?';
    }
    if (/3x=22-7|22-7/.test(text)) {
      return language === 'French' ? 'Bonne étape. Maintenant simplifie 22 − 7. À quoi est égal 3x ?' :
        language === 'Arabic' ? 'خطوة صحيحة. بسّط الآن 22 − 7. ما قيمة 3x؟' :
        'Good step. Now simplify 22 − 7. What does 3x equal?';
    }
    if (/3x\+?7=22/.test(thread)) {
      return language === 'French' ? 'Commençons par annuler le +7. Quelle opération fais-tu aux deux côtés ?' :
        language === 'Arabic' ? 'ابدأ بإلغاء +7. ما العملية التي تطبقها على الطرفين؟' :
        'Start by undoing the +7. What operation should you apply to both sides?';
    }
    if (text.includes('fraction')) {
      return language === 'French' ? 'Une fraction représente une partie d’un tout. Par exemple, 3/4 signifie 3 parts sur 4 parts égales. Pour additionner des fractions, que dois-tu vérifier d’abord à propos des dénominateurs ?' :
        language === 'Arabic' ? 'الكسر يمثل جزءًا من كل. مثلًا 3/4 تعني 3 أجزاء من 4 أجزاء متساوية. عند جمع الكسور، ما أول شيء تتحقق منه في المقامات؟' :
        'A fraction is part of a whole. For example, 3/4 means 3 out of 4 equal parts. When adding fractions, what should you check first about the denominators?';
    }
    return language === 'French' ? 'Écris ta prochaine étape et je vérifierai exactement cette étape.' :
      language === 'Arabic' ? 'اكتب خطوتك التالية وسأتحقق منها بالتحديد.' :
      'Write your next step and I’ll check that exact step.';
  }

  const context = `${previous} ${raw}`.toLowerCase();
  const wantsVisual = /picture|diagram|visual|show me|yes/.test(raw.toLowerCase());

  if (/plant|flower|stamen|anther|pollen/.test(context)) {
    if (wantsVisual) return 'For the male part of a flower, picture one stamen: the ANTHER sits at the top and makes pollen; the FILAMENT is the stalk holding the anther. Pollen carries the male reproductive cells. Look at the visual below: which labeled part actually produces the pollen?';
    return 'In flowering plants, the male reproductive part is the stamen. It has two main parts: the anther, which makes pollen, and the filament, which supports the anther. Pollen carries the male reproductive cells. A lily is a good example because its anthers are easy to see. Would you like the diagram?';
  }
  if (/photosynthesis|chloroplast/.test(context)) return 'Photosynthesis lets plants use light energy to make glucose from carbon dioxide and water, releasing oxygen. A leaf is like a small solar-powered food factory. The chloroplasts capture light. Which input comes from the air?';
  if (/digest|stomach|intestine/.test(context)) return 'The digestive system breaks food into nutrients the body can absorb. Food travels mouth → esophagus → stomach → small intestine → large intestine. Most nutrient absorption happens in the small intestine. Why do you think it has such a large internal surface?';
  if (/cell|nucleus|membrane/.test(context)) return 'A cell is the basic unit of life. The membrane controls what enters and leaves, the cytoplasm contains many reactions, and the nucleus stores genetic information in many cells. Think of the membrane like a controlled gate. What would happen if the gate could not regulate movement?';
  if (/reproductive|reproduction/.test(context)) return 'The reproductive system includes organs involved in producing reproductive cells and enabling fertilization. At Grade 7 level, we can study the main organs, their functions, and puberty-related changes. Would you like the male system, female system, or a simple diagram first?';

  return language === 'French' ? `Tu étudies « ${raw} ». Donne-moi une précision sur ce que tu veux comprendre et je continuerai sur ce même sujet.` :
    language === 'Arabic' ? `أنت تدرس «${raw}». أخبرني ما الجزء الذي تريد فهمه وسأكمل في نفس الموضوع.` :
    `You’re studying “${raw}”. Tell me the part you want to understand, and I’ll stay on that same topic.`;
}

function toInputMessage(role, text) {
  return {
    role,
    content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: String(text || '') }]
  };
}

function extractResponseText(data) {
  const texts = [];
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c?.type === 'output_text' && c.text) texts.push(c.text);
    }
  }
  return texts.join('\n').trim();
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
    const cleanHistory = Array.isArray(history)
      ? history.slice(-10).map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '').slice(0, 4000)
        }))
      : [];

    const input = [
      { role: 'system', content: [{ type: 'input_text', text: tutorPrompt({ grade, subject, language }) }] },
      ...cleanHistory.map((m) => toInputMessage(m.role, m.content)),
      { role: 'user', content: [{ type: 'input_text', text: String(message).slice(0, 6000) }] }
    ];

    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input,
        reasoning: { effort: 'low' },
        max_output_tokens: 900
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI provider returned ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const reply = extractResponseText(data);
    if (!reply) throw new Error('AI provider returned an empty response');

    return res.json({ reply, remaining: quota.remaining, mode: 'ai', model });
  } catch (error) {
    console.error('AI request failed:', error);
    return res.json({
      reply: fallbackTutor(message, subject, language, history),
      remaining: quota.remaining,
      mode: 'demo-fallback'
    });
  }
});

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  aiConfigured: Boolean(process.env.AI_API_KEY),
  model: process.env.AI_MODEL || 'gpt-5.6-luna',
  dailyLimit: DAILY_LIMIT
}));

app.listen(PORT, '0.0.0.0', () => console.log(`Essential AI Tutor running on port ${PORT}`));
