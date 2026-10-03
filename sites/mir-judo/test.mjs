#!/usr/bin/env node
// Смоук-тест собранного сайта: node build.mjs && node test.mjs (jsdom из корневого node_modules).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const BASE = 'http://stand.local';
const fileFor = (url) => path.join(DIST, url.endsWith('/') ? url + 'index.html' : url);
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };

// Одно хранилище на все «вкладки», как в браузере
let store = {};
function open(url) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const html = fs.readFileSync(fileFor(url.split('?')[0]), 'utf8')
    .replace(/<script src="\/assets\/(\w+)\.js"><\/script>/g, (_, f) => `<script>${fs.readFileSync(path.join(DIST, 'assets', f + '.js'), 'utf8')}</script>`);
  const dom = new JSDOM(html, {
    url: BASE + url, runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.clear();
      for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
      w.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  const w = dom.window;
  const save = () => { store = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); store[k] = w.localStorage.getItem(k); } };
  const change = (el) => { el.checked = true; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  return { w, d: w.document, $: (s) => w.document.querySelector(s), $$: (s) => [...w.document.querySelectorAll(s)], errors, save, change };
}

// 1. Все страницы: без ошибок JS, один h1, внутренние ссылки ведут на существующие файлы
const pages = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory() && f.name !== 'assets') walk(p);
    else if (f.name.endsWith('.html')) pages.push('/' + path.relative(DIST, p).replace(/index\.html$/, ''));
  }
})(DIST);
for (const url of pages) {
  const { $$, errors, d } = open(url);
  assert.deepEqual(errors, [], `${url}: ошибки JS`);
  assert.equal($$('h1').length, 1, `${url}: должен быть ровно один h1`);
  for (const a of $$('a[href^="/"]')) {
    const href = a.getAttribute('href').split('#')[0].split('?')[0];
    assert.ok(fs.existsSync(fileFor(href)), `${url}: битая ссылка ${href}`);
  }
  const noindex = !!d.querySelector('meta[name=robots][content*=noindex]');
  assert.ok(noindex || d.querySelector('link[rel=canonical]'), `${url}: нет canonical`);
  for (const s of $$('script[type="application/ld+json"]')) JSON.parse(s.textContent);
}
ok(`${pages.length} страниц: без ошибок JS, один h1, ссылки целы, canonical/noindex, JSON-LD валиден`);

// 2. Конфигуратор на главной
{
  const { $, $$, change, save } = open('/');
  const btn = $('[data-cfg] [data-add]');
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Выберите рост');
  change($('input[name="cfg-kimono-sensei-height"][value="150"]'));
  assert.equal(btn.disabled, false);
  assert.equal($('[data-cfg] [data-price]').textContent, '5 400 ₽');
  change($('input[name="cfg-kimono-sensei-height"][value="190"]'));
  assert.equal(btn.disabled, true, '190 у «Сэнсэй» нет');
  assert.match($('[data-cfg] [data-hint]').textContent, /недоступен/);
  // Смена модели сохраняет рост и цвет
  change($('input[name="cfg-kimono-sensei-height"][value="180"]'));
  change($('input[name="cfg-kimono-sensei-color"][value="blue"]'));
  assert.ok($('[data-photo]').classList.contains('ph--blue'), 'фото синее');
  change($('input[data-model][value="kimono-ippon"]'));
  assert.equal($('[data-picker-for="kimono-ippon"]').hidden, false);
  assert.equal($('input[name="cfg-kimono-ippon-height"][value="180"]').checked, true);
  assert.equal($('input[name="cfg-kimono-ippon-color"][value="blue"]').checked, true);
  assert.equal($('[data-cfg] [data-price]').textContent, '9 400 ₽');
  assert.ok($('input[name="cfg-kimono-ippon-height"][value="200"]').parentNode.classList.contains('na'), '200 синее — нет');
  btn.click();
  assert.ok($('#toast').classList.contains('is-on'));
  assert.equal($('[data-order-count]').textContent, '1');
  assert.equal($('[data-order-link]').getAttribute('aria-label'), 'Мой заказ, 1 позиция');
  save();
}
ok('конфигуратор: цена по росту, «нет размера», смена модели, добавление в заказ, счётчик');

// 3. Карточка товара: пояс (длина + цвет), sticky-бар
{
  const { $, change, save } = open('/catalog/belts/belt-color/');
  assert.equal($('[data-add]').textContent, 'Выберите длину');
  change($('input[name="buy-belt"][value="yellow"]'));
  change($('input[name="buy-length"][value="260"]'));
  assert.equal($('[data-sticky-price]').textContent, '690 ₽');
  $('[data-sticky-add]').click();
  $('[data-sticky-add]').click();
  save();
}
{
  const { $ } = open('/catalog/accessories/bag/');
  assert.equal($('[data-add]').disabled, false, 'товар без опций сразу доступен');
}
ok('карточка: варианты, sticky-кнопка, товар без опций');

// 4. Фильтры категории
{
  const { $, $$, change } = open('/catalog/kimono/');
  change($('input[name="purpose"][value="competition"]'));
  assert.equal($$('[data-card]:not([hidden])').length, 1);
  const sel = $('select[name=sort]'); sel.value = 'desc'; sel.dispatchEvent(new sel.ownerDocument.defaultView.Event('change', { bubbles: true }));
  $('[data-filter-reset]').click();
  assert.equal($$('[data-card]:not([hidden])').length, 3);
  assert.match($$('[data-card]')[0].querySelector('h2').textContent, /Иппон/, 'сортировка «дороже»');
  const visible = () => $$('[data-card]:not([hidden])').map((c) => c.querySelector('h2').textContent);
  change($('input[name="height"][value="190"]'));
  assert.deepEqual(visible(), ['Кимоно соревновательное «Иппон»'], '190 у «Сэнсэй» недоступен');
  $('[data-filter-reset]').click();
  change($('input[name="height"][value="110"]'));
  assert.deepEqual(visible(), ['Кимоно детское «Старт»']);
  $('[data-filter-reset]').click();
}
ok('категория: фильтр по назначению и росту, сортировка, сброс');

// 5. «Мой заказ»: позиции, количество, итог, валидация, отправка
{
  const { w, $, $$, save } = open('/order/');
  assert.equal($('[data-order-empty]').hidden, true);
  assert.equal($$('.line-item').length, 2);
  assert.equal($('[data-order-total]').textContent, '10 780 ₽'); // 9 400 + 2 × 690
  $$('.line-item')[1].querySelector('[data-dec]').click();
  assert.equal($('[data-order-total]').textContent, '10 090 ₽');
  const form = $('#order-form');
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  assert.equal($('#o-phone').getAttribute('aria-invalid'), 'true');
  assert.match($('[data-form-error]').textContent, /Проверьте/);
  $('#o-name').value = 'Анна'; $('#o-phone').value = '+7 914 123-45-67'; form.elements.consent.checked = true;
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  assert.equal($('[data-form-error]').textContent, '');
  assert.ok(form.querySelector('[data-loading]'), 'кнопка в состоянии отправки');
  save();
}
ok('мой заказ: список, −/+, итог, ошибки полей, отправка');

// 6. Пустой заказ
{
  store = {};
  const { $ } = open('/order/');
  assert.equal($('[data-order-empty]').hidden, false);
  assert.equal($('[data-order-filled]').hidden, true);
}
ok('мой заказ: пустое состояние');

// 7. sitemap без служебных страниц
{
  const sm = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
  assert.ok(!/\/order\//.test(sm) && !/404/.test(sm));
  assert.ok(sm.includes('/catalog/kimono/kimono-sensei/'));
}
ok('sitemap.xml: только индексируемые URL');

console.log(`\n${passed} проверок пройдено`);
