const https = require('https');

const DB_URL = "https://ignis-d092d-default-rtdb.firebaseio.com";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = ["7004092933", "8030931820"];

function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    }).on('error', reject);
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
    }, res => resolve());
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

function sendMessage(chatId, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    });

    const req = https.request(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => resolve());

    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

function parseTimeToMinutes(tStr) {
  const match = tStr.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

async function run() {
  if (!BOT_TOKEN) {
    console.log("BOT_TOKEN не настроен!");
    return;
  }

  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const localMinutes = (utcMinutes + 5 * 60) % (24 * 60); // Часовой пояс +05:00

  const localDate = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = localDate.getUTCDay();

  if (day === 0 || day === 6) {
    console.log("Выходной день.");
    return;
  }

  const [timetable, squadData, tasksData, logsData] = await Promise.all([
    fetchData(`${DB_URL}/timetable.json`),
    fetchData(`${DB_URL}/squad.json`),
    fetchData(`${DB_URL}/tasks.json`),
    fetchData(`${DB_URL}/digest_logs.json`)
  ]);

  // Формируем список получателей (squad + админы)
  const recipients = new Set(ADMIN_IDS);
  if (squadData) {
    Object.keys(squadData).forEach(uid => recipients.add(uid));
  }

  const todayLessons = (timetable && timetable[day]) ? timetable[day] : [];

  // ==========================================
  // 1. УТРЕННИЙ ДАЙДЖЕСТ (ОКНО 07:25 - 07:45)
  // ==========================================
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const dateNum = String(localDate.getUTCDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${dateNum}`;

  const daysNames = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
  const currentDayName = daysNames[day];

  // 07:30 = 450 минут от начала суток (окно с 445 до 465)
  if (localMinutes >= 445 && localMinutes <= 465) {
    if (!logsData || logsData.lastDigest !== dateKey) {
      console.log("Формирование утреннего дайджеста...");

      let lessonsBlock = "";
      if (todayLessons.length === 0) {
        lessonsBlock = "<i>Пар на сегодня не запланировано.</i>\n";
      } else {
        lessonsBlock = todayLessons.map((l, i) => {
          const isCanc = l.status === 'canceled';
          return `${i + 1}. <b>${l.name}</b> ${isCanc ? '[ОТМЕНЕНА]' : `[${l.cab}]`} • <code>${l.time}</code>`;
        }).join("\n");
      }

      let tasksBlock = "";
      const taskKeys = tasksData ? Object.keys(tasksData) : [];
      if (taskKeys.length === 0) {
        tasksBlock = "<i>Активных дедлайнов нет.</i>";
      } else {
        tasksBlock = taskKeys.slice(0, 3).map(k => {
          const t = tasksData[k];
          return `• <b>${t.subj}</b>: ${t.title} (до <code>${t.deadline}</code>)`;
        }).join("\n");
      }

      const digestText = `⚡ <b>IGNIS // MORNING BRIEFING</b>\n` +
                         `<code>${currentDayName} • ${dateNum}.${month}</code>\n\n` +
                         `🗓 <b>РАСПИСАНИЕ НА ДЕНЬ:</b>\n` +
                         `${lessonsBlock}\n\n` +
                         `⏳ <b>ДЕДЛАЙНЫ И СРС:</b>\n` +
                         `${tasksBlock}\n\n` +
                         `<i>Удачного дня взводу G-13. Отметьтесь в RADAR!</i>`;

      for (const uid of recipients) {
        await sendMessage(uid, digestText);
      }

      await putData(`${DB_URL}/digest_logs.json`, { lastDigest: dateKey });
      console.log(`Утренний дайджест успешно отправлен ${recipients.size} бойцам.`);
      return;
    }
  }

  // ==========================================
  // 2. ОПОВЕЩЕНИЯ ЗА 5 МИНУТ ДО ПАРЫ
  // ==========================================
  for (const lesson of todayLessons) {
    if (lesson.status === 'canceled') continue;

    const parts = lesson.time.split(/[-—–]/);
    if (parts.length >= 1) {
      const startMin = parseTimeToMinutes(parts[0]);
      if (startMin !== null) {
        const diff = startMin - localMinutes;

        if (diff >= 3 && diff <= 8) {
          const msg = `🚨 <b>IGNIS // НАПОМИНАНИЕ</b>\n\n` +
                      `До пары осталось <b>~5 минут</b>!\n\n` +
                      `📖 <b>Предмет:</b> ${lesson.name}\n` +
                      `🚪 <b>Кабинет:</b> ${lesson.cab}\n` +
                      `⏰ <b>Время:</b> ${lesson.time}\n\n` +
                      `<i>Не забудьте отметиться в RADAR!</i>`;

          for (const uid of recipients) {
            await sendMessage(uid, msg);
          }
          console.log(`Рассылка о начале пары отправлена.`);
          return;
        }
      }
    }
  }

  console.log("Событий для отправки нет.");
}

run();
  
