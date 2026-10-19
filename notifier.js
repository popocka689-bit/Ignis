const https = require('https');

const DB_URL = "https://ignis-d092d-default-rtdb.firebaseio.com";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = ["7004092933", "8030931820"];
const MINI_APP_URL = "https://popocka689-bit.github.io/Ignis/";

// Пул киберпанк / tech артов для утреннего дайджеста
const CYBERPUNK_MORNING_IMAGES = [
  "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?q=80&w=1080&auto=format&fit=crop", // Неоновый ночной мегаполис
  "https://images.unsplash.com/photo-1514565131-fce0801e5785?q=80&w=1080&auto=format&fit=crop", // Киберпанк улочка в неоне
  "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=1080&auto=format&fit=crop", // Неоновый геометрический туннель
  "https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=1080&auto=format&fit=crop", // Футуристический скайлайн
  "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?q=80&w=1080&auto=format&fit=crop", // Терминал и матричный код
  "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?q=80&w=1080&auto=format&fit=crop", // Красный Nothing / Dark неон
  "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?q=80&w=1080&auto=format&fit=crop", // Дождливый неоновый город
  "https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=1080&auto=format&fit=crop"  // Киберпанк арт
];

function esc(str) {
  return String(str ?? '').replace(/[&<>]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  }[c]));
}

function fetchData(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function putData(url, data) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(data);
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

function callTelegram(method, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(!!JSON.parse(data).ok); }
        catch (e) { resolve(false); }
      });
    });

    req.on('error', () => resolve(false));
    req.write(payload);
    req.end();
  });
}

function sendMessage(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return callTelegram('sendMessage', body);
}

function sendPhoto(chatId, photoUrl, caption, replyMarkup = null) {
  const body = { chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return callTelegram('sendPhoto', body);
}

async function sendDigest(chatId, photoUrl, text, replyMarkup) {
  // Лимит Telegram на подпись к фото - 1024 символа
  if (photoUrl && text.length <= 1024) {
    const success = await sendPhoto(chatId, photoUrl, text, replyMarkup);
    if (success) return;
  }
  // Если отправка фото не удалась или текст длиннее 1024 символов - отправляем надежным текстом
  await sendMessage(chatId, text, replyMarkup);
}

function extractEndTime(lessons) {
  const active = lessons.filter(l => l && l.status !== 'canceled');
  if (active.length === 0) return null;
  const last = active[active.length - 1];
  const parts = String(last.time ?? '').split(/[-—–]/);
  return parts.length >= 2 ? parts[1].trim() : null;
}

async function run() {
  if (!BOT_TOKEN) {
    console.log("BOT_TOKEN не настроен!");
    return;
  }

  const isManualRun = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';

  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const localMinutes = (utcMinutes + 5 * 60) % (24 * 60); // Время +05:00

  const localDate = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = localDate.getUTCDay();

  if ((day === 0 || day === 6) && !isManualRun) {
    console.log("Выходной день.");
    return;
  }

  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const dateNum = String(localDate.getUTCDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${dateNum}`;

  // Окно отправки утреннего дайджеста: с 06:00 (360 мин) до 09:30 (570 мин) по времени +05:00.
  // Благодаря запуску cron каждые 15 минут с 06:00 утра дайджест приходит в районе 06:00–06:30,
  // а широкое окно страхует от любых задержек очередей GitHub Actions.
  if (!isManualRun && (localMinutes < 360 || localMinutes > 570)) {
    console.log(`Вне окна утреннего дайджеста (сейчас ${Math.floor(localMinutes / 60)}:${String(localMinutes % 60).padStart(2, '0')}).`);
    return;
  }

  const [timetable, squadData, cloudAdmins, logsData] = await Promise.all([
    fetchData(`${DB_URL}/timetable.json`),
    fetchData(`${DB_URL}/squad.json`),
    fetchData(`${DB_URL}/admins.json`),
    fetchData(`${DB_URL}/digest_logs.json`)
  ]);

  if (!isManualRun && logsData && logsData.lastDigest === dateKey) {
    console.log(`Утренний дайджест за ${dateKey} уже был отправлен.`);
    return;
  }

  const recipients = new Set(ADMIN_IDS);
  if (squadData) {
    Object.keys(squadData).forEach(uid => recipients.add(String(uid)));
  }
  if (cloudAdmins) {
    Object.keys(cloudAdmins).forEach(uid => recipients.add(String(uid)));
  }

  const targetDay = (day >= 1 && day <= 5) ? day : 1;
  const todayLessons = (timetable && Array.isArray(timetable[targetDay])) ? timetable[targetDay].filter(Boolean) : [];

  const daysNames = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
  const currentDayName = daysNames[day];

  let lessonsBlock = "";
  if (todayLessons.length === 0) {
    lessonsBlock = "<i>Пар на сегодня не запланировано — свободный день!</i>";
  } else {
    lessonsBlock = todayLessons.map((l, i) => {
      const isCanc = l.status === 'canceled';
      const base = `${i + 1}. <b>${esc(l.name)}</b> ${isCanc ? '❌ <i>[ОТМЕНЕНА]</i>' : `[${esc(l.cab)}]`} • <code>${esc(l.time)}</code>`;
      const extra = [];
      if (!isCanc && l.teacher) extra.push(`👤 ${esc(l.teacher)}`);
      if (!isCanc && l.note) extra.push(`📝 <i>${esc(l.note)}</i>`);
      return extra.length > 0 ? `${base}\n   └ ${extra.join(' • ')}` : base;
    }).join("\n");
  }

  const finishTime = extractEndTime(todayLessons);
  const finishLine = finishTime
    ? `\n\n🏁 <b>Освобождаемся сегодня в:</b> <code>${esc(finishTime)}</code>`
    : '';

  const digestText = `⚡ <b>IGNIS // УТРЕННЯЯ СВОДКА ВЗВОДА G-13</b>\n` +
                     `<code>${currentDayName} • ${dateNum}.${month}.${year}</code>\n\n` +
                     `🗓 <b>РАСПИСАНИЕ НА СЕГОДНЯ:</b>\n` +
                     `${lessonsBlock}` +
                     `${finishLine}\n\n` +
                     `<i>Бодрого утра, боец! Не забудь отметиться в RADAR на паре 📍</i>`;

  const imageIndex = (parseInt(dateNum, 10) + parseInt(month, 10)) % CYBERPUNK_MORNING_IMAGES.length;
  const morningPhoto = CYBERPUNK_MORNING_IMAGES[imageIndex];

  const digestKeyboard = {
    inline_keyboard: [
      [
        { text: "⚡ Открыть IGNIS", web_app: { url: MINI_APP_URL } }
      ]
    ]
  };

  for (const uid of recipients) {
    await sendDigest(uid, morningPhoto, digestText, digestKeyboard);
  }

  await putData(`${DB_URL}/digest_logs.json`, { lastDigest: dateKey });
  console.log(`Утренний дайджест за ${dateKey} успешно отправлен (${recipients.size} получателей).`);
}

run();
