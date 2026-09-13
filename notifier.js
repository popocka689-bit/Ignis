const https = require('https');

const DB_URL = "https://ignis-d092d-default-rtdb.firebaseio.com";
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID; // ID беседы или твой личный ID

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

function sendMessage(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: CHAT_ID,
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

    req.on('error', reject);
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
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("BOT_TOKEN или CHAT_ID не настроены в Secrets!");
    return;
  }

  // Получаем текущее время по часовому поясу твоего региона (+05:00)
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const localMinutes = (utcMinutes + 5 * 60) % (24 * 60); // сдвиг +5 часов (Казахстан)

  // День недели (1 - Пн, 5 - Пт)
  // В JS 0 - Вс. Корректируем смещение дня:
  const localDate = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = localDate.getUTCDay();

  if (day === 0 || day === 6) {
    console.log("Выходной день, уведомлений нет.");
    return;
  }

  const timetable = await fetchData(`${DB_URL}/timetable.json`);
  if (!timetable || !timetable[day]) {
    console.log("Расписание на сегодня пустое.");
    return;
  }

  const todayLessons = timetable[day];

  for (const lesson of todayLessons) {
    if (lesson.status === 'canceled') continue;

    const parts = lesson.time.split(/[-—–]/);
    if (parts.length >= 1) {
      const startMin = parseTimeToMinutes(parts[0]);
      if (startMin !== null) {
        const diff = startMin - localMinutes;

        // Если до начала пары осталось от 3 до 8 минут
        if (diff >= 3 && diff <= 8) {
          const msg = `🚨 <b>IGNIS // ВНИМАНИЕ ВЗВОД</b>\n\n` +
                      `До начала пары осталось <b>~5 минут</b>!\n\n` +
                      `📖 <b>Предмет:</b> ${lesson.name}\n` +
                      `🚪 <b>Кабинет:</b> ${lesson.cab}\n` +
                      `⏰ <b>Время:</b> ${lesson.time}\n\n` +
                      `<i>Отметьтесь в RADAR по прибытии!</i>`;

          await sendMessage(msg);
          console.log(`Уведомление отправлено для: ${lesson.name}`);
          return;
        }
      }
    }
  }

  console.log("Пар в ближайшие 5 минут нет.");
}

run();
