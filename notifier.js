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
  const localMinutes = (utcMinutes + 5 * 60) % (24 * 60); // Время Казахстана +05:00

  const localDate = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = localDate.getUTCDay();

  if (day === 0 || day === 6) {
    console.log("Выходной день.");
    return;
  }

  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const dateNum = String(localDate.getUTCDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${dateNum}`;

  const [timetable, squadData, tasksData, logsData, sentAlerts] = await Promise.all([
    fetchData(`${DB_URL}/timetable.json`),
    fetchData(`${DB_URL}/squad.json`),
    fetchData(`${DB_URL}/tasks.json`),
    fetchData(`${DB_URL}/digest_logs.json`),
    fetchData(`${DB_URL}/sent_alerts/${dateKey}.json`)
  ]);

  const recipients = new Set(ADMIN_IDS);
  if (squadData) {
    Object.keys(squadData).forEach(uid => recipients.add(uid));
  }

  const todayLessons = (timetable && timetable[day]) ? timetable[day] : [];
  const alertsToday = sentAlerts || {};

  // ==========================================
  // 1. УТРЕННИЙ ДАЙДЖЕСТ (ШИРОКОЕ ОКНО 06:45 - 07:45)
  // ==========================================
  const daysNames = ["ВОСКРЕСЕНЬЕ", "ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"];
  const currentDayName = daysNames[day];

  // 06:45 = 405 мин, 07:45 = 465 мин
  if (localMinutes >= 405 && localMinutes <= 465) {
    if (!logsData || logsData.lastDigest !== dateKey) {
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
      console.log(`Утренний дайджест отправлен.`);
      return;
    }
  }

  // ==========================================
  // 2. НАПОМИНАНИЯ О ПАРАХ (ОКНО 1 - 15 МИНУТ)
  // ==========================================
  for (let idx = 0; idx < todayLessons.length; idx++) {
    const lesson = todayLessons[idx];
    if (lesson.status === 'canceled') continue;

    const alertKey = `lesson_${idx}`;
    if (alertsToday[alertKey]) continue; // Уже отправляли сегодня

    const parts = lesson.time.split(/[-—–]/);
    if (parts.length >= 1) {
      const startMin = parseTimeToMinutes(parts[0]);
      if (startMin !== null) {
        const diff = startMin - localMinutes;

        // Если до пары от 1 до 15 минут
        if (diff >= 1 && diff <= 15) {
          const msg = `🚨 <b>IGNIS // НАПОМИНАНИЕ</b>\n\n` +
                      `До пары осталось <b>~${diff} минут</b>!\n\n` +
                      `📖 <b>Предмет:</b> ${lesson.name}\n` +
                      `🚪 <b>Кабинет:</b> ${lesson.cab}\n` +
                      `⏰ <b>Время:</b> ${lesson.time}\n\n` +
                      `<i>Не забудьте отметиться в RADAR!</i>`;

          for (const uid of recipients) {
            await sendMessage(uid, msg);
          }

          await putData(`${DB_URL}/sent_alerts/${dateKey}/${alertKey}.json`, true);
          console.log(`Оповещение на пару "${lesson.name}" отправлено.`);
          return;
        }
      }
    }
  }

  console.log("Событий для отправки нет.");
}

run();
