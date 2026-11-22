// Behaviour of the fake host application: each button provokes one kind of event.
const $ = (id) => document.getElementById(id);
const on = (id, fn) => $(id)?.addEventListener('click', fn);

// A long table, so that the page is taller than the screen.
const body = $('planning-body');
if (body) {
  for (let i = 1; i <= 70; i++) {
    body.insertAdjacentHTML('beforeend', `<tr><td>${i}</td><td>Agent ${i}</td><td>Matin</td><td>Soir</td><td>Repos</td></tr>`);
  }
}

// A container with its own scrollbar, scrolled down: row i has the colour rgb(i*5, 100, 100) and is 20px high.
const zone = $('zone-scroll');
if (zone) {
  for (let i = 0; i < 50; i++) zone.insertAdjacentHTML('beforeend', `<div style="height:20px;background:rgb(${i * 5},100,100)"></div>`);
  zone.scrollTop = 200; // first visible row = 10 -> rgb(50,100,100)
}

on('btn-ok', () => fetch('/api/ok'));

on('btn-fetch500', () =>
  fetch('/api/fail500', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: 12, date: '2026-11-21', shift_type_id: null }),
  }).then((r) => r.json()).catch(() => {}),
);

on('btn-xhr422', () => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/fail422');
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhr.send('date=2026-13-45&csrf_token=abc123');
});

on('btn-typeerror', () => {
  setTimeout(() => {
    const planning = undefined;
    planning.render(); // TypeError: Cannot read properties of undefined (reading 'render')
  }, 0);
});

on('btn-rejection', () => {
  Promise.reject(new Error('Chargement du planning impossible'));
});

on('btn-console', () => console.error('Erreur loguée par appli', { code: 42, token: 'should-not-leak' }));

on('btn-secret', () =>
  fetch('/api/fail500?week=47&token=url-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: 1, password: 'hunter2', nested: { api_key: 'K-123', token: 'T-456', ok: 'visible' } }),
  }).catch(() => {}),
);

on('btn-push', () => history.pushState({}, '', '/plannings/edit/42?week=47'));
on('btn-open', () => window.Fixi && window.Fixi.open());
on('btn-save-shift', () => fetch('/api/ok'));
