/* =====================================================================
   Деньги — офлайн-трекер расходов (PWA, без зависимостей)
   Данные хранятся локально в localStorage этого устройства.
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------- утиль */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };

/* ------------------------------------------------------------- валюты */
const CURRENCIES = [
  { code: 'USD', sym: '$',  after: false },
  { code: 'EUR', sym: '€',  after: false },
  { code: 'RUB', sym: '₽',  after: true  },
  { code: 'AMD', sym: '֏',  after: true  },
  { code: 'GEL', sym: '₾',  after: true  },
  { code: 'KZT', sym: '₸',  after: true  },
  { code: 'UAH', sym: '₴',  after: true  },
  { code: 'GBP', sym: '£',  after: false },
  { code: 'TRY', sym: '₺',  after: false },
  { code: 'AED', sym: 'AED', after: true },
];

/* ------------------------------------------------------- цвета/иконки */
const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red', 'teal'];
const EMOJI = ['🍔','🛒','🚕','🏠','🎉','👕','💊','📱','🎁','💳','✈️','☕️','🍺','⛽️','🐶','📚','💇','🏋️','🎮','🧴','🧾','🚌','🚗','🍎','🍕','🎬','💻','🔧','🌐','💸','🪙','📦'];

const DEFAULT_CATEGORIES = [
  { name: 'Продукты',     emoji: '🛒', color: 'green'  },
  { name: 'Кафе и еда',   emoji: '🍔', color: 'orange' },
  { name: 'Транспорт',    emoji: '🚕', color: 'blue'   },
  { name: 'Жильё',        emoji: '🏠', color: 'brown'  },
  { name: 'Развлечения',  emoji: '🎉', color: 'purple' },
  { name: 'Здоровье',     emoji: '💊', color: 'red'    },
  { name: 'Одежда',       emoji: '👕', color: 'pink'   },
  { name: 'Связь',        emoji: '📱', color: 'teal'   },
  { name: 'Подписки',     emoji: '💳', color: 'yellow' },
  { name: 'Прочее',       emoji: '📦', color: 'gray'   },
];

/* --------------------------------------------------------- хранилище */
const LS_KEY = 'money.v1';

const defaultState = () => ({
  version: 1,
  categories: DEFAULT_CATEGORIES.map((c) => ({ id: uid(), ...c })),
  expenses: [],
  settings: {
    currency: 'USD',
    weekStart: 1,        // 1 = понедельник, 0 = воскресенье
    theme: 'system',     // system | light | dark
    budgetMonth: 0,      // в минорных единицах, 0 = выключено
    budgetWeek: 0,
  },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    const st = {
      version: 1,
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : base.categories,
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      settings: Object.assign({}, base.settings, parsed.settings || {}),
    };
    // подчистка мусора
    st.categories = st.categories
      .filter((c) => c && c.id && c.name)
      .map((c) => ({ id: c.id, name: String(c.name), emoji: c.emoji || '📦', color: COLORS.includes(c.color) ? c.color : 'gray' }));
    st.expenses = st.expenses
      .filter((e) => e && e.id && Number.isFinite(e.amount) && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''))
      .map((e) => ({
        id: e.id,
        amount: Math.round(e.amount),
        categoryId: e.categoryId,
        note: e.note ? String(e.note).slice(0, 200) : '',
        date: e.date,
        createdAt: e.createdAt || Date.now(),
      }));
    return st;
  } catch (err) {
    console.warn('Не удалось прочитать данные, стартуем с чистого листа', err);
    return defaultState();
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (err) { toast('Не удалось сохранить: закончилось место'); }
  }, 60);
}

/* --------------------------------------------------------- формат сумм */
function cur() {
  return CURRENCIES.find((c) => c.code === state.settings.currency) || CURRENCIES[0];
}
/** minor units -> «$1 234,50» (копейки скрываются, если их нет) */
function money(minor, opts = {}) {
  const c = cur();
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const showCents = opts.cents === true || (opts.cents !== false && cents !== 0);
  let s = whole.toLocaleString('ru-RU');
  if (showCents) s += ',' + String(cents).padStart(2, '0');
  s = c.after ? s + ' ' + c.sym : c.sym + s;
  return (neg ? '−' : '') + s;
}
/** «12.5» -> 1250 */
function parseAmount(str) {
  const n = parseFloat(String(str).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/* ------------------------------------------------------------- даты */
const MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WDAY = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const WDAY_SHORT = ['вс','пн','вт','ср','чт','пт','сб'];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sameDay = (a, b) => iso(a) === iso(b);

function startOfWeek(d) {
  const ws = state.settings.weekStart;
  const day = d.getDay();
  const diff = (day - ws + 7) % 7;
  return addDays(startOfDay(d), -diff);
}

/** Диапазон периода. offset: 0 — текущий, -1 — предыдущий и т.д. */
function periodRange(kind, offset) {
  const now = new Date();
  if (kind === 'all') return { kind, from: null, to: null, label: 'Всё время', days: null };
  if (kind === 'day') {
    const from = addDays(startOfDay(now), offset);
    return { kind, from, to: addDays(from, 1), label: humanDay(from), days: 1 };
  }
  if (kind === 'week') {
    const from = addDays(startOfWeek(now), offset * 7);
    const to = addDays(from, 7);
    const last = addDays(to, -1);
    const l = from.getMonth() === last.getMonth()
      ? `${from.getDate()}–${last.getDate()} ${MONTHS_GEN[last.getMonth()]}`
      : `${from.getDate()} ${MONTHS_GEN[from.getMonth()]} – ${last.getDate()} ${MONTHS_GEN[last.getMonth()]}`;
    const extra = from.getFullYear() !== now.getFullYear() ? ` ${from.getFullYear()}` : '';
    return { kind, from, to, label: l + extra, days: 7 };
  }
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const extra = from.getFullYear() !== now.getFullYear() ? ` ${from.getFullYear()}` : '';
  return { kind, from, to, label: MONTHS_NOM[from.getMonth()] + extra, days: Math.round((to - from) / 86400000) };
}

function humanDay(d) {
  const today = startOfDay(new Date());
  if (sameDay(d, today)) return 'Сегодня';
  if (sameDay(d, addDays(today, -1))) return 'Вчера';
  if (sameDay(d, addDays(today, 1))) return 'Завтра';
  const y = d.getFullYear() !== today.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}, ${WDAY_SHORT[d.getDay()]}`;
}

/* ---------------------------------------------------------- выборки */
const catById = (id) => state.categories.find((c) => c.id === id) || null;

function inRange(e, range) {
  if (!range.from) return true;
  const d = fromIso(e.date);
  return d >= range.from && d < range.to;
}
function expensesIn(range) {
  return state.expenses
    .filter((e) => inRange(e, range))
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1)));
}
const sum = (list) => list.reduce((acc, e) => acc + e.amount, 0);

function prevRange(range) {
  if (!range.from) return null;
  if (range.kind === 'day') return { kind: 'day', from: addDays(range.from, -1), to: range.from, days: 1 };
  if (range.kind === 'week') return { kind: 'week', from: addDays(range.from, -7), to: range.from, days: 7 };
  const from = new Date(range.from.getFullYear(), range.from.getMonth() - 1, 1);
  return { kind: 'month', from, to: range.from, days: Math.round((range.from - from) / 86400000) };
}

/* ==================================================================== */
/*                            СОСТОЯНИЕ UI                              */
/* ==================================================================== */
const ui = {
  view: 'list',            // list | report | cats
  period: 'month',         // week | month | all
  offset: 0,               // сдвиг периода назад
};

function currentRange() { return periodRange(ui.period, ui.offset); }

/* ==================================================================== */
/*                              РЕНДЕР                                  */
/* ==================================================================== */
function render() {
  applyTheme();
  $$('.segmented__btn', $('#periodSeg')).forEach((b) =>
    b.classList.toggle('is-active', b.dataset.period === ui.period));
  $$('.tabbar__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === ui.view));
  $('#view-list').hidden   = ui.view !== 'list';
  $('#view-report').hidden = ui.view !== 'report';
  $('#view-cats').hidden   = ui.view !== 'cats';

  const range = currentRange();
  const list = expensesIn(range);
  const total = sum(list);

  renderHero(range, list, total);
  if (ui.view === 'list')   renderList(range, list, total);
  if (ui.view === 'report') renderReport(range, list, total);
  if (ui.view === 'cats')   renderCats(range);
}

function renderHero(range, list, total) {
  const isAll = range.kind === 'all';
  const nav = !isAll;

  ['#periodLabel', '#periodLabel2'].forEach((s) => { $(s).textContent = range.label; });
  ['#periodTotal', '#periodTotal2'].forEach((s) => { $(s).textContent = money(total, { cents: false }); });
  ['#prevPeriod', '#prevPeriod2'].forEach((s) => { $(s).disabled = !nav; });
  ['#nextPeriod', '#nextPeriod2'].forEach((s) => { $(s).disabled = !nav || ui.offset >= 0; });

  // подпись: количество, в день, сравнение с прошлым периодом
  const parts = [];
  parts.push(`<span><b>${list.length}</b> ${plural(list.length, 'трата', 'траты', 'трат')}</span>`);
  if (!isAll && range.kind !== 'day' && total > 0) {
    const elapsed = daysElapsed(range);
    parts.push(`<span><b>${money(Math.round(total / Math.max(1, elapsed)), { cents: false })}</b> в день</span>`);
  }
  const pr = prevRange(range);
  if (pr) {
    const prevTotal = sum(expensesIn(pr));
    if (prevTotal > 0 && total > 0) {
      const diff = Math.round(((total - prevTotal) / prevTotal) * 100);
      if (diff !== 0) {
        const cls = diff > 0 ? 'delta--up' : 'delta--down';
        // на прошлых днях «вчера» звучало бы про сегодняшнее вчера — уточняем формулировку
        const to = range.kind !== 'day' ? 'к прошлому' : (ui.offset === 0 ? 'ко вчера' : 'к пред. дню');
        parts.push(`<span class="delta ${cls}">${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)}% ${to}</span>`);
      } else {
        const same = range.kind !== 'day' ? 'в прошлом периоде' : (ui.offset === 0 ? 'вчера' : 'в предыдущий день');
        parts.push(`<span>как ${same}</span>`);
      }
    }
  }
  const metaHtml = parts.join('');
  $('#heroMeta').innerHTML = metaHtml;
  $('#heroMeta2').innerHTML = metaHtml;

  // бюджет
  const box = $('#budgetBox');
  const limit = range.kind === 'month' ? state.settings.budgetMonth
              : range.kind === 'week'  ? state.settings.budgetWeek : 0;
  if (limit > 0) {
    box.hidden = false;
    const pct = clamp(Math.round((total / limit) * 100), 0, 100);
    const fill = $('#budgetFill');
    fill.style.width = pct + '%';
    fill.classList.toggle('over', total > limit);
    const left = limit - total;
    $('#budgetTxt').textContent = left >= 0
      ? `Осталось ${money(left, { cents: false })} из ${money(limit, { cents: false })}`
      : `Перерасход ${money(-left, { cents: false })} — лимит ${money(limit, { cents: false })}`;
  } else box.hidden = true;
}

function daysElapsed(range) {
  if (!range.from) {
    if (!state.expenses.length) return 1;
    const min = state.expenses.reduce((m, e) => (e.date < m ? e.date : m), state.expenses[0].date);
    return clamp(Math.round((startOfDay(new Date()) - fromIso(min)) / 86400000) + 1, 1, 99999);
  }
  const now = startOfDay(new Date());
  if (now >= range.to) return range.days;
  if (now < range.from) return 1;
  return Math.round((now - range.from) / 86400000) + 1;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* --------------------------------------------------------- список */
function renderList(range, list) {
  const body = $('#listBody');
  if (!list.length) {
    body.innerHTML = !state.expenses.length
      ? emptyBlock('🧾', 'Пока пусто', 'Жми плюс и запиши первую трату. Заносить лучше сразу, а не вечером по памяти.')
      : range.kind === 'day'
        ? emptyBlock('🗓', 'За этот день ничего', 'Либо день был бесплатный, либо трата ещё не записана. Стрелками можно уйти на день назад.')
        : emptyBlock('🗓', 'За этот период пусто', 'Полистай стрелками назад или переключи период сверху.');
    return;
  }
  const groups = new Map();
  list.forEach((e) => {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  });

  let html = '';
  for (const [date, items] of groups) {
    html += `<section class="daygroup">
      <div class="daygroup__head"><span>${esc(humanDay(fromIso(date)))}</span><b>${money(sum(items))}</b></div>`;
    items.forEach((e) => {
      const c = catById(e.categoryId);
      const color = c ? c.color : 'gray';
      html += `<button class="row" data-edit="${e.id}">
        <span class="row__ico" style="background:var(--c-${color}-b)">${esc(c ? c.emoji : '📦')}</span>
        <span class="row__main">
          <span class="row__title">${esc(e.note || (c ? c.name : 'Без категории'))}</span>
          ${e.note && c ? `<span class="row__sub">${esc(c.name)}</span>` : ''}
        </span>
        <span class="row__amt">${money(e.amount)}</span>
      </button>`;
    });
    html += '</section>';
  }
  body.innerHTML = html;
}

const emptyBlock = (ico, title, text) =>
  `<div class="empty"><div class="empty__ico">${ico}</div><div class="empty__title">${esc(title)}</div><div class="empty__text">${esc(text)}</div></div>`;

/* ---------------------------------------------------------- отчёт */
function byCategory(list) {
  const map = new Map();
  list.forEach((e) => {
    const key = e.categoryId || 'none';
    map.set(key, (map.get(key) || 0) + e.amount);
  });
  return Array.from(map.entries())
    .map(([id, total]) => ({ cat: catById(id), total, count: list.filter((e) => (e.categoryId || 'none') === id).length }))
    .sort((a, b) => b.total - a.total);
}

function renderReport(range, list, total) {
  const body = $('#reportBody');
  if (!list.length) {
    body.innerHTML = emptyBlock('📊', 'Считать нечего', 'Добавь хотя бы одну трату — здесь появится разбивка по категориям.');
    return;
  }
  const rows = byCategory(list);
  const elapsed = daysElapsed(range);
  const maxDay = topDay(list);
  const avgCheck = Math.round(total / list.length);

  let html = '';

  // Кольцевая диаграмма
  html += `<div class="donut-wrap">${donutSvg(rows, total)}
    <div class="donut-mid"><b>${money(total, { cents: false })}</b><span>${rows.length} ${plural(rows.length, 'категория', 'категории', 'категорий')}</span></div>
  </div>`;

  // Плитки
  html += `<div class="stats">
    <div class="stat"><div class="stat__k">Средний чек</div><div class="stat__v">${money(avgCheck, { cents: false })}</div></div>
    ${range.kind === 'day' ? '' : `<div class="stat"><div class="stat__k">В день</div><div class="stat__v">${money(Math.round(total / Math.max(1, elapsed)), { cents: false })}</div></div>`}
    <div class="stat"><div class="stat__k">Всего трат</div><div class="stat__v">${list.length}</div></div>
    ${range.kind === 'day' ? '' : `<div class="stat"><div class="stat__k">Самый дорогой день</div><div class="stat__v">${maxDay ? money(maxDay.total, { cents: false }) : '—'}</div>${maxDay ? `<div class="stat__k">${esc(humanDay(fromIso(maxDay.date)))}</div>` : ''}</div>`}
  </div>`;

  // Полосы по категориям
  html += '<div class="section"><div class="section__title">По категориям</div></div><div class="card">';
  rows.forEach((r) => {
    const color = r.cat ? r.cat.color : 'gray';
    const pct = Math.round((r.total / total) * 100);
    html += `<button class="bar" data-cat-detail="${r.cat ? r.cat.id : 'none'}">
      <span class="bar__top">
        <span class="bar__dot" style="background:var(--c-${color}-b)">${esc(r.cat ? r.cat.emoji : '📦')}</span>
        <span class="bar__name">${esc(r.cat ? r.cat.name : 'Без категории')}</span>
        <span class="bar__val">${money(r.total, { cents: false })}</span>
      </span>
      <span class="bar__track"><span class="bar__fill" style="width:${Math.max(2, pct)}%;background:var(--c-${color}-f)"></span></span>
      <span class="bar__sub"><span>${pct}%</span><span>${r.count} ${plural(r.count, 'трата', 'траты', 'трат')}</span></span>
    </button>`;
  });
  html += '</div>';

  // Топ трат
  const top = list.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);
  html += '<div class="section"><div class="section__title">Самые крупные</div></div><div class="card">';
  top.forEach((e) => {
    const c = catById(e.categoryId);
    const color = c ? c.color : 'gray';
    html += `<button class="row" data-edit="${e.id}">
      <span class="row__ico" style="background:var(--c-${color}-b)">${esc(c ? c.emoji : '📦')}</span>
      <span class="row__main">
        <span class="row__title">${esc(e.note || (c ? c.name : 'Без категории'))}</span>
        <span class="row__sub">${esc(humanDay(fromIso(e.date)))}${c && e.note ? ' · ' + esc(c.name) : ''}</span>
      </span>
      <span class="row__amt">${money(e.amount)}</span>
    </button>`;
  });
  html += '</div><div class="hint">Нажми на категорию, чтобы посмотреть все траты внутри неё.</div>';
  body.innerHTML = html;
}

function topDay(list) {
  const map = new Map();
  list.forEach((e) => map.set(e.date, (map.get(e.date) || 0) + e.amount));
  let best = null;
  for (const [date, total] of map) if (!best || total > best.total) best = { date, total };
  return best;
}

function donutSvg(rows, total) {
  const R = 62, S = 26, C = 2 * Math.PI * R, size = (R + S / 2) * 2 + 8;
  let acc = 0, seg = '';
  rows.forEach((r) => {
    const frac = r.total / total;
    const len = Math.max(0, C * frac - 3);
    const color = r.cat ? r.cat.color : 'gray';
    seg += `<circle cx="${size / 2}" cy="${size / 2}" r="${R}" fill="none"
      stroke="var(--c-${color}-f)" stroke-width="${S}" stroke-linecap="butt"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc * C + 0.0001}"
      transform="rotate(-90 ${size / 2} ${size / 2})"></circle>`;
    acc += frac;
  });
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="${S}"></circle>${seg}</svg>`;
}

/* ------------------------------------------------------ категории */
function renderCats(range) {
  const list = expensesIn(range);
  const total = sum(list);
  const rows = byCategory(list);
  const totalsById = new Map(rows.map((r) => [r.cat ? r.cat.id : 'none', r.total]));

  let html = `<div class="section"><div class="section__title">Категории · ${esc(range.label)}</div></div><div class="card">`;
  const ordered = state.categories.slice().sort((a, b) => (totalsById.get(b.id) || 0) - (totalsById.get(a.id) || 0));
  ordered.forEach((c) => {
    const t = totalsById.get(c.id) || 0;
    const pct = total > 0 ? Math.round((t / total) * 100) : 0;
    html += `<button class="catrow" data-cat-edit="${c.id}">
      <span class="catrow__ico" style="background:var(--c-${c.color}-b)">${esc(c.emoji)}</span>
      <span class="catrow__name">${esc(c.name)}</span>
      <span class="catrow__sum">${t ? money(t, { cents: false }) + ' · ' + pct + '%' : '—'}</span>
      <span class="catrow__chev"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>`;
  });
  html += `</div>
  <div class="btnrow" style="padding-top:8px"><button class="btn btn--ghost" id="addCatBtn">+ Новая категория</button></div>
  <div class="hint">Категорию можно переименовать, поменять ей эмодзи и цвет. При удалении траты не пропадут — они переедут в «Прочее».</div>`;
  $('#catsBody').innerHTML = html;
}

/* ==================================================================== */
/*                              ШТОРКА                                  */
/* ==================================================================== */
function openSheet(html, onMount, footerHtml) {
  const root = $('#sheetRoot');
  const sheet = $('#sheet');
  const foot = $('#sheetFoot');
  sheet.classList.remove('is-closing');
  sheet.style.transform = '';
  $('#sheetBody').innerHTML = html;
  foot.innerHTML = footerHtml || '';
  foot.hidden = !footerHtml;
  root.hidden = false;
  $('#sheetBody').scrollTop = 0;   // только после показа: у скрытого элемента прокрутку не сбросить
  document.body.style.overflow = 'hidden';
  if (onMount) onMount($('#sheet'));   // корень = вся шторка, вместе с подвалом
}

function closeSheet() {
  const root = $('#sheetRoot');
  if (root.hidden) return;
  const sheet = $('#sheet');
  sheet.classList.add('is-closing');
  setTimeout(() => {
    root.hidden = true;
    $('#sheetBody').innerHTML = '';
    $('#sheetFoot').innerHTML = '';
    $('#sheetFoot').hidden = true;
    sheet.classList.remove('is-closing');
    sheet.style.transform = '';
    document.body.style.overflow = '';
  }, 180);
}

// свайп вниз по «ручке»
(function dragSheet() {
  const grip = $('#sheetGrip');
  const sheet = $('#sheet');
  let y0 = null;
  grip.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  grip.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    const dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  grip.addEventListener('touchend', (e) => {
    if (y0 === null) return;
    const dy = Math.max(0, (e.changedTouches[0].clientY - y0));
    sheet.style.transform = '';
    y0 = null;
    if (dy > 90) closeSheet();
  });
})();

/* ==================================================================== */
/*                        ДОБАВЛЕНИЕ / ПРАВКА                           */
/* ==================================================================== */
function expenseSheet(existing) {
  const isEdit = !!existing;
  const draft = {
    amountStr: isEdit ? (existing.amount / 100).toFixed(2).replace(/\.?0+$/, '') || '0' : '',
    categoryId: isEdit ? existing.categoryId : (lastUsedCategory() || (state.categories[0] && state.categories[0].id)),
    note: isEdit ? existing.note : '',
    date: isEdit ? existing.date : iso(new Date()),
  };

  const html = `
    <div class="sheet__title">
      <span>${isEdit ? 'Правка траты' : 'Новая трата'}</span>
      <button type="button" data-close>Закрыть</button>
    </div>
    <div class="amount is-zero" id="amtView">0</div>
    <div class="keypad" id="keypad">
      ${[1,2,3,4,5,6,7,8,9].map((n) => `<button class="key" data-k="${n}">${n}</button>`).join('')}
      <button class="key key--fn" data-k=",">,</button>
      <button class="key" data-k="0">0</button>
      <button class="key key--fn" data-k="del" aria-label="Стереть">⌫</button>
    </div>
    <div class="field">
      <div class="field__lbl">Категория</div>
      <div class="chips chips--scroll" id="catChips"></div>
    </div>
    <div class="field">
      <div class="field__lbl">Когда</div>
      <div class="chips chips--scroll" id="dateChips">
        <button class="chip" data-d="0">Сегодня</button>
        <button class="chip" data-d="-1">Вчера</button>
        <button class="chip" data-d="-2">Позавчера</button>
        <input class="input" type="date" id="dateInput" style="width:auto;padding:8px 10px;font-size:14.5px">
      </div>
    </div>
    <div class="field">
      <div class="field__lbl">Заметка <span style="text-transform:none;font-weight:400">— необязательно</span></div>
      <input class="input" id="noteInput" placeholder="Например: такси до аэропорта" maxlength="120" autocomplete="off">
    </div>
    ${isEdit ? '<div class="sheet-actions"><button class="btn btn--danger" id="delBtn">Удалить трату</button></div>' : ''}`;

  const footer = `<button class="btn" id="saveBtn">${isEdit ? 'Сохранить' : 'Добавить трату'}</button>`;

  openSheet(html, (body) => {
    const amtView = $('#amtView', body);
    const noteInput = $('#noteInput', body);
    const dateInput = $('#dateInput', body);

    function paintAmount() {
      const c = cur();
      const shown = draft.amountStr === '' ? '0' : draft.amountStr.replace('.', ',');
      amtView.classList.toggle('is-zero', draft.amountStr === '' || parseAmount(draft.amountStr) === 0);
      amtView.innerHTML = c.after ? `${esc(shown)} <small>${c.sym}</small>` : `<small>${c.sym}</small>${esc(shown)}`;
    }
    function paintCats() {
      $('#catChips', body).innerHTML = state.categories.map((c) => `
        <button class="chip chip--cat${c.id === draft.categoryId ? ' is-on' : ''}" data-cat="${c.id}"
          style="background:var(--c-${c.color}-b);color:var(--c-${c.color}-f)">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')
        + '<button class="chip" data-new-cat>＋ Категория</button>';
    }
    function paintDate() {
      const today = startOfDay(new Date());
      $$('#dateChips .chip', body).forEach((ch) => {
        const d = iso(addDays(today, Number(ch.dataset.d)));
        ch.classList.toggle('is-on', d === draft.date);
      });
      dateInput.value = draft.date;
    }

    paintAmount(); paintCats(); paintDate();
    noteInput.value = draft.note || '';

    $('#keypad', body).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-k]');
      if (!btn) return;
      const k = btn.dataset.k;
      buzz(6);
      if (k === 'del') draft.amountStr = draft.amountStr.slice(0, -1);
      else if (k === ',') { if (!draft.amountStr.includes('.')) draft.amountStr = (draft.amountStr || '0') + '.'; }
      else {
        const [, dec] = draft.amountStr.split('.');
        if (dec && dec.length >= 2) return;
        if (draft.amountStr.replace('.', '').length >= 9) return;
        draft.amountStr = draft.amountStr === '0' ? k : draft.amountStr + k;
      }
      paintAmount();
    });

    $('#catChips', body).addEventListener('click', (e) => {
      if (e.target.closest('[data-new-cat]')) {
        const keep = { ...draft, note: noteInput.value };
        categorySheet(null, (newId) => { keep.categoryId = newId; expenseSheetWith(existing, keep); });
        return;
      }
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      draft.categoryId = b.dataset.cat;
      buzz(6); paintCats();
    });

    $('#dateChips', body).addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      draft.date = iso(addDays(startOfDay(new Date()), Number(b.dataset.d)));
      paintDate();
    });
    dateInput.addEventListener('change', () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) { draft.date = dateInput.value; paintDate(); }
    });

    $('#saveBtn', body).addEventListener('click', () => {
      const amount = parseAmount(draft.amountStr);
      if (amount <= 0) { amtView.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(0)' }],
        { duration: 220 }); buzz(30); return; }
      const note = noteInput.value.trim();
      if (isEdit) {
        Object.assign(existing, { amount, categoryId: draft.categoryId, note, date: draft.date });
      } else {
        state.expenses.push({ id: uid(), amount, categoryId: draft.categoryId, note, date: draft.date, createdAt: Date.now() });
        jumpToDate(draft.date);
      }
      save(); buzz(14); closeSheet(); render();
      toast(isEdit ? 'Сохранено' : `Записано ${money(amount)}`);
    });

    const del = $('#delBtn', body);
    if (del) del.addEventListener('click', () => { deleteExpense(existing.id); closeSheet(); });

    noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#saveBtn', body).click(); } });
    noteInput.addEventListener('focus', () => {
      setTimeout(() => noteInput.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    });
  }, footer);
}

/** повторное открытие с сохранённым черновиком (после создания категории на лету) */
function expenseSheetWith(existing, keep) {
  expenseSheet(existing);
  const body = $('#sheetBody');
  const amtView = $('#amtView', body);
  const noteInput = $('#noteInput', body);
  if (!amtView) return;
  // восстановить черновик через синтетические действия
  setTimeout(() => {
    const cat = $(`[data-cat="${keep.categoryId}"]`, body);
    if (cat) cat.click();
    noteInput.value = keep.note || '';
    const di = $('#dateInput', body);
    di.value = keep.date; di.dispatchEvent(new Event('change'));
    String(keep.amountStr || '').split('').forEach((ch) => {
      const k = ch === '.' ? ',' : ch;
      const btn = $(`#keypad [data-k="${k}"]`, body);
      if (btn) btn.click();
    });
  }, 0);
}

function lastUsedCategory() {
  const last = state.expenses.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
  return last && catById(last.categoryId) ? last.categoryId : null;
}

/** если трата вне текущего периода — перепрыгнуть туда, чтобы её было видно */
function jumpToDate(dateStr) {
  const r = currentRange();
  if (!r.from) return;
  const d = fromIso(dateStr);
  if (d >= r.from && d < r.to) return;
  const now = new Date();
  if (ui.period === 'day') {
    ui.offset = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  } else if (ui.period === 'week') {
    ui.offset = Math.round((startOfWeek(d) - startOfWeek(now)) / (7 * 86400000));
  } else {
    ui.offset = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
  }
}

function deleteExpense(id) {
  const i = state.expenses.findIndex((e) => e.id === id);
  if (i === -1) return;
  const [removed] = state.expenses.splice(i, 1);
  save(); render(); buzz(14);
  toast(`Удалено ${money(removed.amount)}`, 'Отменить', () => {
    state.expenses.push(removed); save(); render();
  });
}

/* ==================================================================== */
/*                            КАТЕГОРИИ                                 */
/* ==================================================================== */
function categorySheet(existing, onCreated) {
  const isEdit = !!existing;
  const draft = existing
    ? { name: existing.name, emoji: existing.emoji, color: existing.color }
    : { name: '', emoji: EMOJI[Math.floor(Math.random() * 12)], color: COLORS[Math.floor(Math.random() * COLORS.length)] };

  const html = `
    <div class="sheet__title">
      <span>${isEdit ? 'Категория' : 'Новая категория'}</span>
      <button type="button" data-close>Закрыть</button>
    </div>
    <div class="field">
      <div class="field__lbl">Название</div>
      <input class="input" id="catName" placeholder="Например: Кофе" maxlength="30" autocomplete="off">
    </div>
    <div class="field">
      <div class="field__lbl">Эмодзи</div>
      <div class="grid-emoji" id="emojiGrid">${EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
    </div>
    <div class="field">
      <div class="field__lbl">Цвет</div>
      <div class="grid-color" id="colorGrid">${COLORS.map((c) =>
        `<button type="button" data-c="${c}" style="background:var(--c-${c}-b);color:var(--c-${c}-f)">Aa</button>`).join('')}</div>
    </div>
    ${isEdit ? '<div class="sheet-actions"><button class="btn btn--danger" id="catDel">Удалить категорию</button></div>' : ''}`;

  const footer = `<button class="btn" id="catSave">${isEdit ? 'Сохранить' : 'Создать'}</button>`;

  openSheet(html, (body) => {
    const nameInput = $('#catName', body);
    nameInput.value = draft.name;
    const paint = () => {
      $$('#emojiGrid button', body).forEach((b) => b.classList.toggle('is-on', b.dataset.e === draft.emoji));
      $$('#colorGrid button', body).forEach((b) => b.classList.toggle('is-on', b.dataset.c === draft.color));
    };
    paint();
    if (!isEdit) setTimeout(() => nameInput.focus(), 260);

    $('#emojiGrid', body).addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]'); if (!b) return;
      draft.emoji = b.dataset.e; buzz(6); paint();
    });
    $('#colorGrid', body).addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      draft.color = b.dataset.c; buzz(6); paint();
    });

    $('#catSave', body).addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); nameInput.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
        { duration: 200 }); return; }
      if (isEdit) {
        Object.assign(existing, { name, emoji: draft.emoji, color: draft.color });
        save(); closeSheet(); render(); toast('Категория обновлена');
      } else {
        const cat = { id: uid(), name, emoji: draft.emoji, color: draft.color };
        state.categories.push(cat);
        save(); render();
        // если категорию создавали прямо из формы траты — возвращаемся в неё,
        // не закрывая шторку, иначе анимация закрытия сотрёт восстановленный черновик
        if (onCreated) { onCreated(cat.id); return; }
        closeSheet(); toast('Категория создана');
      }
    });

    const del = $('#catDel', body);
    if (del) del.addEventListener('click', () => {
      const used = state.expenses.filter((e) => e.categoryId === existing.id);
      const msg = used.length
        ? `Удалить «${existing.name}»? ${used.length} ${plural(used.length, 'трата переедет', 'траты переедут', 'трат переедут')} в «Прочее».`
        : `Удалить «${existing.name}»?`;
      if (!confirm(msg)) return;
      let fallback = state.categories.find((c) => c.name === 'Прочее' && c.id !== existing.id);
      if (used.length && !fallback) {
        fallback = { id: uid(), name: 'Прочее', emoji: '📦', color: 'gray' };
        state.categories.push(fallback);
      }
      used.forEach((e) => { e.categoryId = fallback.id; });
      state.categories = state.categories.filter((c) => c.id !== existing.id);
      if (!state.categories.length) state.categories = defaultState().categories;
      save(); closeSheet(); render(); toast('Категория удалена');
    });
  }, footer);
}

/** Все траты выбранной категории за текущий период */
function categoryDetailSheet(catId) {
  const range = currentRange();
  const list = expensesIn(range).filter((e) => (e.categoryId || 'none') === catId);
  const c = catById(catId);
  const total = sum(list);
  const html = `
    <div class="sheet__title">
      <span>${esc(c ? c.emoji + ' ' + c.name : 'Без категории')}</span>
      <button type="button" data-close>Закрыть</button>
    </div>
    <div style="padding:0 18px 6px">
      <div style="font-size:30px;font-weight:700;letter-spacing:-.03em">${money(total)}</div>
      <div style="font-size:13px;color:var(--text-2)">${esc(range.label)} · ${list.length} ${plural(list.length, 'трата', 'траты', 'трат')}</div>
    </div>
    <div class="card" style="margin-top:12px">
      ${list.map((e) => `<button class="row" data-edit="${e.id}">
        <span class="row__main">
          <span class="row__title">${esc(e.note || (c ? c.name : 'Без категории'))}</span>
          <span class="row__sub">${esc(humanDay(fromIso(e.date)))}</span>
        </span>
        <span class="row__amt">${money(e.amount)}</span>
      </button>`).join('') || '<div class="hint" style="padding:16px 18px">Здесь пока пусто.</div>'}
    </div>`;
  openSheet(html);
}

/* ==================================================================== */
/*                            НАСТРОЙКИ                                 */
/* ==================================================================== */
function settingsSheet() {
  const s = state.settings;
  const html = `
    <div class="sheet__title"><span>Настройки</span><button type="button" data-close>Закрыть</button></div>

    <div class="field">
      <div class="field__lbl">Валюта</div>
      <select class="input" id="setCur">${CURRENCIES.map((c) =>
        `<option value="${c.code}"${c.code === s.currency ? ' selected' : ''}>${c.sym} — ${c.code}</option>`).join('')}</select>
    </div>

    <div class="field">
      <div class="field__lbl">Неделя начинается с</div>
      <select class="input" id="setWeek">
        <option value="1"${s.weekStart === 1 ? ' selected' : ''}>Понедельника</option>
        <option value="0"${s.weekStart === 0 ? ' selected' : ''}>Воскресенья</option>
      </select>
    </div>

    <div class="field">
      <div class="field__lbl">Тема</div>
      <select class="input" id="setTheme">
        <option value="system"${s.theme === 'system' ? ' selected' : ''}>Как в системе</option>
        <option value="light"${s.theme === 'light' ? ' selected' : ''}>Светлая</option>
        <option value="dark"${s.theme === 'dark' ? ' selected' : ''}>Тёмная</option>
      </select>
    </div>

    <div class="field">
      <div class="field__lbl">Лимит на месяц</div>
      <input class="input" id="setBM" type="text" inputmode="decimal" placeholder="0 — без лимита" value="${s.budgetMonth ? (s.budgetMonth / 100) : ''}">
    </div>
    <div class="field">
      <div class="field__lbl">Лимит на неделю</div>
      <input class="input" id="setBW" type="text" inputmode="decimal" placeholder="0 — без лимита" value="${s.budgetWeek ? (s.budgetWeek / 100) : ''}">
    </div>

    <div class="section"><div class="section__title">Данные</div></div>
    <div class="sheet-actions" style="padding-top:4px">
      <button class="btn btn--ghost" id="expJson">Выгрузить резервную копию (JSON)</button>
      <button class="btn btn--ghost" id="expCsv">Выгрузить таблицу (CSV)</button>
      <button class="btn btn--ghost" id="impJson">Загрузить копию из файла</button>
      <button class="btn btn--danger" id="wipe">Стереть все данные</button>
      <input type="file" id="fileIn" accept="application/json,.json" hidden>
    </div>
    <div class="hint">Всё хранится только на этом устройстве, в памяти браузера — никаких серверов и аккаунтов.
    Меняешь телефон или чистишь браузер — сначала выгрузи копию, потом загрузи её на новом устройстве.
    Сейчас: <b>${state.expenses.length}</b> ${plural(state.expenses.length, 'трата', 'траты', 'трат')},
    <b>${state.categories.length}</b> ${plural(state.categories.length, 'категория', 'категории', 'категорий')}.</div>`;

  openSheet(html, (body) => {
    $('#setSave', body).addEventListener('click', () => {
      state.settings.currency = $('#setCur', body).value;
      state.settings.weekStart = Number($('#setWeek', body).value);
      state.settings.theme = $('#setTheme', body).value;
      state.settings.budgetMonth = Math.max(0, parseAmount($('#setBM', body).value));
      state.settings.budgetWeek = Math.max(0, parseAmount($('#setBW', body).value));
      save(); closeSheet(); render(); toast('Настройки сохранены');
    });

    $('#expJson', body).addEventListener('click', () => {
      downloadFile(`money-backup-${iso(new Date())}.json`, JSON.stringify(state, null, 2), 'application/json');
    });
    $('#expCsv', body).addEventListener('click', () => {
      const rows = [['Дата', 'Категория', 'Сумма', 'Валюта', 'Заметка']];
      state.expenses.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => {
        const c = catById(e.categoryId);
        rows.push([e.date, c ? c.name : 'Без категории', (e.amount / 100).toFixed(2), state.settings.currency, e.note || '']);
      });
      const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      downloadFile(`money-${iso(new Date())}.csv`, csv, 'text/csv');
    });

    $('#impJson', body).addEventListener('click', () => $('#fileIn', body).click());
    $('#fileIn', body).addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          if (!data || !Array.isArray(data.expenses)) throw new Error('плохой формат');
          if (!confirm(`Заменить текущие данные на копию (${data.expenses.length} трат)?`)) return;
          localStorage.setItem(LS_KEY, JSON.stringify(data));
          state = load(); save(); closeSheet(); render(); toast('Копия загружена');
        } catch (err) { alert('Не получилось прочитать файл: ' + err.message); }
      };
      reader.readAsText(file);
    });

    $('#wipe', body).addEventListener('click', () => {
      if (!confirm('Удалить все траты и вернуть категории по умолчанию? Отменить будет нельзя.')) return;
      if (!confirm('Точно? Лучше сначала выгрузить копию.')) return;
      state = defaultState(); save(); closeSheet(); render(); toast('Всё очищено');
    });
  }, '<button class="btn" id="setSave">Сохранить настройки</button>');
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(() => fallbackDownload(blob, name));
  } else fallbackDownload(blob, name);
}
function fallbackDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ==================================================================== */
/*                               ТОСТ                                   */
/* ==================================================================== */
let toastTimer = null;
function toast(text, actionLabel, action) {
  const el = $('#toast');
  const btn = $('#toastAction');
  $('#toastText').textContent = text;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { el.hidden = true; if (action) action(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 5200 : 2200);
}

/* ==================================================================== */
/*                               ТЕМА                                   */
/* ==================================================================== */
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ==================================================================== */
/*                              СОБЫТИЯ                                 */
/* ==================================================================== */
$('#periodSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-period]'); if (!b) return;
  ui.period = b.dataset.period; ui.offset = 0; buzz(6); render();
});
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  ui.view = b.dataset.view; buzz(6);
  $('#scroll').scrollTop = 0;
  render();
});
['#prevPeriod', '#prevPeriod2'].forEach((s) => $(s).addEventListener('click', () => { ui.offset -= 1; buzz(6); render(); }));
['#nextPeriod', '#nextPeriod2'].forEach((s) => $(s).addEventListener('click', () => { ui.offset = Math.min(0, ui.offset + 1); buzz(6); render(); }));
$('#fab').addEventListener('click', () => { buzz(10); expenseSheet(null); });
$('#btnSettings').addEventListener('click', () => settingsSheet());
$('#sheetBackdrop').addEventListener('click', closeSheet);

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeSheet();

  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const exp = state.expenses.find((x) => x.id === edit.dataset.edit);
    if (exp) { buzz(8); if (!$('#sheetRoot').hidden) closeSheet(); setTimeout(() => expenseSheet(exp), $('#sheetRoot').hidden ? 0 : 190); }
    return;
  }
  const catEdit = e.target.closest('[data-cat-edit]');
  if (catEdit) { const c = catById(catEdit.dataset.catEdit); if (c) { buzz(8); categorySheet(c); } return; }

  const catDetail = e.target.closest('[data-cat-detail]');
  if (catDetail) { buzz(8); categoryDetailSheet(catDetail.dataset.catDetail); return; }

  if (e.target.closest('#addCatBtn')) { buzz(8); categorySheet(null); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#sheetRoot').hidden) closeSheet();
});

// свайп влево/вправо по периодам на экране списка
(function swipePeriods() {
  let x0 = null, y0 = null;
  const el = $('#scroll');
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 === null || ui.period === 'all' || ui.view === 'cats') { x0 = null; return; }
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 45) return;
    if (dx > 0) { ui.offset -= 1; buzz(8); render(); }
    else if (ui.offset < 0) { ui.offset += 1; buzz(8); render(); }
  }, { passive: true });
})();

// вернулись в приложение — вдруг наступил новый день/месяц
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

/* ==================================================================== */
/*                              СТАРТ                                   */
/* ==================================================================== */
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
