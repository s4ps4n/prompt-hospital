// Островки vanilla JS «МИР ДЗЮДО»: выбор варианта, «Мой заказ», фильтры, меню, формы заявки.
// Данные вариантов — window.CATALOG (генерирует build.mjs из того же каталога, что и разметку).
// Без JS страницы читаемы: каталог, карточки, FAQ (<details>), контакты работают.
(() => {
  'use strict';
  const CATALOG = window.CATALOG || { products: {}, endpoint: '' };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const NB = ' ';
  const money = (n) => n.toLocaleString('ru-RU').replace(/\s/g, NB) + NB + '₽';
  const plural = (n, [one, few, many]) => {
    const m10 = n % 10, m100 = n % 100;
    return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Хранилище «Мой заказ» ─────────────────────────────
  const KEY = 'mir-judo:order';
  const load = () => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY)) || [];
      // отбрасываем позиции, которых больше нет в каталоге
      return list.filter((it) => findVariant(it.slug, it.sku));
    } catch { return []; }
  };
  const save = (list) => {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* приватный режим: заказ живёт до перезагрузки */ }
    renderCount(list);
  };
  function findVariant(slug, sku) {
    const p = CATALOG.products[slug];
    return p && p.variants.find((v) => v.sku === sku);
  }
  function addToOrder(slug, sku) {
    const list = load();
    const it = list.find((x) => x.sku === sku);
    if (it) it.qty = Math.min(99, it.qty + 1);
    else list.push({ slug, sku, qty: 1 });
    save(list);
  }
  function renderCount(list = load()) {
    const n = list.reduce((s, x) => s + x.qty, 0);
    $$('[data-order-count]').forEach((el) => { el.textContent = n > 99 ? '99+' : String(n); el.hidden = n === 0; });
    $$('[data-order-link]').forEach((el) => el.setAttribute('aria-label', n ? `Мой заказ, ${plural(n, ['позиция', 'позиции', 'позиций'])}` : 'Мой заказ'));
  }

  // ── Toast ──────────────────────────────────────────────
  let toastTimer;
  function toast(text) {
    const el = $('#toast');
    if (!el) return;
    $('[data-toast-text]', el).textContent = text;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), 4000);
  }

  // ── Выбор варианта (карточка товара и конфигуратор) ────
  function initBuy(form) {
    const status = $('[data-status]', form);
    const price = $('[data-price]', form);
    const hint = $('[data-hint]', form);
    const add = $('[data-add]', form);
    const photo = form.hasAttribute('data-cfg') ? $('[data-photo]', form.closest('.cfg')) : $('[data-gallery-main]');
    const stickyPrice = $('[data-sticky-price]');
    const stickyAdd = $('[data-sticky-add]');
    const link = $('[data-product-link]', form);

    const product = () => CATALOG.products[form.dataset.product];
    const scope = () => $(`[data-picker-for="${form.dataset.product}"]`, form) || form;
    const selection = () => {
      const p = product(), sel = {};
      for (const o of p.options) {
        const r = $(`[data-opt="${o.key}"] input:checked`, scope());
        if (r) sel[o.key] = r.value;
      }
      return sel;
    };
    const matches = (v, sel) => Object.entries(sel).every(([k, val]) => v.sel[k] === val);

    function update() {
      const p = product();
      if (!p) return;
      const sel = selection();
      const missing = p.options.filter((o) => !(o.key in sel));

      // Помечаем значения, для которых при текущем выборе других опций нет доступного варианта
      for (const o of p.options) {
        const others = Object.fromEntries(Object.entries(sel).filter(([k]) => k !== o.key));
        $$(`[data-opt="${o.key}"] input`, scope()).forEach((inp) => {
          const ok = p.variants.some((v) => v.available && v.sel[o.key] === inp.value && matches(v, others));
          inp.closest('label').classList.toggle('na', !ok);
          if (ok) inp.removeAttribute('aria-disabled'); else inp.setAttribute('aria-disabled', 'true');
          const cap = inp.nextElementSibling;
          if (cap && o.type === 'seg') cap.title = ok ? '' : 'Нет размера';
        });
      }

      const cands = p.variants.filter((v) => matches(v, sel));
      const v = missing.length ? null : cands[0];
      const lo = Math.min(...cands.map((x) => x.price)), hi = Math.max(...cands.map((x) => x.price));
      const priceText = v ? money(v.price) : lo === hi ? money(lo) : `от${NB}${money(lo)}`;
      if (price) price.textContent = priceText;

      let label, disabled, note = '';
      if (missing.length) {
        const first = missing[0];
        label = `Выберите ${first.choose || first.label.split(',')[0].toLowerCase()}`;
        disabled = true;
      } else if (!v.available) {
        label = 'Нет размера';
        disabled = true;
        note = `Вариант «${v.label}» сейчас недоступен. Выберите другой или напишите нам — подберём замену.`;
      } else {
        label = 'Добавить в заказ';
        disabled = false;
      }
      add.textContent = label;
      add.disabled = disabled;
      if (hint) hint.textContent = note;
      if (status) {
        status.innerHTML = v && !v.available
          ? '<span class="badge badge--na">Нет размера</span>'
          : p.status ? `<span class="badge badge--na">${esc(p.status)}</span>` : '<span class="badge">Доступно к заказу</span>';
      }
      if (stickyPrice) stickyPrice.textContent = priceText;
      if (stickyAdd) stickyAdd.textContent = v && v.available ? `Добавить в заказ · ${money(v.price)}` : label;

      // Фото по цвету: синее кимоно — синяя заглушка (с реальными фото меняется src)
      if (photo && 'color' in sel && photo.classList.contains('ph') && !photo.classList.contains('ph--dark')) {
        photo.classList.toggle('ph--blue', sel.color === 'blue');
      }
      if (link) link.href = p.url;
    }

    form.addEventListener('change', (e) => {
      if (e.target.matches('[data-model]')) {
        // Рост и цвет переносим в новую модель, если такое значение у неё есть
        const prev = selection();
        form.dataset.product = e.target.value;
        for (const [k, val] of Object.entries(prev)) {
          const inp = $$(`[data-opt="${k}"] input`, scope()).find((x) => x.value === val);
          if (inp) inp.checked = true;
        }
        $$('[data-picker-for]', form).forEach((el) => { el.hidden = el.dataset.pickerFor !== e.target.value; });
      }
      update();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = product();
      const sel = selection();
      const v = p.variants.find((x) => matches(x, sel) && Object.keys(sel).length === p.options.length);
      if (!v || !v.available) { update(); return; }
      addToOrder(form.dataset.product, v.sku);
      toast(`${p.name}${v.label ? ' · ' + v.label : ''} — в заказе`);
    });

    if (stickyAdd) {
      stickyAdd.addEventListener('click', () => {
        if (!add.disabled) { form.requestSubmit(add); return; }
        form.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        const p = product();
        const firstMissing = p.options.find((o) => !$(`[data-opt="${o.key}"] input:checked`, scope()));
        const target = firstMissing && $(`[data-opt="${firstMissing.key}"] input`, scope());
        if (target) target.focus({ preventScroll: true });
      });
    }
    update();
  }

  // ── Галерея карточки ───────────────────────────────────
  function initGallery(g) {
    const main = $('[data-gallery-main]', g);
    const buttons = $$('.thumbs button', g);
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      main.classList.remove('ph--dark', 'ph--blue');
      if (b.dataset.kind === 'dark') main.classList.add('ph--dark');
      if (b.dataset.kind === 'blue') main.classList.add('ph--blue');
      const cap = $('span', main);
      if (cap) cap.textContent = b.dataset.label;
    }));
  }

  // ── Фильтры и сортировка категории ─────────────────────
  function initFilter(form) {
    const grid = $('[data-grid]');
    const count = $('[data-filter-count]');
    const empty = $('[data-filter-empty]');
    const unit = count && count.dataset.unit ? JSON.parse(count.dataset.unit) : ['товар', 'товара', 'товаров'];
    const cards = $$('[data-card]', grid);
    const apply = () => {
      const fd = new FormData(form);
      const purpose = fd.getAll('purpose'), color = fd.getAll('color'), height = fd.getAll('height'), sort = fd.get('sort');
      let shown = 0;
      for (const c of cards) {
        const colors = c.dataset.colors.split(' '), heights = c.dataset.heights.split(' ');
        const ok = (!purpose.length || purpose.includes(c.dataset.purpose)) && (!color.length || color.some((x) => colors.includes(x)))
          && (!height.length || height.some((x) => heights.includes(x)));
        c.hidden = !ok;
        if (ok) shown++;
      }
      const key = (c) => (sort === 'order' ? +c.dataset.order : +c.dataset.price);
      cards.slice().sort((a, b) => (sort === 'desc' ? key(b) - key(a) : key(a) - key(b))).forEach((c) => grid.append(c));
      if (count) count.textContent = plural(shown, unit);
      if (empty) empty.hidden = shown > 0;
    };
    form.addEventListener('change', apply);
    form.addEventListener('submit', (e) => e.preventDefault());
    // «Сбросить фильтры» снимает только фильтры, выбранная сортировка остаётся
    $('[data-filter-reset]')?.addEventListener('click', () => {
      $$('input[type=checkbox]', form).forEach((x) => { x.checked = false; });
      apply();
    });
    apply();
  }

  // ── Меню (mobile) ──────────────────────────────────────
  function initMenu() {
    const drawer = $('#drawer'), open = $('[data-menu-open]'), close = $('[data-menu-close]');
    if (!drawer || !open) return;
    const set = (on) => {
      drawer.classList.toggle('is-open', on);
      document.body.classList.toggle('no-scroll', on);
      open.setAttribute('aria-expanded', String(on));
      (on ? close : open).focus();
    };
    open.addEventListener('click', () => set(true));
    close.addEventListener('click', () => set(false));
    drawer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') set(false);
      if (e.key === 'Tab') { // фокус не уходит из диалога
        const f = $$('a,button', drawer), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // ── «Мой заказ» ────────────────────────────────────────
  function initOrder() {
    const listEl = $('[data-order-list]');
    const empty = $('[data-order-empty]');
    const filled = $('[data-order-filled]');
    const total = $('[data-order-total]');
    const sticky = $('[data-order-sticky]');

    function render() {
      const list = load();
      empty.hidden = list.length > 0;
      filled.hidden = list.length === 0;
      if (sticky) sticky.hidden = list.length === 0;
      document.body.classList.toggle('has-sticky', list.length > 0);
      let sum = 0;
      listEl.innerHTML = list.map((it, i) => {
        const p = CATALOG.products[it.slug], v = findVariant(it.slug, it.sku);
        sum += v.price * it.qty;
        const kind = p.photo === 'dark' ? 'ph--dark' : (v.sel.color === 'blue' || p.photo === 'blue') ? 'ph--blue' : '';
        return `<div class="line-item">
  <div class="ph r11 ${kind}"></div>
  <div><h3><a href="${p.url}">${esc(p.name)}</a></h3>${v.label ? `<p class="small">${esc(v.label)}</p>` : ''}
    <div class="qty" role="group" aria-label="Количество: ${esc(p.name)}"><button type="button" data-dec="${i}" aria-label="Меньше"${it.qty <= 1 ? ' disabled' : ''}>−</button><output aria-live="polite">${it.qty}</output><button type="button" data-inc="${i}" aria-label="Больше"${it.qty >= 99 ? ' disabled' : ''}>+</button></div></div>
  <div class="line-end"><span class="price">${money(v.price * it.qty)}</span><br><button class="link-rm" type="button" data-rm="${i}">Удалить<span class="sr-only"> ${esc(p.name)}</span></button></div>
</div>`;
      }).join('');
      total.textContent = money(sum);
    }
    listEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const list = load();
      if (b.dataset.inc) list[+b.dataset.inc].qty = Math.min(99, list[+b.dataset.inc].qty + 1);
      else if (b.dataset.dec) list[+b.dataset.dec].qty = Math.max(1, list[+b.dataset.dec].qty - 1);
      else if (b.dataset.rm) list.splice(+b.dataset.rm, 1);
      else return;
      const focusKey = Object.keys(b.dataset)[0], idx = b.dataset[focusKey];
      save(list);
      render();
      // возвращаем фокус на ту же кнопку после перерисовки (после удаления — на первую позицию)
      const back = focusKey === 'rm' ? $('a', listEl) : $(`[data-${focusKey}="${idx}"]`, listEl);
      if (back && !back.disabled) back.focus();
    });
    render();
  }

  // ── Формы заявки и вопроса ─────────────────────────────
  const phoneOk = (s) => { const d = s.replace(/\D/g, ''); return d.length === 11 && /^[78]/.test(d) || d.length === 10; };
  function fieldError(input, msg) {
    const box = input.closest('.field');
    const err = box && $('.err', box);
    if (box) box.classList.toggle('field--error', !!msg);
    if (err) err.textContent = msg;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  }
  const orderNo = () => {
    const d = new Date();
    return `МД-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  };

  function initLeadForm(form) {
    const kind = form.dataset.leadForm;
    const errBox = $('[data-form-error]', form);
    const name = form.elements.name, phone = form.elements.phone, consent = form.elements.consent;
    const cityBox = $('[data-city]', form);

    form.addEventListener('change', (e) => {
      if (e.target.name === 'delivery' && cityBox) cityBox.hidden = e.target.value !== 'russia';
    });
    [name, phone].forEach((el) => el.addEventListener('blur', () => { if (el.getAttribute('aria-invalid') === 'true') validate(); }));

    function validate() {
      const a = fieldError(name, name.value.trim() ? '' : 'Укажите имя');
      const b = fieldError(phone, phoneOk(phone.value) ? '' : 'Нужен номер из 10–11 цифр, например +7 900 000-00-00');
      return [a, b];
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      const [okName, okPhone] = validate();
      if (!okName || !okPhone) {
        errBox.textContent = 'Проверьте выделенные поля.';
        (okName ? phone : name).focus();
        return;
      }
      if (!consent.checked) { errBox.textContent = 'Нужно согласие на обработку персональных данных.'; consent.focus(); return; }

      const items = kind === 'order' ? load().map((it) => {
        const p = CATALOG.products[it.slug], v = findVariant(it.slug, it.sku);
        return { sku: it.sku, name: p.name, variant: v.label, qty: it.qty, price: v.price };
      }) : [];
      if (kind === 'order' && !items.length) { errBox.textContent = 'В заказе нет позиций.'; return; }

      const fd = new FormData(form);
      const no = orderNo();
      const payload = {
        kind, number: no, name: fd.get('name').trim(), phone: fd.get('phone').trim(), contact: fd.get('contact'),
        delivery: fd.get('delivery') || null, city: fd.get('city') || null, comment: fd.get('comment') || '',
        items, total: items.reduce((s, x) => s + x.price * x.qty, 0), page: location.pathname,
      };

      const btn = $('button[type=submit]', form);
      btn.disabled = true; btn.setAttribute('data-loading', '');
      try {
        if (CATALOG.endpoint) {
          const r = await fetch(CATALOG.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!r.ok) throw new Error(String(r.status));
        } else {
          // Стенд без бэкенда: в Каркасе заявку принимает обработчик форм движка (site.json → orderEndpoint)
          console.info('[mir-judo] orderEndpoint не задан, заявка не отправлена:', payload);
        }
      } catch {
        errBox.textContent = 'Не удалось отправить. Проверьте соединение или позвоните нам.';
        btn.disabled = false; btn.removeAttribute('data-loading');
        return;
      }
      if (kind === 'order') {
        save([]);
        try { sessionStorage.setItem('mir-judo:last', no); } catch { /* ignore */ }
        location.href = '/order/sent/';
      } else {
        form.innerHTML = `<h2>Спасибо!</h2><p class="lead" role="status">Вопрос получен. Ответим в течение дня — ${fd.get('contact') === 'phone' ? 'позвоним' : 'напишем в ' + (fd.get('contact') === 'whatsapp' ? 'WhatsApp' : 'Telegram')}.</p>`;
      }
    });
  }

  // ── Старт ──────────────────────────────────────────────
  renderCount();
  addEventListener('storage', (e) => { if (e.key === KEY) renderCount(); });
  initMenu();
  $$('form[data-buy]').forEach(initBuy);
  $$('[data-gallery]').forEach(initGallery);
  $$('form[data-filter]').forEach(initFilter);
  if ($('[data-order-list]')) initOrder();
  $$('form[data-lead-form]').forEach(initLeadForm);
  const noEl = $('[data-order-no]');
  if (noEl) { try { noEl.textContent = sessionStorage.getItem('mir-judo:last') || '—'; } catch { /* ignore */ } }
})();
