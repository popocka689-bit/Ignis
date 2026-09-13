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

    req.on('error', () => resolve()); // Игнорируем ошибку, если кто-то заблокировал бота
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

  const [timetable, squadData] = await Promise.all([
    fetchData(`${DB_URL}/timetable.json`),
    fetchData(`${DB_URL}/squad.json`)
  ]);

  if (!timetable || !timetable[day]) {
    console.log("Расписание на сегодня пустое.");
    return;
  }

  // Собираем список получателей (squad + админы)
  const recipients = new Set(ADMIN_IDS);
  if (squadData) {
    Object.keys(squadData).forEach(uid => recipients.add(uid));
  }

  const todayLessons = timetable[day];

  for (const lesson of todayLessons) {
    if (lesson.status === 'canceled') continue;

    const parts = lesson.time.split(/[-—–]/);
    if (parts.length >= 1) {
      const startMin = parseTimeToMinutes(parts[0]);
      if (startMin !== null) {
        const diff = startMin - localMinutes;

        // Если до начала пары от 3 до 8 минут
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
          console.log(`Рассылка отправлена ${recipients.size} бойцам.`);
          return;
        }
      }
    }
  }

  console.log("В ближайшие 5 минут пар нет.");
}

run();
