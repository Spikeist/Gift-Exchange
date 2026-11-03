import { api, el, icon, storage, busy, copyText, toast, DEMO, demoBanner } from './common.js';

const app = document.getElementById('app');
const code = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
const savedKey = (DEMO ? 'gx-demo-joined-' : 'gx-joined-') + code.slice(0, 12);

const personUrl = (token) => `${location.origin}${DEMO ? '/demo-person' : '/'}#${token}`;
const masthead = (title) => el('p', { class: 'masthead' }, icon('gift'), title);

function screen(title, ...content) {
  app.replaceChildren(el('div', { class: 'center-card' }, masthead(title), content));
}

function field(id, label, control, help) {
  control.id = id;
  if (help) control.setAttribute('aria-describedby', id + '-help');
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, label),
    control,
    help ? el('p', { class: 'help', id: id + '-help' }, help) : null
  );
}

function renderJoined(title, name, token) {
  const url = personUrl(token);
  const copy = el('button', { class: 'btn btn--ghost', type: 'button' }, icon('copy'), 'Copy my link');
  copy.addEventListener('click', async () => toast((await copyText(url)) ? 'Copied your link' : 'Select the link and copy it'));
  screen(
    title,
    el('h1', {}, `You're in, ${name}.`),
    el('p', {}, 'This is your private link. Save it or bookmark it. After the names are drawn, open it again to see who you got.'),
    el(
      'div',
      { class: 'panel light' },
      el('p', { class: 'link-box' }, url),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: url }, 'Go to my page'), copy)
    ),
    el(
      'p',
      {},
      el(
        'button',
        {
          class: 'btn btn--quiet',
          type: 'button',
          onclick: () => {
            storage.remove(savedKey);
            start();
          },
        },
        'Add someone else from this device'
      )
    )
  );
}

function renderForm(info) {
  const name = el('input', { class: 'input', autocomplete: 'name' });
  const link = el('input', {
    class: 'input',
    inputmode: 'url',
    autocapitalize: 'off',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'https://www.amazon.com/hz/wishlist/…',
  });
  const notes = el('textarea', { class: 'textarea', rows: '4' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'btn', type: 'submit' }, 'Join the exchange');
  const form = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (!name.value.trim()) {
          error.textContent = 'Enter your name.';
          error.hidden = false;
          return name.focus();
        }
        await busy(submit, async () => {
          try {
            const r = await api('join', { code, name: name.value, link: link.value, notes: notes.value });
            storage.set(savedKey, JSON.stringify({ name: r.name, token: r.token }));
            renderJoined(info.title, r.name, r.token);
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          }
        });
      },
    },
    field('join-name', 'Your name', name, 'The name everyone knows you by. Add a last initial if someone shares your name.'),
    field('join-link', 'Gift list link', link, 'Optional. Paste a link to your Amazon wish list or any other gift list.'),
    field(
      'join-notes',
      'Notes',
      notes,
      "Optional. Sizes, favorite stores, gift ideas, or links to specific things you'd like."
    ),
    error,
    el('div', { class: 'actions' }, submit)
  );
  screen(
    info.title,
    el('h1', {}, `Join ${info.title}`),
    el('p', {}, "Add your name and what you'd like. You can change your list any time before or after the draw."),
    el('div', { class: 'panel light' }, form)
  );
  name.focus();
}

async function start() {
  document.title = DEMO ? 'Join (demo)' : 'Join the gift exchange';
  if (!code) {
    return screen('Gift Exchange', el('h1', {}, 'This join link is missing its code'), el('p', {}, 'Ask the organizer to send the join link again.'));
  }
  let info;
  try {
    info = await api('joinInfo', { code });
  } catch (err) {
    return screen('Gift Exchange', el('h1', {}, "This join link doesn't work"), el('p', {}, err.message));
  }
  let saved = null;
  try {
    saved = JSON.parse(storage.get(savedKey) || 'null');
  } catch {
    saved = null;
  }
  if (saved && saved.token) return renderJoined(info.title, saved.name, saved.token);
  if (!info.open) {
    return screen(
      info.title,
      el('h1', {}, 'Joining is closed'),
      el(
        'p',
        {},
        info.drawn
          ? 'Names have already been drawn. If you were supposed to be in this exchange, ask the organizer.'
          : 'The organizer has closed joining for now. Ask them to add you.'
      )
    );
  }
  renderForm(info);
}

if (DEMO) {
  document.body.prepend(
    demoBanner(el('a', { class: 'btn btn--small btn--paper', href: '/demo' }, 'Back to organizer view'))
  );
}
window.addEventListener('hashchange', () => location.reload());
start();
