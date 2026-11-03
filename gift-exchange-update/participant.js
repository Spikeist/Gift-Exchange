import { api, el, icon, linkify, safeHref, hostOf, storage, toast, busy, DEMO, demoBanner } from './common.js';

const app = document.getElementById('app');
const token = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
const openedKey = (DEMO ? 'gx-demo-open-' : 'gx-open-') + token.slice(0, 12);

let view = null;
let lastLoad = 0;
let listDirty = false;

const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
document.body.append(live);

const isOpened = () => storage.get(openedKey) === '1';

async function load() {
  const next = await api('me', { token, reveal: isOpened() });
  lastLoad = Date.now();
  return next;
}

async function start() {
  if (DEMO) {
    document.body.prepend(
      demoBanner(
        el('a', { class: 'btn btn--small btn--paper', href: '/demo' }, 'Back to organizer view'),
        el('a', { class: 'btn btn--small btn--ghost', href: '/demo-person' }, 'Pick someone else')
      )
    );
    if (!token) return renderDemoPicker();
  }
  if (!token) return renderLanding();
  try {
    view = await load();
    render();
  } catch (err) {
    renderProblem(err);
  }
}

function masthead(title) {
  return el('p', { class: 'masthead' }, icon('gift'), title);
}

function render() {
  document.title = view.title;
  const parts = [masthead(view.title), el('h1', { class: 'greeting' }, `Hi, ${view.me.name}.`)];

  if (!view.drawn) {
    parts.push(
      el('p', { class: 'lead' }, 'Your name is in the hat. ', el('strong', {}, "Names haven't been drawn yet.")),
      el(
        'p',
        { class: 'lead' },
        'Add your gift list below so whoever draws you knows what to get. Then check back on this same link after the draw.'
      ),
      myListBlock(),
      guidelinesBlock()
    );
  } else if (!view.inDraw) {
    parts.push(
      el(
        'p',
        { class: 'lead' },
        "Names were drawn before you were added, so you don't have anyone yet. Ask the organizer to redo the draw."
      ),
      myListBlock(),
      guidelinesBlock()
    );
  } else {
    parts.push(
      el(
        'p',
        { class: 'lead' },
        view.revealed ? "The gifts are open. Here's how everyone matched up." : "Names have been drawn. Here's your slip."
      ),
      slipBlock(),
      view.revealed ? revealBlock() : null,
      guidelinesBlock(),
      myListBlock()
    );
  }

  parts.push(el('p', { class: 'footer-note' }, "This link is just for you. Please don't forward it."));
  app.replaceChildren(...parts.filter(Boolean));
}

// ---------- the slip ----------

function setName(node, name) {
  node.textContent = name;
  node.classList.toggle('is-long', name.length > 11 && name.length <= 18);
  node.classList.toggle('is-longer', name.length > 18);
}

function detailsFor(r) {
  const href = safeHref(r.link);
  const items = [];
  if (href) {
    items.push(
      el(
        'a',
        { class: 'btn btn--paper list-button', href, target: '_blank', rel: 'noopener noreferrer' },
        el('span', {}, `Open ${r.name}'s gift list`, el('small', {}, hostOf(href))),
        icon('external')
      )
    );
  }
  if (r.notes) {
    items.push(
      el(
        'div',
        { class: 'notes-block' },
        el('h3', {}, `${r.name}'s notes`),
        el('p', { class: 'notes' }, linkify(r.notes))
      )
    );
  }
  if (!href && !r.notes) {
    items.push(
      el(
        'p',
        { class: 'empty-list' },
        `${r.name} hasn't added a gift list yet. It will show up here as soon as they do, so check back on this link.`
      )
    );
  }
  return items;
}

function slipBlock() {
  const opened = !!view.recipient && (isOpened() || view.revealed);
  const name = el('span', { class: 'slip-name hand' });
  if (opened) setName(name, view.recipient.name);

  const slip = el(
    'button',
    {
      type: 'button',
      class: 'slip',
      'aria-expanded': opened ? 'true' : 'false',
      'aria-label': opened ? `You're buying a gift for ${view.recipient.name}` : "Unfold your slip to see who you're buying for",
    },
    el('span', { class: 'slip-half slip-top' }, el('span', { class: 'slip-printed' }, "You're buying a gift for")),
    el(
      'span',
      { class: 'slip-half slip-flap', 'aria-hidden': 'true' },
      el('span', { class: 'slip-face slip-inside' }, name),
      el('span', { class: 'slip-face slip-outside' })
    )
  );
  const stage = el(
    'div',
    { class: 'slip-stage' + (opened ? ' is-open' : '') },
    el('span', { class: 'slip-shadow', 'aria-hidden': 'true' }),
    el('span', { class: 'slip-hint', 'aria-hidden': 'true' }, icon('tap'), 'Tap the slip to unfold it'),
    slip
  );

  const details = el('div', { class: 'match-details', hidden: !opened });
  if (opened) details.append(...detailsFor(view.recipient));
  if (opened && !view.revealed) details.append(foldBackButton());

  slip.addEventListener('click', async () => {
    if (stage.classList.contains('is-open') || stage.classList.contains('is-busy')) return;
    stage.classList.add('is-busy');
    let next;
    try {
      next = await api('me', { token, reveal: true });
    } catch (err) {
      stage.classList.remove('is-busy');
      toast(err.message, { error: true });
      return;
    }
    view = next;
    lastLoad = Date.now();
    if (!next.recipient) return render();
    storage.set(openedKey, '1');
    setName(name, next.recipient.name);
    details.replaceChildren(...detailsFor(next.recipient));
    if (!next.revealed) details.append(foldBackButton());
    details.classList.add('is-waiting');
    details.hidden = false;
    stage.classList.remove('is-busy');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        stage.classList.add('is-open');
        slip.setAttribute('aria-expanded', 'true');
        slip.setAttribute('aria-label', `You're buying a gift for ${next.recipient.name}`);
        details.classList.remove('is-waiting');
      })
    );
    live.textContent = `You're buying a gift for ${next.recipient.name}.`;
  });

  return el('div', { class: 'slip-area' }, stage, details);
}

function foldBackButton() {
  return el(
    'button',
    {
      type: 'button',
      class: 'btn btn--quiet fold-back',
      onclick: () => {
        storage.set(openedKey, '0');
        render();
        app.querySelector('.slip')?.focus();
      },
    },
    'Fold it back up'
  );
}

// ---------- other sections ----------

function guidelinesBlock() {
  if (!view.guidelines || !view.guidelines.length) return null;
  return el(
    'section',
    { class: 'block', 'aria-labelledby': 'rules-h' },
    el('h2', { id: 'rules-h' }, 'Guidelines'),
    el(
      'ul',
      { class: 'rules' },
      view.guidelines.map((g) => el('li', {}, g))
    )
  );
}

function revealBlock() {
  const rows = view.reveal || [];
  let lastLoop = 0;
  return el(
    'section',
    { class: 'block', 'aria-labelledby': 'reveal-h' },
    el('h2', { id: 'reveal-h' }, 'Who had who'),
    el(
      'ul',
      { class: 'reveal-list' },
      rows.map((r) => {
        const li = el(
          'li',
          { class: lastLoop && r.loop !== lastLoop ? 'new-loop' : null },
          el('span', { class: 'giver' + (r.giver === view.me.name ? ' is-me' : '') }, r.giver),
          el('span', { class: 'to' }, 'gave to'),
          el('span', { class: 'receiver' + (r.receiver === view.me.name ? ' is-me' : '') }, r.receiver)
        );
        lastLoop = r.loop;
        return li;
      })
    )
  );
}

function myListBlock() {
  const linkInput = el('input', {
    class: 'input',
    id: 'my-link',
    name: 'link',
    type: 'text',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'https://www.amazon.com/hz/wishlist/…',
    'aria-describedby': 'my-link-help',
  });
  linkInput.value = view.me.link || '';
  const notesInput = el('textarea', {
    class: 'textarea',
    id: 'my-notes',
    name: 'notes',
    rows: '4',
    'aria-describedby': 'my-notes-help',
  });
  notesInput.value = view.me.notes || '';
  const status = el('span', { class: 'saved-note', role: 'status' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const save = el('button', { class: 'btn', type: 'submit' }, 'Save my list');

  const markDirty = () => {
    listDirty = true;
    status.replaceChildren();
  };
  linkInput.addEventListener('input', markDirty);
  notesInput.addEventListener('input', markDirty);

  const form = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        status.replaceChildren();
        await busy(save, async () => {
          try {
            const r = await api('saveList', { token, link: linkInput.value, notes: notesInput.value });
            view.me = r.me;
            linkInput.value = r.me.link;
            notesInput.value = r.me.notes;
            listDirty = false;
            status.replaceChildren(icon('check'), 'Saved');
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          }
        });
      },
    },
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'my-link' }, 'Gift list link'),
      linkInput,
      el('p', { class: 'help', id: 'my-link-help' }, 'Paste a link to your Amazon wish list, or any other gift list.')
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'my-notes' }, 'Notes'),
      notesInput,
      el(
        'p',
        { class: 'help', id: 'my-notes-help' },
        "Optional. Sizes, favorite stores, or gift ideas if you don't have a list."
      )
    ),
    error,
    el('div', { class: 'actions' }, save, status)
  );

  const help = el(
    'p',
    { class: 'help' },
    view.drawn
      ? 'Whoever drew your name sees this. You can update it any time.'
      : 'Whoever draws your name will see this. You can update it any time.'
  );
  return el(
    'section',
    { class: 'block panel light', 'aria-labelledby': 'my-list-h' },
    el('h2', { id: 'my-list-h' }, 'Your gift list'),
    help,
    form
  );
}

// ---------- other screens ----------

function renderLanding() {
  document.title = 'Gift Exchange';
  app.replaceChildren(
    el(
      'div',
      { class: 'center-card' },
      masthead('Gift Exchange'),
      el('h1', {}, 'This is a private gift exchange'),
      el('p', {}, "Open the personal link the organizer sent you to see who you're buying for."),
      el('p', {}, el('a', { href: '/demo' }, 'See how it works'), ' or ', el('a', { href: '/admin' }, 'organizer sign-in'))
    )
  );
}

async function renderDemoPicker() {
  document.title = 'Pick someone (demo)';
  let people = [];
  try {
    people = (await api('demoPeople')).people;
  } catch {
    /* empty demo */
  }
  app.replaceChildren(
    el(
      'div',
      { class: 'center-card' },
      masthead('Gift Exchange'),
      el('h1', {}, "Whose page do you want to see?"),
      people.length
        ? el(
            'ul',
            { class: 'demo-people' },
            people.map((p) => el('li', {}, el('a', { class: 'btn btn--paper', href: `/demo-person#${p.token}` }, p.name)))
          )
        : el('p', {}, "Nobody's in the demo yet. Add people in the organizer view first.")
    )
  );
}

function renderProblem(err) {
  const titles = {
    BAD_LINK: "This link doesn't work",
    NO_DB: "This site isn't set up yet",
  };
  const fixable = !titles[err.code];
  app.replaceChildren(
    el(
      'div',
      { class: 'center-card' },
      masthead('Gift Exchange'),
      el('h1', {}, titles[err.code] || "Couldn't open your link"),
      el('p', {}, err.code === 'NO_DB' ? 'The organizer still needs to finish setting it up. Check back soon.' : err.message),
      fixable
        ? el(
            'div',
            { class: 'actions' },
            el('button', { class: 'btn btn--paper', type: 'button', onclick: () => location.reload() }, 'Try again')
          )
        : null
    )
  );
}

// Coming back to the tab later: pick up a draw or reveal that happened meanwhile.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !view || Date.now() - lastLoad < 30000) return;
  try {
    const next = await load();
    const changed =
      next.drawn !== view.drawn ||
      next.revealed !== view.revealed ||
      JSON.stringify(next.recipient) !== JSON.stringify(view.recipient) ||
      JSON.stringify(next.guidelines) !== JSON.stringify(view.guidelines);
    if (changed && !listDirty) {
      view = next;
      render();
    }
  } catch {
    /* keep what's on screen */
  }
});

window.addEventListener('hashchange', () => location.reload());

start();
