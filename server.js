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

  if (/x|=/.test(text) && /\d/.test(text)) {
    if (language === 'French') return `Je vois ton étape « ${raw} ». Explique-moi en une phrase quelle opération tu viens d'appliquer aux deux côtés ; je te dirai si elle est correcte et quelle est la prochaine étape.`;
    if (language === 'Arabic') return `أرى خطوتك «${raw}». أخبرني بجملة واحدة ما العملية التي طبّقتها على الطرفين، وسأتحقق منها ثم أعطيك الخطوة التالية.`;
    return `I can see your step: “${raw}”. Tell me what operation you applied to both sides, and I’ll check that exact step and guide you to the next one.`;
  }

  if (text.includes('fraction')) {
    if (language === 'French') return 'Une fraction représente une partie d’un tout. Le nombre du haut est le numérateur et celui du bas le dénominateur. Par exemple, 3/4 signifie 3 parts sur 4 parts égales. Si tu veux additionner deux fractions, quelle est la première chose à vérifier à propos des dénominateurs ?';
    if (language === 'Arabic') return 'الكسر يمثل جزءًا من كل. العدد في الأعلى هو البسط، والعدد في الأسفل هو المقام. مثلًا 3/4 تعني 3 أجزاء من أصل 4 أجزاء متساوية. إذا أردنا جمع كسرين، ما أول شيء يجب أن نتحقق منه في المقامات؟';
    return 'A fraction represents part of a whole. The top number is the numerator and the bottom number is the denominator. For example, 3/4 means 3 out of 4 equal parts. If you want to add two fractions, what is the first thing you should check about the denominators?';
  }

  if (language === 'French') return 'Je vais suivre ton raisonnement étape par étape. Écris seulement ta première étape, même si tu n’es pas sûr(e), et je la vérifierai.';
  if (language === 'Arabic') return 'سأتابع معك خطوة بخطوة. اكتب أول خطوة تفكر بها حتى لو لم تكن متأكدًا، وسأتحقق منها.';
  return 'Let’s do this one step at a time. Write just your first step, even if you are not sure, and I’ll check that specific step rather than repeat the question.';
}

function scienceFallback(message, language, history = []) {
  const raw = String(message || '').trim();
  const text = compact(raw);
  const previous = recentUserMessages(history).join(' ').toLowerCase();

  const reproductive = text.includes('reproductive') || text.includes('reproduction') || previous.includes('reproductive system');
  if (reproductive) {
    if (language === 'French') return 'Le système reproducteur est l’ensemble des organes qui permettent la reproduction. Chez l’être humain, les appareils reproducteurs masculin et féminin produisent des cellules reproductrices et participent à la fécondation. À ton niveau, on peut l’étudier par ses organes, leurs fonctions et la puberté. Veux-tu commencer par l’appareil masculin, féminin, ou par le rôle général de chacun ?';
    if (language === 'Arabic') return 'الجهاز التناسلي هو مجموعة الأعضاء التي تسمح بعملية التكاثر. عند الإنسان، ينتج الجهازان التناسليان الذكري والأنثوي الخلايا التناسلية ويساهمان في الإخصاب. يمكننا دراسته من خلال الأعضاء ووظائفها والتغيرات في مرحلة البلوغ. هل تريد أن نبدأ بالجهاز الذكري أم الأنثوي أم بالوظيفة العامة لكل منهما؟';
    return 'The reproductive system is the group of organs involved in reproduction. In humans, the male and female reproductive systems produce reproductive cells and take part in fertilization. At Grade 7 level, we can study the main organs, what each one does, and the changes that happen during puberty. Would you like to start with the male system, the female system, or the overall function of both?';
  }

  if (text.includes('photosynthesis') || previous.includes('photosynthesis')) {
    if (language === 'French') return 'La photosynthèse permet aux plantes d’utiliser la lumière pour fabriquer du glucose à partir de CO2 et d’eau, tout en libérant de l’oxygène. Les chloroplastes des feuilles jouent un rôle central. Quelle source d’énergie déclenche ce processus ?';
    if (language === 'Arabic') return 'البناء الضوئي هو استخدام النبات للطاقة الضوئية لصنع الجلوكوز من ثاني أكسيد الكربون والماء، مع إطلاق الأكسجين. وتلعب البلاستيدات الخضراء في الأوراق دورًا أساسيًا. ما مصدر الطاقة الذي يبدأ هذه العملية؟';
    return 'Photosynthesis is how plants use light energy to make glucose from carbon dioxide and water, releasing oxygen. Chloroplasts in the leaves play a central role. What source of energy starts this process?';
  }

  if (text.includes('digest') || previous.includes('digest')) {
    if (language === 'French') return 'Le système digestif transforme les aliments en nutriments que le corps peut absorber et utiliser. Le trajet principal est bouche → œsophage → estomac → intestin grêle → gros intestin. Où penses-tu que la plus grande partie des nutriments est absorbée ?';
    if (language === 'Arabic') return 'الجهاز الهضمي يحول الطعام إلى مواد غذائية يستطيع الجسم امتصاصها واستخدامها. المسار الرئيسي هو: الفم ← المريء ← المعدة ← الأمعاء الدقيقة ← الأمعاء الغليظة. أين تعتقد أن معظم المواد الغذائية يتم امتصاصها؟';
    return 'The digestive system breaks food down into nutrients the body can absorb and use. The main path is mouth → esophagus → stomach → small intestine → large intestine. Where do you think most nutrients are absorbed?';
  }

  if (text.includes('cell') || previous.includes('cell')) {
    if (language === 'French') return 'Une cellule est l’unité de base du vivant. Elle possède une membrane, du cytoplasme et, dans de nombreuses cellules, un noyau contenant l’information génétique. Quelle structure contrôle ce qui entre et sort de la cellule ?';
    if (language === 'Arabic') return 'الخلية هي الوحدة الأساسية للحياة. تحتوي على غشاء وسيتوبلازم، وفي كثير من الخلايا نواة تحمل المعلومات الوراثية. ما الجزء الذي يتحكم بما يدخل إلى الخلية وما يخرج منها؟';
    return 'A cell is the basic unit of life. It has a membrane, cytoplasm, and in many cells a nucleus containing genetic information. Which structure controls what enters and leaves the cell?';
  }

  if (/practice|quiz|question/.test(text)) {
    if (language === 'French') return 'Question de pratique : pourquoi le cœur et les poumons doivent-ils travailler ensemble pendant un exercice physique ? Donne-moi ton idée en une ou deux phrases.';
    if (language === 'Arabic') return 'سؤال للتدريب: لماذا يجب أن يعمل القلب والرئتان معًا أثناء التمرين الرياضي؟ أعطني فكرتك في جملة أو جملتين.';
    return 'Practice question: Why do the heart and lungs need to work together during exercise? Give me your idea in one or two sentences.';
  }

  if (recentUserMessages(history).length > 0) {
    if (language === 'French') return `Je veux rester sur ton sujet de science. Tu parles de « ${raw} ». Dis-moi si tu veux une explication, un exemple ou une question de pratique, et je continuerai sur ce sujet.`;
    if (language === 'Arabic') return `سأبقى في موضوع العلوم الذي اخترته. أنت تسأل عن «${raw}». أخبرني هل تريد شرحًا، مثالًا، أم سؤالًا للتدريب، وسأكمل في نفس الموضوع.`;
    return `Let’s stay with your science topic: “${raw}”. Tell me whether you want an explanation, an example, or a practice question, and I’ll continue on that topic.`;
  }

  if (language === 'French') return `Tu as choisi Sciences et demandé « ${raw} ». Je peux l’expliquer simplement, donner un exemple, ou te poser une question de vérification. Que préfères-tu ?`;
  if (language === 'Arabic') return `لقد اخترت العلوم وسألت عن «${raw}». يمكنني شرحه ببساطة، إعطاء مثال، أو طرح سؤال للتأكد من الفهم. ماذا تفضل؟`;
  return `You chose Science and asked about “${raw}”. I can explain it simply, give an example, or ask you a quick check question. Which would you like?`;
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
