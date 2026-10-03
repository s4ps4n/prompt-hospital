#!/usr/bin/env node
// Сборка сайта «МИР ДЗЮДО» (статический стенд носителя). Без зависимостей: node build.mjs
// Источники: src/data/*.json (каталог, тексты, NAP), src/assets/* (стили и островки JS).
// Результат: dist/ — каждая страница карты сайта (JUDO-IA §2) как <путь>/index.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC, 'data', f), 'utf8'));
const site = read('site.json');
// BASE_URL из окружения (деплой, https://$DOMAIN) перекрывает site.json → canonical, sitemap, robots
if (process.env.BASE_URL) site.baseUrl = process.env.BASE_URL.replace(/\/+$/, '');
const catalog = read('catalog.json');
const content = read('content.json');

// ── Хелперы ─────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
const NB = ' ';
const money = (n) => n.toLocaleString('ru-RU').replace(/\s/g, NB) + NB + '₽';
const plural = (n, [one, few, many]) => {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
};
const phClass = (kind) => (kind === 'dark' ? 'ph ph--dark' : kind === 'blue' ? 'ph ph--blue' : 'ph');
const ph = (kind, label, ratio = 'r45', attrs = '') =>
  `<div class="${phClass(kind)} ${ratio}"${attrs}><span>${esc(label)}</span></div>`;
const swatchVar = (s) => (s === 'white' ? 'var(--c-bg-elev)' : s === 'blue' ? 'var(--variant-blue)' : s);
const optShort = (opt, v) =>
  opt.type === 'swatch'
    ? opt.values.find((x) => x.v === v).label.toLowerCase()
    : `${opt.label.split(',')[0].toLowerCase()} ${v}${opt.key === 'length' ? ' см' : ''}`;

// ── Каталог: разворачиваем варианты (SKU) ───────────────
const cats = catalog.categories;
const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c]));
const products = catalog.products.map((p, order) => {
  const combos = p.options.reduce(
    (acc, o) => acc.flatMap((sel) => o.values.map((val) => ({ ...sel, [o.key]: typeof val === 'string' ? val : val.v }))),
    [{}],
  );
  const variants = combos.map((sel) => {
    const price = p.prices ? p.prices.map[sel[p.prices.key]] : p.price;
    const available = !p.na.some((rule) => Object.entries(rule).every(([k, v]) => sel[k] === v));
    const label = p.options.map((o) => optShort(o, sel[o.key])).join(' · ');
    const sku = [p.slug, ...p.options.map((o) => `${o.key}=${sel[o.key]}`)].join('/');
    return { sku, sel, price, available, label };
  });
  const priceFrom = Math.min(...variants.map((v) => v.price));
  const fixed = variants.every((v) => v.price === priceFrom);
  return { ...p, order, variants, priceFrom, fixed, url: `/catalog/${p.cat}/${p.slug}/` };
});
const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
const inCat = (slug) => products.filter((p) => p.cat === slug);
const priceLabel = (p) => (p.fixed ? money(p.priceFrom) : `от${NB}${money(p.priceFrom)}`);
const statusBadge = (p) =>
  p.status ? `<span class="badge badge--na">${esc(p.status)}</span>` : '<span class="badge">Доступно к заказу</span>';

// ── Общие куски ─────────────────────────────────────────
const icons = {
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 7h14l-1.2 12.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9L5 7Z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
const NAV = [
  ['/catalog/kimono/', 'Кимоно'], ['/catalog/belts/', 'Пояса'], ['/catalog/accessories/', 'Аксессуары'],
  ['/sizes/', 'Размеры'], ['/how-to-order/', 'Как заказать'], ['/contacts/', 'Контакты'],
];
const navLinks = (current) =>
  NAV.map(([href, t]) => `<a href="${href}"${current && current.startsWith(href) ? ' aria-current="page"' : ''}>${t}</a>`).join('');

const header = (current) => `
<a class="skip" href="#main">К содержанию</a>
<div class="promo" role="note"><div class="wrap">${content.promo.map((s) => `<span>${s}</span>`).join('')}</div></div>
<header class="hdr">
  <div class="wrap">
    <a class="logo" href="/"><i aria-hidden="true"></i>${site.name}</a>
    <nav class="nav" aria-label="Главное меню">${navLinks(current)}</nav>
    <div class="hdr-end">
      <a class="tel" href="${site.phoneHref}">${site.phone}</a>
      <a class="icon-btn" href="/order/" aria-label="Мой заказ" data-order-link>${icons.bag}<span class="count" data-order-count hidden>0</span></a>
      <button class="icon-btn burger" type="button" aria-label="Меню" aria-controls="drawer" aria-expanded="false" data-menu-open>${icons.menu}</button>
    </div>
  </div>
</header>
<div class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="Меню">
  <div class="drawer-top"><a class="logo" href="/"><i aria-hidden="true"></i>${site.name}</a><button class="icon-btn" type="button" aria-label="Закрыть меню" data-menu-close>${icons.close}</button></div>
  <nav aria-label="Меню">${navLinks(current)}<a href="/order/">Мой заказ</a></nav>
  <div class="drawer-cta">
    <a class="btn btn--primary" href="${site.phoneHref}">${site.phone}</a>
    <a class="btn btn--secondary" href="${site.whatsapp}" rel="noopener">WhatsApp</a>
    <a class="btn btn--secondary" href="${site.telegram}" rel="noopener">Telegram</a>
  </div>
</div>`;

const footer = () => `
<footer class="ftr">
  <div class="wrap">
    <div class="ftr-grid">
      <div class="stack">
        <a class="logo" href="/"><i aria-hidden="true"></i>${site.name}</a>
        <p>Экипировка для дзюдо под заказ. Официальный партнёр клуба «ИППОН», ${site.city}.</p>
      </div>
      <div class="ftr-col"><details open><summary><h2>Каталог</h2></summary><ul>${cats.map((c) => `<li><a href="/catalog/${c.slug}/">${c.name}</a></li>`).join('')}</ul></details></div>
      <div class="ftr-col"><details open><summary><h2>Покупателям</h2></summary><ul><li><a href="/sizes/">Размеры</a></li><li><a href="/how-to-order/">Как заказать</a></li><li><a href="/about/">О магазине</a></li><li><a href="/privacy/">Политика ПДн</a></li></ul></details></div>
      <div class="ftr-col"><details open><summary><h2>Контакты</h2></summary><ul><li><a href="${site.phoneHref}">${site.phone}</a></li><li><a href="${site.whatsapp}" rel="noopener">WhatsApp</a> · <a href="${site.telegram}" rel="noopener">Telegram</a></li><li>${site.address}</li><li>${site.hours}</li><li><a href="/about/">Партнёр клуба «ИППОН»</a></li></ul></details></div>
    </div>
    <div class="ftr-bottom"><span>© ${new Date().getFullYear()} ${site.name} · ${site.legal}</span><span>Сайт работает на Каркас CMS</span></div>
  </div>
</footer>
<div class="toast" id="toast" role="status" aria-live="polite"><span data-toast-text>Добавлено в заказ</span> <a class="btn btn--on-dark btn--sm" href="/order/">Перейти к заказу</a></div>`;

const crumbsHtml = (items) => `
<nav class="crumbs wrap" aria-label="Хлебные крошки"><ol>${items
  .map(([href, t], i) => (i === items.length - 1 ? `<li><span aria-current="page">${t}</span></li>` : `<li><a href="${href}">${t}</a></li>`))
  .join('')}</ol></nav>`;
const crumbsLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([href, t], i) => ({ '@type': 'ListItem', position: i + 1, name: strip(t), item: site.baseUrl + href })),
});

const pages = [];
function page({ url, title, description, body, noindex = false, jsonld = [], current = url, sticky = false, crumbs = null }) {
  const ld = [...(crumbs ? [crumbsLd(crumbs)] : []), ...jsonld];
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : `<link rel="canonical" href="${site.baseUrl}${url}">`}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:locale" content="ru_RU">
<meta name="theme-color" content="#15140F">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n')}
</head>
<body${sticky ? ' class="has-sticky"' : ''}>
${header(current)}
<main id="main">${crumbs ? crumbsHtml(crumbs) : ''}${body}</main>
${footer()}
<script src="/assets/catalog.js"></script>
<script src="/assets/site.js"></script>
</body>
</html>
`;
  pages.push({ url, html, noindex });
}

// ── Компоненты ─────────────────────────────────────────
function picker(p, prefix) {
  return p.options
    .map((o) => {
      const name = `${prefix}-${o.key}`;
      if (o.type === 'swatch') {
        return `<fieldset class="swatches" data-opt="${o.key}"><legend class="field-legend">${o.label}</legend>${o.values
          .map((x, i) => `<label class="sw"><input type="radio" name="${name}" value="${x.v}"${i === 0 ? ' checked' : ''}><i style="--sw:${swatchVar(x.swatch)}"></i>${x.label}</label>`)
          .join('')}</fieldset>`;
      }
      const help = o.key === 'height' ? ' <a class="small" href="/sizes/">Таблица размеров</a>' : '';
      return `<fieldset class="seg" data-opt="${o.key}"><legend><span>${o.label}</span>${help}</legend>${o.values
        .map((v) => `<label><input type="radio" name="${name}" value="${v}"><span>${v}</span></label>`)
        .join('')}</fieldset>`;
    })
    .join('');
}
const firstStepLabel = (p) => {
  const seg = p.options.find((o) => o.type === 'seg');
  return seg ? `Выберите ${seg.choose || seg.label.split(',')[0].toLowerCase()}` : 'Добавить в заказ';
};

// Ростовки, доступные хотя бы в одном цвете (na с одним только height — рост недоступен целиком)
const heightsOf = (p) => (p.options.find((o) => o.key === 'height')?.values || [])
  .filter((h) => !p.na.some((n) => n.height === h && Object.keys(n).length === 1));

const card = (p, heading = 'h3') => `
<article class="pcard" data-card data-price="${p.priceFrom}" data-order="${p.order}" data-purpose="${p.purpose}" data-colors="${(p.options.find((o) => o.key === 'color')?.values || []).map((x) => x.v).join(' ')}" data-heights="${heightsOf(p).join(' ')}">
  ${p.flag ? `<div class="tags"><span class="tag${p.flag === 'new' ? ' tag--new' : ''}">${p.flag === 'new' ? 'Новинка' : 'Хит'}</span></div>` : ''}
  ${ph(p.photo, p.name)}
  <${heading}><a href="${p.url}">${p.name}</a></${heading}>
  <p class="small">${p.short}</p>
  <div class="pcard-meta"><span class="price">${priceLabel(p)}</span>${statusBadge(p)}</div>
</article>`;

const catTile = (c) => `
<a class="cat" href="/catalog/${c.slug}/">${ph(c.photo, c.name.toLowerCase(), 'r34')}<div class="cat-cap"><h3>${c.name}</h3><small>${plural(inCat(c.slug).length, c.unit)}&nbsp;→</small></div></a>`;

const stepsSection = (n = '05', cls = 'sec') => `
<section class="${cls}" aria-labelledby="how-h">
  <div class="wrap">
    <div class="sec-head"><span class="overline">${n} — Как заказать</span><h2 id="how-h">Четыре шага без&nbsp;предоплаты</h2></div>
    <ol class="steps">${content.steps.map(([h, t]) => `<li><h3>${h}</h3><p>${t}</p></li>`).join('')}</ol>
  </div>
</section>`;

const partnerSection = (n = '06') => `
<section class="sec sec--warm" aria-labelledby="ip-h">
  <div class="wrap partner">
    ${ph('light', 'фото: зал клуба ИППОН, тренировка', 'r43')}
    <div class="stack" style="gap:24px">
      <span class="overline">${n} — Партнёр</span>
      <h2 id="ip-h" class="partner-logo"><i>IPPON</i>${site.partner}</h2>
      <blockquote>${content.partner.quote}</blockquote>
      <cite>${content.partner.cite}</cite>
      <div class="flex"><a class="btn btn--secondary" href="/about/">О партнёрстве</a></div>
    </div>
  </div>
</section>`;

const sizeNoteSection = (extra = '') => `
<section class="sec ${extra}" aria-label="Про размер">
  <div class="wrap">
    <div class="size-note">
      <span class="big-num">~5%</span>
      <p>${content.sizeNote}</p>
      <a class="btn btn--secondary" href="/sizes/">Таблица размеров</a>
    </div>
  </div>
</section>`;

const faqList = (items) => `<div class="faq">${items.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>`;
const faqLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: strip(q), acceptedAnswer: { '@type': 'Answer', text: strip(a) } })),
});

const ctaSection = (n = '08') => `
<section class="sec sec--dark" aria-labelledby="cta-h">
  <div class="wrap cta-box">
    <div class="stack">
      <span class="overline">${n} — Связь</span>
      <h2 id="cta-h">Поможем подобрать размер</h2>
      <p class="lead">Пришлите рост и вес — ответим, какой размер брать и когда будет в наличии.</p>
    </div>
    <div class="cta-btns">
      <a class="btn btn--primary" href="${site.phoneHref}">Позвонить</a>
      <a class="btn btn--outline-dark" href="${site.whatsapp}" rel="noopener">WhatsApp</a>
      <a class="btn btn--outline-dark" href="${site.telegram}" rel="noopener">Telegram</a>
    </div>
  </div>
</section>`;

const sizeTable = (rows = content.sizes) => `
<div class="table-wrap"><table class="specs size-table">
  <thead><tr><th scope="col">Рост ребёнка / взрослого, см</th><th scope="col">Размер кимоно (ростовка)</th><th scope="col">Длина пояса, см</th></tr></thead>
  <tbody>${rows.map(([h, s, b]) => `<tr><td>${h}</td><td>${s}</td><td>${b}</td></tr>`).join('')}</tbody>
</table></div>`;

const localBusinessLd = {
  '@context': 'https://schema.org', '@type': 'SportingGoodsStore', name: site.name, url: site.baseUrl + '/',
  telephone: site.phone, email: site.email, openingHours: 'Mo-Sa 10:00-19:00',
  address: { '@type': 'PostalAddress', addressLocality: site.city, streetAddress: site.address, addressCountry: 'RU' },
};

// ── Главная ─────────────────────────────────────────────
const cfgModels = catalog.configurator.map((s) => bySlug[s]);
const hits = products.filter((p) => p.flag).concat(products.filter((p) => !p.flag)).slice(0, 4);
page({
  url: '/',
  title: `${site.name} — экипировка для дзюдо под заказ в Улан-Удэ`,
  description: 'Кимоно, пояса и аксессуары для дзюдо под заказ. Подбор размера с учётом усадки, оплата после подтверждения менеджером. Партнёр клуба «ИППОН».',
  jsonld: [localBusinessLd, faqLd(content.faq)],
  body: `
<section class="sec--dark hero" aria-labelledby="h1">
  <div class="wrap">
    <div class="hero-grid">
      <div class="hero-text">
        <span class="overline">${content.hero.overline}</span>
        <h1 id="h1">${content.hero.h1}</h1>
        <p class="lead">${content.hero.lead}</p>
        <div class="hero-cta">
          <a class="btn btn--primary" href="#cfg">Подобрать кимоно</a>
          <a class="btn btn--outline-dark" href="/catalog/">Каталог</a>
        </div>
      </div>
      ${ph('dark', content.hero.photo)}
    </div>
    <div class="facts">${content.hero.facts.map(([b, s]) => `<div><b>${b}</b><span class="small">${s}</span></div>`).join('')}</div>
  </div>
</section>

<section class="sec" id="cfg" aria-labelledby="cfg-h">
  <div class="wrap">
    <div class="sec-head"><span class="overline">01 — Конфигуратор</span><h2 id="cfg-h">Подберите кимоно за&nbsp;минуту</h2></div>
    <div class="cfg">
      ${ph(cfgModels[0].photo === 'blue' ? 'blue' : 'light', 'фото модели · меняется по цвету', 'r45', ' data-photo')}
      <form class="cfg-panel" data-buy data-cfg data-product="${cfgModels[0].slug}" novalidate>
        <fieldset class="models">
          <legend class="field-legend">Модель</legend>
          ${cfgModels.map((p, i) => `<label><input type="radio" name="cfg-model" value="${p.slug}"${i === 0 ? ' checked' : ''} data-model><span><span>${p.name.replace(/^Кимоно /, '').replace(/^./, (c) => c.toUpperCase())}<small>${p.short}</small></span><span class="price">${priceLabel(p)}</span></span></label>`).join('')}
        </fieldset>
        ${cfgModels.map((p, i) => `<div class="stack" style="gap:28px" data-picker-for="${p.slug}"${i ? ' hidden' : ''}>${picker(p, 'cfg-' + p.slug)}</div>`).join('')}
        <p class="opt-hint" data-hint aria-live="polite"></p>
        <div class="info">Кимоно садится на <b>~5%</b> после первой стирки — мы учитываем это при подборе.</div>
        <div class="cfg-total"><span data-status>${statusBadge(cfgModels[0])}</span><span class="price" data-price>${priceLabel(cfgModels[0])}</span></div>
        <button class="btn btn--primary btn--block" type="submit" data-add disabled>${firstStepLabel(cfgModels[0])}</button>
        <a class="btn btn--ghost" href="" data-product-link style="justify-self:start">Подробнее о модели →</a>
      </form>
    </div>
  </div>
</section>

<section class="sec sec--flush-top" id="cats" aria-labelledby="cats-h">
  <div class="wrap">
    <div class="sec-head sec-head--row"><div><span class="overline">02 — Каталог</span><h2 id="cats-h">Всё для татами</h2></div><a class="btn btn--ghost" href="/catalog/">Весь каталог →</a></div>
    <div class="cats">${cats.map(catTile).join('')}</div>
  </div>
</section>

<section class="sec sec--dark" aria-labelledby="det-h">
  <div class="wrap">
    <div class="sec-head"><span class="overline">03 — Качество</span><h2 id="det-h">Детали решают</h2><p class="lead">${content.details.lead}</p></div>
    <div class="mosaic">${content.details.items
      .map(([b, t, alt], i) => `<figure${i === 0 ? ' class="big"' : ''}>${ph('dark', alt, i === 0 ? 'r43' : 'r11')}<figcaption><b>${b}</b>${t}</figcaption></figure>`)
      .join('')}</div>
  </div>
</section>

<section class="sec sec--warm" aria-labelledby="hits-h">
  <div class="wrap">
    <div class="sec-head sec-head--row"><div><span class="overline">04 — Выбор зала</span><h2 id="hits-h">Берут чаще всего</h2></div><a class="btn btn--ghost" href="/catalog/">Весь каталог →</a></div>
    <div class="grid-4">${hits.map((p) => card(p)).join('')}</div>
  </div>
</section>

${stepsSection('05')}
${partnerSection('06')}
${sizeNoteSection('sec--flush-bottom')}

<section class="sec" aria-labelledby="faq-h">
  <div class="wrap faq-grid">
    <div class="stack">
      <span class="overline">07 — Вопросы</span>
      <h2 id="faq-h">Частые вопросы</h2>
      <p class="small">Не нашли ответ? <a href="/contacts/#ask">Напишите нам</a> — ответим в течение дня.</p>
    </div>
    ${faqList(content.faq)}
  </div>
</section>

${ctaSection('08')}`,
});

// ── Каталог ─────────────────────────────────────────────
page({
  url: '/catalog/',
  title: 'Экипировка для дзюдо: кимоно, пояса, аксессуары — Улан-Удэ',
  description: 'Каталог экипировки для дзюдо под заказ: кимоно, пояса и аксессуары. Подбор размера, оплата после подтверждения, доставка по России.',
  crumbs: [['/', 'Главная'], ['/catalog/', 'Каталог']],
  body: `
<div class="wrap page-head"><h1>Экипировка для&nbsp;дзюдо</h1><p class="lead">Всё, что нужно на тренировке и турнире. Работаем под заказ: собираете список, менеджер подтверждает наличие и размер, оплата — после подтверждения.</p></div>
<section class="sec sec--flush-top" aria-label="Категории"><div class="wrap"><div class="cats">${cats.map(catTile).join('')}</div></div></section>
<section class="sec sec--warm" aria-labelledby="all-h"><div class="wrap">
  <div class="sec-head"><h2 id="all-h">Все товары</h2></div>
  <div class="grid-4">${products.map((p) => card(p)).join('')}</div>
</div></section>
${stepsSection('01')}`,
});

for (const c of cats) {
  const list = inCat(c.slug);
  const purposes = [...new Set(list.map((p) => p.purpose))];
  const hasColor = list.some((p) => p.options.some((o) => o.key === 'color'));
  const heights = [...new Set(list.flatMap(heightsOf))].sort((a, b) => a - b);
  const chips = (name, legend, items) => `<fieldset class="chips"><legend>${legend}</legend>${items
    .map(([v, t]) => `<label><input type="checkbox" name="${name}" value="${v}"><span>${t}</span></label>`)
    .join('')}</fieldset>`;
  page({
    url: `/catalog/${c.slug}/`,
    title: c.title,
    description: c.description,
    crumbs: [['/', 'Главная'], ['/catalog/', 'Каталог'], [`/catalog/${c.slug}/`, c.name]],
    body: `
<div class="wrap page-head"><h1>${c.h1}</h1><p class="lead">${c.intro}</p></div>
<section class="sec sec--flush-top" aria-label="Товары"><div class="wrap">
  <form class="toolbar" data-filter aria-label="Фильтры и сортировка">
    <div class="flex">
      ${purposes.length > 1 ? chips('purpose', 'Назначение', [['training', 'Тренировки'], ['competition', 'Соревнования']]) : ''}
      ${heights.length ? chips('height', 'Рост, см', heights.map((h) => [h, h])) : ''}
      ${hasColor ? chips('color', 'Цвет', [['white', 'Белое'], ['blue', 'Синее']]) : ''}
    </div>
    <label class="sort"><span>Сортировка</span><select name="sort"><option value="order">Сначала популярные</option><option value="asc">Дешевле</option><option value="desc">Дороже</option></select></label>
  </form>
  <p class="small" data-filter-count data-unit="${esc(JSON.stringify(c.unit))}" aria-live="polite">${plural(list.length, c.unit)}</p>
  <div class="grid-3" data-grid style="margin-top:16px">${list.map((p) => card(p, 'h2')).join('')}</div>
  <p class="empty-filter" data-filter-empty hidden>Под выбранные фильтры ничего нет. <button class="btn btn--ghost" type="button" data-filter-reset>Сбросить фильтры</button></p>
</div></section>
${c.slug === 'kimono' ? sizeNoteSection('sec--flush-top') : ''}
<section class="sec sec--warm" aria-labelledby="seo-h"><div class="wrap stack" style="gap:24px">
  <h2 id="seo-h">Как выбрать: ${c.name.toLowerCase()}</h2>
  <div class="prose"><p>${c.seo}</p></div>
  <div class="siblings">${cats.filter((x) => x !== c).map((x) => `<a class="btn btn--secondary" href="/catalog/${x.slug}/">${x.name} →</a>`).join('')}</div>
</div></section>`,
  });
}

// ── Карточки товаров ────────────────────────────────────
for (const p of products) {
  const c = catBySlug[p.cat];
  const gallery = [
    [p.photo, `${p.name} — общий вид`],
    [p.photo, 'вид сзади'],
    ['dark', 'макро: ткань и швы'],
    ['dark', 'макро: детали'],
  ];
  const related = (p.related || []).map((s) => bySlug[s]).filter(Boolean);
  const hasHeight = p.options.some((o) => o.key === 'height');
  page({
    url: p.url,
    title: `${p.name} — купить под заказ в Улан-Удэ`,
    description: `${p.name}: ${p.short}. ${priceLabel(p).replace(NB, ' ')}. ${p.lead}`.slice(0, 300),
    sticky: true,
    crumbs: [['/', 'Главная'], [`/catalog/${c.slug}/`, c.name], [p.url, p.name]],
    jsonld: [{
      '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.lead, sku: p.slug,
      category: c.name, url: site.baseUrl + p.url,
      offers: {
        '@type': 'AggregateOffer', priceCurrency: 'RUB', lowPrice: p.priceFrom,
        highPrice: Math.max(...p.variants.map((v) => v.price)), offerCount: p.variants.length,
        availability: 'https://schema.org/PreOrder',
      },
    }],
    body: `
<div class="wrap" style="padding-top:24px">
  <div class="product">
    <div class="gallery" data-gallery>
      ${ph(p.photo, gallery[0][1], 'r45', ' data-photo data-gallery-main')}
      <div class="thumbs">${gallery
        .map(([k, l], i) => `<button type="button" aria-label="Фото ${i + 1}: ${l}" aria-pressed="${i === 0}" data-kind="${k}" data-label="${esc(l)}">${ph(k, '', 'r11')}</button>`)
        .join('')}</div>
    </div>
    <form class="buy" id="buy" data-buy data-product="${p.slug}" novalidate>
      <div class="stack" style="gap:12px">
        ${p.flag ? `<span><span class="tag${p.flag === 'new' ? ' tag--new' : ''}">${p.flag === 'new' ? 'Новинка' : 'Хит'}</span></span>` : ''}
        <h1>${p.name}</h1>
        <span data-status>${statusBadge(p)}</span>
      </div>
      <p class="small">${p.lead}</p>
      <div class="buy-price"><span class="price" data-price>${priceLabel(p)}</span><span class="small">цена ориентировочная</span></div>
      ${p.options.length ? `<div class="stack" style="gap:24px">${picker(p, 'buy')}</div>` : ''}
      <p class="opt-hint" data-hint aria-live="polite"></p>
      <button class="btn btn--primary btn--block" type="submit" data-add${p.options.some((o) => o.type === 'seg') ? ' disabled' : ''}>${firstStepLabel(p)}</button>
      <div class="info"><b>Оплата после подтверждения.</b> Менеджер свяжется, уточнит наличие и размер. <a href="/how-to-order/">Как заказать</a></div>
      ${hasHeight ? `<p class="small">Кимоно садится на ~5% после первой стирки. Между размерами — берите больший. <a href="/sizes/">Таблица размеров</a></p>` : ''}
    </form>
  </div>
</div>
<nav class="anchors wrap" aria-label="Разделы товара"><a href="#specs">Характеристики</a>${hasHeight ? '<a href="#size">Размер</a>' : ''}<a href="#care">Уход</a>${related.length ? '<a href="#related">С этим берут</a>' : ''}</nav>
<div class="wrap pinfo">
  <section id="specs" aria-labelledby="specs-h"><h2 id="specs-h">Характеристики</h2>
    <table class="specs"><tbody>${p.specs.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
  </section>
  ${hasHeight ? `<section id="size" aria-labelledby="size-h"><h2 id="size-h">Размер</h2>
    <p>Размер кимоно — это рост, на который оно рассчитано. Учитывайте усадку ~5% после первой стирки.</p>
    ${sizeTable(content.sizes.filter(([, s]) => p.options.find((o) => o.key === 'height').values.includes(s)))}
    <p><a class="btn btn--ghost" href="/sizes/">Подробнее о подборе размера →</a></p>
  </section>` : ''}
  <section id="care" aria-labelledby="care-h"><h2 id="care-h">Уход</h2><div class="prose"><ul>${p.care.map((t) => `<li>${t}</li>`).join('')}</ul></div></section>
</div>
${related.length ? `<section class="sec" id="related" aria-labelledby="rel-h"><div class="wrap"><div class="sec-head"><h2 id="rel-h">С этим берут</h2></div><div class="grid-4">${related.map((r) => card(r)).join('')}</div></div></section>` : '<div class="sec sec--flush-top"></div>'}
<div class="sticky-bar" aria-label="Быстрое добавление"><span class="price" data-sticky-price>${priceLabel(p)}</span><button class="btn btn--primary" type="button" data-sticky-add>${firstStepLabel(p)}</button></div>`,
  });
}

// ── Мой заказ ───────────────────────────────────────────
page({
  url: '/order/',
  title: `Мой заказ — ${site.name}`,
  description: 'Список товаров для заявки. Менеджер свяжется для подтверждения, оплата после подтверждения.',
  noindex: true,
  sticky: true,
  body: `
<div class="wrap page-head">
  <h1>Мой заказ</h1>
  <p class="lead">Это предварительная заявка. Менеджер свяжется с вами для уточнения наличия, подбора размера и согласования доставки. Оплата — после подтверждения заказа.</p>
</div>
<section class="sec sec--flush-top"><div class="wrap">
  <div class="empty" data-order-empty hidden>
    <span class="belt-icon" aria-hidden="true"></span>
    <h2>Пока пусто</h2>
    <p class="lead">Добавьте кимоно, пояс или аксессуары — или подберите кимоно в конфигураторе.</p>
    <div class="flex">${cats.map((c) => `<a class="btn btn--secondary" href="/catalog/${c.slug}/">${c.name}</a>`).join('')}<a class="btn btn--primary" href="/#cfg">Подобрать кимоно</a></div>
  </div>
  <div class="order" data-order-filled>
    <div data-order-list aria-live="polite"><noscript><p class="info">Для оформления заявки включите JavaScript или позвоните нам: <a href="${site.phoneHref}">${site.phone}</a>.</p></noscript></div>
    <form class="order-side" id="order-form" data-lead-form="order" novalidate>
      <div class="total"><span>Итого <span class="small">ориентировочно</span></span><span class="price" data-order-total>0&nbsp;₽</span></div>
      <div class="info"><b>Оплата после подтверждения.</b> Итоговую сумму и сроки назовёт менеджер.</div>
      <div class="form-grid">
        <div class="field"><label for="o-name">Имя</label><input id="o-name" name="name" autocomplete="name" placeholder="Как к вам обращаться" required aria-describedby="o-name-e"><span class="err" id="o-name-e"></span></div>
        <div class="field"><label for="o-phone">Телефон</label><input id="o-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+7" required aria-describedby="o-phone-e"><span class="err" id="o-phone-e"></span></div>
        <fieldset class="contact-pick"><legend class="field-legend">Как с вами связаться</legend>
          <label><input type="radio" name="contact" value="phone" checked><span>Телефон</span></label>
          <label><input type="radio" name="contact" value="whatsapp"><span>WhatsApp</span></label>
          <label><input type="radio" name="contact" value="telegram"><span>Telegram</span></label>
        </fieldset>
        <fieldset class="contact-pick contact-pick--2"><legend class="field-legend">Получение</legend>
          <label><input type="radio" name="delivery" value="pickup" checked><span>Самовывоз, ${site.city}</span></label>
          <label><input type="radio" name="delivery" value="russia"><span>Доставка по России</span></label>
        </fieldset>
        <div class="field" data-city hidden><label for="o-city">Город</label><input id="o-city" name="city" autocomplete="address-level2" placeholder="Куда доставить"></div>
        <div class="field"><label for="o-comment">Комментарий</label><textarea id="o-comment" name="comment" placeholder="Рост и вес ребёнка, пожелания"></textarea></div>
        <label class="check"><input type="checkbox" name="consent" required>Согласен на обработку персональных данных по&nbsp;<a href="/privacy/">политике</a></label>
        <p class="form-error" data-form-error role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Отправить заявку</button>
      </div>
    </form>
  </div>
</div></section>
<div class="sticky-bar" data-order-sticky><button class="btn btn--primary" type="submit" form="order-form">Отправить заявку</button></div>`,
});

page({
  url: '/order/sent/',
  title: `Заявка отправлена — ${site.name}`,
  description: 'Спасибо! Менеджер свяжется с вами для подтверждения заказа.',
  noindex: true,
  body: `
<div class="wrap center-page">
  <span class="overline">Заявка отправлена</span>
  <h1>Спасибо!</h1>
  <p class="lead">Номер заявки: <span class="order-no" data-order-no>—</span></p>
  <ol class="steps" style="width:100%">
    <li><h3>В течение дня</h3><p>Менеджер позвонит или напишет удобным вам способом.</p></li>
    <li><h3>Подтвердим</h3><p>Наличие, размер, сроки и итоговую сумму.</p></li>
    <li><h3>Оплата</h3><p>Только после подтверждения заказа.</p></li>
    <li><h3>Получение</h3><p>Самовывоз в ${site.city} или доставка по России.</p></li>
  </ol>
  <p>Если хотите что-то уточнить: <a href="${site.phoneHref}">${site.phone}</a> · <a href="${site.whatsapp}" rel="noopener">WhatsApp</a> · <a href="${site.telegram}" rel="noopener">Telegram</a></p>
  <a class="btn btn--primary" href="/catalog/">Вернуться в каталог</a>
</div>`,
});

// ── Информационные страницы ─────────────────────────────
page({
  url: '/sizes/',
  title: 'Как подобрать размер кимоно для дзюдо — таблица размеров',
  description: 'Таблица размеров кимоно по росту, длина пояса, как мерить и как учитывать усадку 5% после стирки.',
  crumbs: [['/', 'Главная'], ['/sizes/', 'Размеры']],
  body: `
<div class="wrap page-head"><h1>Как подобрать размер</h1><p class="lead">Размер кимоно для дзюдо — это рост в сантиметрах, на который оно рассчитано. Длину пояса подбираем по размеру кимоно.</p></div>
<section class="sec sec--flush-top"><div class="wrap stack" style="gap:48px">
  <div class="stack" style="gap:20px"><h2>Таблица размеров</h2>${sizeTable()}</div>
  <div class="prose">
    <h2>Как мерить</h2>
    <ol><li>Встаньте ровно у стены без обуви.</li><li>Отметьте макушку и измерьте расстояние от пола.</li><li>Если рост между значениями — берите больший размер.</li></ol>
    <h2>Усадка ~5%</h2>
    <p>Хлопковое кимоно садится после первой стирки — примерно на 5% по длине рукавов и брюк. Растущему ребёнку берите с запасом. Если кимоно нужно на соревнования уже завтра — берите точно по росту и стирайте при 30 °C.</p>
    <h2>Длина пояса</h2>
    <p>Пояс оборачивается вокруг талии дважды, концы после узла свисают на 20–30 см.</p>
  </div>
</div></section>
${ctaSection('—')}`,
});

page({
  url: '/how-to-order/',
  title: 'Как заказать экипировку для дзюдо: оплата, доставка, возврат',
  description: 'Как оформить заявку, когда платить, доставка по Улан-Удэ и России, сроки, обмен и возврат.',
  crumbs: [['/', 'Главная'], ['/how-to-order/', 'Как заказать']],
  jsonld: [faqLd(content.faq)],
  body: `
<div class="wrap page-head"><h1>Как заказать</h1><p class="lead">Работаем без предоплаты: сначала подтверждаем наличие и размер, потом вы платите.</p></div>
${stepsSection('01', 'sec sec--flush-top')}
<section class="sec sec--warm"><div class="wrap prose">
  <h2>Оплата</h2><p>После звонка менеджера и подтверждения заказа: перевод по реквизитам, оплата картой по ссылке или наличными при самовывозе.</p>
  <h2>Доставка и самовывоз</h2><p>Самовывоз в ${site.city} — ${site.address}, ${site.hours}. По России отправляем транспортными компаниями, стоимость рассчитаем при подтверждении.</p>
  <h2>Сроки</h2><p>Если модель есть у поставщика — 5–10 дней. Нашивки и позиции «под заказ» — около двух недель.</p>
  <h2>Обмен и возврат</h2><p>Обменяем или вернём изделие, если его не стирали и сохранены бирки. Нашивки с фамилией изготавливаются индивидуально и возврату не подлежат.</p>
</div></section>
<section class="sec" aria-labelledby="faq-h"><div class="wrap faq-grid">
  <div class="stack"><h2 id="faq-h">Частые вопросы</h2><p class="small">Не нашли ответ? <a href="/contacts/#ask">Напишите нам</a>.</p></div>
  ${faqList(content.faq)}
</div></section>`,
});

page({
  url: '/about/',
  title: `О магазине ${site.name} и партнёрстве с клубом «ИППОН»`,
  description: `${site.name} — экипировка для дзюдо под заказ в Улан-Удэ. Партнёр клуба дзюдо «ИППОН».`,
  crumbs: [['/', 'Главная'], ['/about/', 'О магазине']],
  body: `
<div class="wrap page-head"><h1>О магазине</h1><p class="lead">Мы подбираем экипировку для дзюдо под конкретного спортсмена: по росту, возрасту и правилам соревнований.</p></div>
<section class="sec sec--flush-top"><div class="wrap prose">
  <h2>Почему нам доверяют</h2>
  <ul>
    <li>Каждую заявку подтверждает менеджер: наличие, размер, сроки — до оплаты.</li>
    <li>Показываем ткань и швы вблизи — как проверяет тренер.</li>
    <li>Учитываем усадку ~5% при подборе размера.</li>
    <li>${content.partner.fact}.</li>
  </ul>
</div></section>
${partnerSection('Партнёр')}
<section class="sec"><div class="wrap flex"><a class="btn btn--primary" href="/catalog/">Перейти в каталог</a><a class="btn btn--secondary" href="/contacts/">Контакты</a></div></section>`,
});

page({
  url: '/contacts/',
  title: `Контакты ${site.name} — ${site.city}`,
  description: `Телефон, WhatsApp, Telegram, адрес и режим работы магазина ${site.name} в Улан-Удэ.`,
  crumbs: [['/', 'Главная'], ['/contacts/', 'Контакты']],
  jsonld: [localBusinessLd],
  body: `
<div class="wrap page-head"><h1>Контакты</h1><p class="lead">Ответим в течение дня. Удобнее всего — в мессенджере.</p></div>
<section class="sec sec--flush-top"><div class="wrap contacts-grid">
  <div class="stack" style="gap:24px">
    <dl class="dl">
      <div><dt>Телефон</dt><dd><a href="${site.phoneHref}">${site.phone}</a></dd></div>
      <div><dt>Мессенджеры</dt><dd><a href="${site.whatsapp}" rel="noopener">WhatsApp</a> · <a href="${site.telegram}" rel="noopener">Telegram</a></dd></div>
      <div><dt>E-mail</dt><dd><a href="mailto:${site.email}">${site.email}</a></dd></div>
      <div><dt>Адрес</dt><dd>${site.address}</dd></div>
      <div><dt>Режим работы</dt><dd>${site.hours}</dd></div>
      <div><dt>Реквизиты</dt><dd>${site.legal}</dd></div>
    </dl>
    ${ph('light', 'карта: виджет Яндекс.Карт по адресу из NAP', 'r43')}
  </div>
  <form class="order-side" id="ask" data-lead-form="question" novalidate>
    <h2>Задать вопрос</h2>
    <div class="field"><label for="q-name">Имя</label><input id="q-name" name="name" autocomplete="name" required aria-describedby="q-name-e"><span class="err" id="q-name-e"></span></div>
    <div class="field"><label for="q-phone">Телефон</label><input id="q-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+7" required aria-describedby="q-phone-e"><span class="err" id="q-phone-e"></span></div>
    <fieldset class="contact-pick"><legend class="field-legend">Как с вами связаться</legend>
      <label><input type="radio" name="contact" value="phone" checked><span>Телефон</span></label>
      <label><input type="radio" name="contact" value="whatsapp"><span>WhatsApp</span></label>
      <label><input type="radio" name="contact" value="telegram"><span>Telegram</span></label>
    </fieldset>
    <div class="field"><label for="q-msg">Вопрос</label><textarea id="q-msg" name="comment" placeholder="Например: рост 142, вес 35 — какой размер брать?"></textarea></div>
    <label class="check"><input type="checkbox" name="consent" required>Согласен на обработку персональных данных по&nbsp;<a href="/privacy/">политике</a></label>
    <p class="form-error" data-form-error role="alert"></p>
    <button class="btn btn--primary btn--block" type="submit">Отправить вопрос</button>
  </form>
</div></section>`,
});

page({
  url: '/privacy/',
  title: `Политика обработки персональных данных — ${site.name}`,
  description: 'Политика обработки персональных данных посетителей сайта.',
  crumbs: [['/', 'Главная'], ['/privacy/', 'Политика ПДн']],
  body: `
<div class="wrap page-head"><h1>Политика обработки персональных данных</h1><p class="small">Шаблон. Юридический текст готовит заказчик (оператор ПДн) по 152-ФЗ; ниже — обязательная структура.</p></div>
<section class="sec sec--flush-top"><div class="wrap prose">
  <h2>1. Оператор</h2><p>${site.legal}, ${site.address}, ${site.email}.</p>
  <h2>2. Какие данные собираем</h2><p>Имя, телефон, предпочтительный способ связи, город доставки и комментарий — из форм «Мой заказ» и «Задать вопрос».</p>
  <h2>3. Цели обработки</h2><p>Связаться с вами для подтверждения заявки, подбора размера и доставки.</p>
  <h2>4. Сроки хранения</h2><p>Не дольше, чем нужно для выполнения заявки, либо до отзыва согласия.</p>
  <h2>5. Права субъекта</h2><p>Вы можете запросить сведения о своих данных, их уточнение или удаление, написав на ${site.email}.</p>
</div></section>`,
});

page({
  url: '/404',
  title: `Страница не найдена — ${site.name}`,
  description: 'Такой страницы нет.',
  noindex: true,
  body: `
<div class="wrap center-page">
  <span class="overline">Ошибка 404</span>
  <h1>Такой страницы нет</h1>
  <p class="lead">Возможно, товар переехал. Загляните в каталог или напишите нам — подберём.</p>
  <div class="flex"><a class="btn btn--primary" href="/catalog/">В каталог</a>${cats.map((c) => `<a class="btn btn--secondary" href="/catalog/${c.slug}/">${c.name}</a>`).join('')}</div>
</div>`,
});

// ── Запись ──────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
for (const { url, html } of pages) {
  const file = url === '/404' ? path.join(OUT, '404.html') : path.join(OUT, url, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}
fs.cpSync(path.join(SRC, 'assets'), path.join(OUT, 'assets'), { recursive: true });

// Данные для островков JS: те же варианты, что и в разметке (конфигуратор не дублирует каталог)
// ORDER_ENDPOINT из окружения (деплой) перекрывает site.json
const endpoint = process.env.ORDER_ENDPOINT || site.orderEndpoint;
if (!endpoint) console.warn('⚠ orderEndpoint не задан: форма покажет «Заявка отправлена», но заявку никуда не отправит. Для прода задайте ORDER_ENDPOINT.');
const clientCatalog = {
  endpoint,
  products: Object.fromEntries(products.map((p) => [p.slug, {
    name: p.name, url: p.url, photo: p.photo, status: p.status || null, priceFrom: p.priceFrom,
    options: p.options.map((o) => ({ key: o.key, label: o.label, choose: o.choose, type: o.type })),
    variants: p.variants,
  }])),
};
fs.writeFileSync(path.join(OUT, 'assets', 'catalog.js'), `window.CATALOG=${JSON.stringify(clientCatalog)};\n`);

const indexable = pages.filter((p) => !p.noindex);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map((p) => `  <url><loc>${site.baseUrl}${p.url}</loc></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nDisallow: /order/\nSitemap: ${site.baseUrl}/sitemap.xml\n`);

console.log(`✓ МИР ДЗЮДО: ${pages.length} страниц (${indexable.length} в sitemap), ${products.length} товаров, ${products.reduce((n, p) => n + p.variants.length, 0)} SKU → ${path.relative(process.cwd(), OUT)}/`);
