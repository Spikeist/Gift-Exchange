import { api, el, icon, storage, toast, busy, copyText, shortDate, DEMO, demoBanner } from './common.js';

const SESSION_KEY = 'gx-admin-session';
const app = document.getElementById('app');
const canShare = typeof navigator.share === 'function';

let session = storage.get(SESSION_KEY);
let state = null;

// ---------- helpers ----------

function setPine(on) {
  document.body.classList.toggle('on-pine', on);
}

function masthead(text) {
  return el('p', { class: 'masthead' }, icon('gift'), text);
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

function showError(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function saveSession(value) {
  session = value;
  storage.set(SESSION_KEY, value);
}

function forgetSession() {
  session = null;
  storage.remove(SESSION_KEY);
}

function signOut() {
  forgetSession();
  renderLogin();
}

function linkFor(p) {
  if (DEMO) return `${location.origin}/demo-person#${p.token}`;
  const base = (state.siteUrl || location.origin).replace(/\/+$/, '');
  return `${base}/#${p.token}`;
}

// Run an organizer action, then redraw with the fresh state.
async function act(action, data, button, success) {
  const run = async () => {
    try {
      state = await api(action, data, { session });
      renderDashboard();
      if (success) toast(success);
      return true;
    } catch (err) {
      if (err.status === 401) {
        forgetSession();
        renderLogin(err.message);
        return false;
      }
      toast(err.message, { error: true });
      return false;
    }
  };
  return button ? busy(button, run) : run();
}

function openDialog(...content) {
  const dialog = el('dialog', { class: 'dialog light' }, el('div', { class: 'dialog-body' }, content));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function confirmDialog({ title, body = [], confirm, danger = false }) {
  return new Promise((resolve) => {
    let yes = false;
    const ok = el('button', { class: 'btn', type: 'button' }, confirm);
    const cancel = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
    const dialog = openDialog(
      el('h2', {}, title),
      body.filter(Boolean).map((text) => el('p', {}, text)),
      el('div', { class: 'actions' }, cancel, ok)
    );
    ok.addEventListener('click', () => {
      yes = true;
      dialog.close();
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => resolve(yes));
    (danger ? cancel : ok).focus();
  });
}

function showLinkDialog(p, url) {
  const box = el('input', { class: 'input', readonly: true, value: url, 'aria-label': `${p.name}'s link` });
  const dialog = openDialog(
    el('h2', {}, `${p.name}'s link`),
    el('p', {}, "Your browser blocked copying. Select the link and copy it yourself."),
    el('div', { class: 'field' }, box),
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Done'))
  );
  box.focus();
  box.select();
}

async function copyLink(p) {
  const url = linkFor(p);
  if (await copyText(url)) toast(`Copied ${p.name}'s link`);
  else showLinkDialog(p, url);
}

async function shareLink(p) {
  const url = linkFor(p);
  try {
    await navigator.share({
      title: state.title,
      text: `Hi ${p.name}! Here's your private link for ${state.title}. It's just for you.`,
      url,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    copyLink(p);
  }
}

// ---------- screens before the dashboard ----------

function centerScreen(title, intro, ...content) {
  setPine(true);
  document.title = title;
  app.replaceChildren(
    el('main', { class: 'center-card' }, masthead('Gift Exchange'), el('h1', {}, title), intro ? el('p', {}, intro) : null, content)
  );
}

function renderNoDb() {
  centerScreen(
    'One more step: connect the database',
    'The site is live, but it needs somewhere to save names and lists. In your Vercel project:',
    el(
      'ol',
      { class: 'steps' },
      el('li', {}, 'Open the Storage tab.'),
      el('li', {}, 'Create a database and choose Upstash for Redis. The free plan is plenty.'),
      el('li', {}, 'Connect it to this project, then redeploy from the Deployments tab.')
    ),
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'btn btn--paper', type: 'button', onclick: () => location.reload() }, 'Check again')
    )
  );
}

function renderSetup() {
  const pw = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const pw2 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'btn', type: 'submit' }, 'Create password');
  const form = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (pw.value.length < 6) return showError(error, 'Use at least 6 characters.');
        if (pw.value !== pw2.value) return showError(error, "The passwords don't match.");
        await busy(submit, async () => {
          try {
            const r = await api('setup', { password: pw.value });
            saveSession(r.session);
            await loadDashboard();
          } catch (err) {
            if (err.code === 'ALREADY_SETUP') return renderLogin(err.message);
            showError(error, err.message);
          }
        });
      },
    },
    field('pw', 'Organizer password', pw, 'At least 6 characters. Only you need to know it.'),
    field('pw2', 'Type it again', pw2),
    error,
    el('div', { class: 'actions' }, submit)
  );
  centerScreen(
    'Set up your gift exchange',
    "Create the organizer password. You'll use it to add people and draw names.",
    el('div', { class: 'panel light' }, form)
  );
  pw.focus();
}

function renderLogin(message) {
  const pw = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: !message }, message || '');
  const submit = el('button', { class: 'btn', type: 'submit' }, 'Sign in');
  const form = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (!pw.value) return showError(error, 'Enter your organizer password.');
        await busy(submit, async () => {
          try {
            const r = await api('login', { password: pw.value });
            saveSession(r.session);
            await loadDashboard();
          } catch (err) {
            showError(error, err.message);
            pw.select();
          }
        });
      },
    },
    field('pw', 'Organizer password', pw),
    error,
    el('div', { class: 'actions' }, submit)
  );
  centerScreen('Organizer sign-in', null, el('div', { class: 'panel light' }, form));
  pw.focus();
}

function renderFatal(err) {
  centerScreen(
    "Couldn't load the organizer page",
    err.message,
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'btn btn--paper', type: 'button', onclick: () => location.reload() }, 'Try again')
    )
  );
}

async function loadDashboard() {
  state = await api('state', {}, { session });
  renderDashboard();
}

// ---------- dashboard ----------

function renderDashboard() {
  setPine(false);
  document.title = `${state.title} (organizer)`;
  app.replaceChildren(
    DEMO ? dashboardDemoBanner() : '',
    headerBand(),
    el('main', { class: 'admin-main' }, peoplePanel(), apartSection(), settingsSection())
  );
}

function dashboardDemoBanner() {
  const sample = el('button', { class: 'btn btn--small btn--paper', type: 'button' }, 'Add sample people');
  sample.addEventListener('click', () => act('addSample', {}, sample, 'Added sample people'));
  const reset = el('button', { class: 'btn btn--small btn--ghost', type: 'button' }, 'Start over');
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Start the demo over?',
      body: ['Everyone, every list, and the draw in this demo are cleared.'],
      confirm: 'Start over',
      danger: true,
    });
    if (!ok) return;
    (await import('./demo-backend.js')).resetDemo();
    await loadDashboard();
    toast('Demo cleared');
  });
  return demoBanner(sample, reset);
}

function headerBand() {
  const n = state.people.length;
  const withList = state.people.filter((p) => p.link || p.notes).length;
  const opened = state.people.filter((p) => p.openedAt).length;
  const actions = [];
  let phase;
  let help = null;

  if (!state.drawnAt) {
    phase =
      n === 0
        ? "Nobody's in yet. Add people below to get started."
        : [
            el('strong', {}, `${count(n, 'person', 'people')} in the hat. `),
            `${withList} of ${n} ${withList === 1 ? 'has' : 'have'} added a gift list.`,
          ];
    const drawBtn = el('button', { class: 'btn', type: 'button', disabled: n < 3 }, 'Draw names');
    drawBtn.addEventListener('click', () => confirmDraw(drawBtn));
    actions.push(drawBtn);
    help =
      n < 3
        ? 'Add at least 3 people to draw names.'
        : "The draw is random and nobody can get themselves. Nobody, including you, can see who got who. Each person only sees their own match.";
  } else {
    phase = [
      el('strong', {}, `Names drawn ${shortDate(state.drawnAt)}. `),
      `${opened} of ${n} ${opened === 1 ? 'has' : 'have'} opened their slip.`,
    ];
    const undoBtn = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Undo draw');
    undoBtn.addEventListener('click', () => confirmUndo(undoBtn, opened));
    actions.push(undoBtn);
    help =
      'Let everyone know names are drawn. They open the same link they already have to see who they got. Nobody can see anyone else\'s match.';
  }

  return el(
    'header',
    { class: 'band' },
    el(
      'div',
      { class: 'band-inner' },
      el(
        'div',
        { class: 'band-top' },
        masthead(DEMO ? 'Organizer view' : 'Organizer'),
        DEMO
          ? el('a', { class: 'btn btn--quiet', href: '/demo-person' }, "See someone's page")
          : el('button', { class: 'btn btn--quiet', type: 'button', onclick: signOut }, 'Sign out')
      ),
      el('h1', {}, state.title),
      el('p', { class: 'phase' }, phase),
      el('div', { class: 'actions' }, actions),
      help ? el('p', { class: 'help' }, help) : null
    )
  );
}

async function confirmDraw(button) {
  const missing = state.people.filter((p) => !p.link && !p.notes).length;
  const ok = await confirmDialog({
    title: 'Draw names now?',
    body: [
      'Everyone gets matched at random, and nobody can get themselves.' +
        (state.pairs.length ? ' Keep-apart pairs are respected.' : ''),
      missing
        ? `${count(missing, "person hasn't", "people haven't")} added a gift list yet. That's okay. They can still add one after the draw.`
        : null,
    ],
    confirm: 'Draw names',
  });
  if (ok) act('draw', {}, button, 'Names drawn');
}

async function confirmUndo(button, opened) {
  const ok = await confirmDialog({
    title: 'Undo the draw?',
    body: [
      "Everyone's match is cleared. You can then add or remove people and draw again.",
      opened
        ? `${count(opened, 'person has', 'people have')} already seen who they got. A new draw will likely give them someone else, so let them know.`
        : null,
    ],
    confirm: 'Undo draw',
    danger: true,
  });
  if (ok) act('undoDraw', {}, button, 'Draw undone');
}

function statusItem(done, doneText, pendingText) {
  return el(
    'span',
    { class: 'status' + (done ? ' is-done' : '') },
    icon(done ? 'check' : 'pending'),
    done ? doneText : pendingText
  );
}

function personRow(p) {
  const drawn = !!state.drawnAt;
  const hasList = !!(p.link || p.notes);
  return el(
    'li',
    { class: 'person' },
    el(
      'div',
      {},
      el('div', { class: 'person-name' }, p.name),
      el(
        'div',
        { class: 'person-status' },
        statusItem(hasList, 'Has a gift list', 'No gift list yet'),
        drawn ? statusItem(!!p.openedAt, 'Opened their slip', "Hasn't opened their slip") : null
      )
    ),
    el(
      'div',
      { class: 'person-actions' },
      el(
        'button',
        { class: 'btn btn--small', type: 'button', 'aria-label': `Copy ${p.name}'s link`, onclick: () => copyLink(p) },
        icon('copy'),
        'Copy link'
      ),
      canShare
        ? el(
            'button',
            { class: 'btn btn--small', type: 'button', 'aria-label': `Send ${p.name} their link`, onclick: () => shareLink(p) },
            icon('share'),
            'Send'
          )
        : null,
      DEMO
        ? el(
            'a',
            { class: 'btn btn--small', href: linkFor(p), target: '_blank', rel: 'noopener', 'aria-label': `Open ${p.name}'s page` },
            icon('external'),
            'Open their page'
          )
        : null,
      el(
        'button',
        { class: 'btn btn--small', type: 'button', 'aria-label': `Edit ${p.name}`, onclick: () => editPerson(p) },
        icon('edit'),
        'Edit'
      )
    )
  );
}

function joinUrl() {
  if (DEMO) return `${location.origin}/demo-join#${state.joinCode}`;
  const base = (state.siteUrl || location.origin).replace(/\/+$/, '');
  return `${base}/join#${state.joinCode}`;
}

function joinBox() {
  if (state.drawnAt || !state.joinCode) return null;
  const url = joinUrl();
  const copy = el('button', { class: 'btn btn--small', type: 'button' }, icon('copy'), 'Copy join link');
  copy.addEventListener('click', async () => {
    if (await copyText(url)) toast('Copied the join link');
    else showLinkDialog({ name: 'The join' }, url);
  });
  const send = canShare
    ? el('button', { class: 'btn btn--small btn--ghost', type: 'button' }, icon('share'), 'Send')
    : null;
  send?.addEventListener('click', async () => {
    try {
      await navigator.share({
        title: state.title,
        text: `Join ${state.title}! Add your name and gift list here:`,
        url,
      });
    } catch (err) {
      if (err && err.name !== 'AbortError' && (await copyText(url))) toast('Copied the join link');
    }
  });
  const toggle = el(
    'button',
    { class: 'btn btn--small btn--ghost', type: 'button' },
    state.joinOpen ? 'Close joining' : 'Open joining'
  );
  toggle.addEventListener('click', () =>
    act('setJoin', { open: !state.joinOpen }, toggle, state.joinOpen ? 'Joining closed' : 'Joining open')
  );
  const fresh = el('button', { class: 'btn btn--quiet', type: 'button' }, 'Make a new join link');
  fresh.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Make a new join link?',
      body: ["The old join link stops working. People who already joined keep their own links."],
      confirm: 'Make a new join link',
      danger: true,
    });
    if (ok) act('newJoinCode', {}, fresh, 'New join link ready');
  });
  return el(
    'div',
    { class: 'join-box' + (state.joinOpen ? '' : ' is-closed') },
    el('p', { class: 'label' }, state.joinOpen ? 'Join link' : 'Join link (closed)'),
    el(
      'p',
      { class: 'help' },
      state.joinOpen
        ? 'Send this one link to everyone, like in a group text. Each person adds their own name and gift list and gets their own private link. Close joining once everyone is in.'
        : "Joining is closed, so this link won't let anyone new in. Open it again if someone still needs to join."
    ),
    state.joinOpen ? el('p', { class: 'link-box' }, url) : null,
    el('div', { class: 'actions' }, state.joinOpen ? copy : null, state.joinOpen ? send : null, toggle, state.joinOpen ? fresh : null)
  );
}

function addPeopleForm() {
  const input = el('textarea', {
    class: 'textarea',
    id: 'add-names',
    rows: '1',
    placeholder: 'Type a name',
    autocomplete: 'off',
    'aria-describedby': 'add-help',
  });
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = Math.max(input.scrollHeight + 3, 46) + 'px';
  };
  const addBtn = el('button', { class: 'btn', type: 'submit' }, 'Add');
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const form = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        const names = input.value
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (!names.length) return input.focus();
        await busy(addBtn, async () => {
          try {
            state = await api('addPeople', { names }, { session });
            renderDashboard();
            toast(names.length === 1 ? `Added ${names[0]}` : `Added ${names.length} people`);
            document.getElementById('add-names')?.focus();
          } catch (err) {
            if (err.status === 401) {
              forgetSession();
              return renderLogin(err.message);
            }
            showError(error, err.message);
          }
        });
      },
    },
    el('label', { class: 'label', for: 'add-names' }, 'Add people'),
    el('div', { class: 'add-row' }, input, addBtn),
    el(
      'p',
      { class: 'help', id: 'add-help' },
      'Press Enter to add. To add several at once, put each name on its own line or separate them with commas.'
    ),
    error
  );
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  return el('div', { class: 'add-people' }, form);
}

function peoplePanel() {
  const drawn = !!state.drawnAt;
  const base = (state.siteUrl || location.origin).replace(/\/+$/, '');
  const body = state.people.length
    ? el('ul', { class: 'people' }, state.people.map(personRow))
    : el(
        'div',
        { class: 'how' },
        el(
          'ol',
          {},
          el('li', {}, 'Send everyone the join link above so they can add their own name and gift list. You can also add people yourself below.'),
          el('li', {}, "Add yourself too if you're taking part."),
          el('li', {}, 'Draw names. Everyone opens the same link to see who they got.'),
          el('li', {}, "Everyone brings their gift. Who had who stays secret on the site.")
        )
      );
  return el(
    'section',
    { class: 'people-panel light', 'aria-labelledby': 'people-h' },
    el(
      'div',
      { class: 'people-head' },
      el('h2', { id: 'people-h' }, 'People'),
      el(
        'p',
        { class: 'help' },
        ...(DEMO
          ? ["On the real site you send each person their private link. Here, use Open their page to see exactly what they'd see."]
          : [
              'Each person has their own private link. Send it to them so they can add their gift list, and later see who they got. Links start with ',
              el('code', {}, base + '/'),
              '.',
            ])
      )
    ),
    joinBox(),
    body,
    drawn
      ? el('p', { class: 'add-people help' }, 'Names are drawn. To add or remove people, undo the draw first.')
      : addPeopleForm()
  );
}

function editPerson(p) {
  const drawn = !!state.drawnAt;
  const name = el('input', { class: 'input', autocomplete: 'off', value: p.name });
  const link = el('input', {
    class: 'input',
    inputmode: 'url',
    autocapitalize: 'off',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'https://',
    value: p.link,
  });
  const notes = el('textarea', { class: 'textarea', rows: '3' });
  notes.value = p.notes;
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const save = el('button', { class: 'btn', type: 'submit' }, 'Save changes');
  const cancel = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');

  const form = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        await busy(save, async () => {
          try {
            state = await api(
              'updatePerson',
              { id: p.id, name: name.value, link: link.value, notes: notes.value },
              { session }
            );
            dialog.close();
            renderDashboard();
            toast('Saved');
          } catch (err) {
            if (err.status === 401) {
              dialog.close();
              forgetSession();
              return renderLogin(err.message);
            }
            showError(error, err.message);
          }
        });
      },
    },
    field('ed-name', 'Name', name),
    field('ed-link', 'Gift list link', link),
    field('ed-notes', 'Notes', notes, 'Sizes, favorite stores, or gift ideas. The person can edit these too.'),
    error,
    el('div', { class: 'actions' }, cancel, save)
  );

  const copyBtn = el(
    'button',
    { class: 'btn btn--small btn--ghost', type: 'button', onclick: () => copyLink(p) },
    icon('copy'),
    'Copy link'
  );
  const newLinkBtn = el('button', { class: 'btn btn--small btn--ghost', type: 'button' }, 'Make a new link');
  newLinkBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Make a new link for ${p.name}?`,
      body: ["Their current link stops working right away. You'll need to send them the new one."],
      confirm: 'Make a new link',
      danger: true,
    });
    if (!ok) return;
    dialog.close();
    act('newLink', { id: p.id }, null, `New link ready for ${p.name}. Copy it and send it to them.`);
  });
  const removeBtn = el('button', { class: 'btn btn--small btn--danger', type: 'button', disabled: drawn }, `Remove ${p.name}`);
  removeBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Remove ${p.name}?`,
      body: ['Their private link and gift list are deleted.'],
      confirm: 'Remove',
      danger: true,
    });
    if (!ok) return;
    dialog.close();
    act('removePerson', { id: p.id }, null, `Removed ${p.name}`);
  });

  const dialog = openDialog(
    el('h2', {}, `Edit ${p.name}`),
    form,
    el(
      'div',
      { class: 'dialog-extra' },
      el(
        'div',
        {},
        el('p', { class: 'label' }, 'Private link'),
        el('p', { class: 'link-box' }, linkFor(p)),
        el('div', { class: 'actions' }, copyBtn, newLinkBtn),
        el('p', { class: 'help' }, 'Make a new link if this one went to the wrong person. The old one stops working.')
      ),
      el('div', {}, removeBtn, drawn ? el('p', { class: 'help' }, 'Undo the draw to remove people.') : null)
    )
  );
  cancel.addEventListener('click', () => dialog.close());
}

function apartSection() {
  const drawn = !!state.drawnAt;
  const byId = Object.fromEntries(state.people.map((p) => [p.id, p]));
  const pairs = state.pairs.filter(([a, b]) => byId[a] && byId[b]);
  const options = () => [
    el('option', { value: '' }, 'Choose someone'),
    state.people.map((p) => el('option', { value: p.id }, p.name)),
  ];
  const first = el('select', { class: 'select', id: 'pair-a', disabled: drawn }, options());
  const second = el('select', { class: 'select', id: 'pair-b', disabled: drawn }, options());
  const addBtn = el('button', { class: 'btn btn--small', type: 'submit', disabled: drawn }, 'Keep apart');
  const form = el(
    'form',
    {
      class: 'pair-form',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        if (!first.value || !second.value) return toast('Pick two people.', { error: true });
        if (first.value === second.value) return toast('Pick two different people.', { error: true });
        const a = byId[first.value].name;
        const b = byId[second.value].name;
        act('setPairs', { pairs: [...pairs, [first.value, second.value]] }, addBtn, `${a} and ${b} won't draw each other`);
      },
    },
    el('label', { class: 'sr-only', for: 'pair-a' }, 'First person'),
    first,
    el('span', { class: 'and', 'aria-hidden': 'true' }, 'and'),
    el('label', { class: 'sr-only', for: 'pair-b' }, 'Second person'),
    second,
    addBtn
  );

  const list = pairs.length
    ? el(
        'ul',
        { class: 'pairs' },
        pairs.map((pair) => {
          const label = `${byId[pair[0]].name} and ${byId[pair[1]].name}`;
          return el(
            'li',
            {},
            el('span', {}, label),
            drawn
              ? null
              : el(
                  'button',
                  {
                    class: 'btn btn--quiet',
                    type: 'button',
                    'aria-label': `Stop keeping ${label} apart`,
                    onclick: (e) => act('setPairs', { pairs: pairs.filter((x) => x !== pair) }, e.currentTarget, 'Pair removed'),
                  },
                  'Remove'
                )
          );
        })
      )
    : null;

  return el(
    'section',
    { class: 'section', 'aria-labelledby': 'apart-h' },
    el('h2', { id: 'apart-h' }, 'Keep apart'),
    el('p', { class: 'help' }, "People in a pair won't draw each other. Handy for couples."),
    el(
      'div',
      { class: 'section-body' },
      state.people.length >= 2 ? form : el('p', { class: 'help' }, 'Add at least two people first.'),
      list,
      drawn ? el('p', { class: 'locked-note' }, 'Undo the draw to change pairs.') : null
    )
  );
}

function settingsSection() {
  const title = el('input', { class: 'input', autocomplete: 'off', value: state.title });
  const rules = el('textarea', { class: 'textarea', rows: '6' });
  rules.value = state.guidelines.join('\n');
  const save = el('button', { class: 'btn', type: 'submit' }, 'Save details');
  const form = el(
    'form',
    {
      class: 'settings-form',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        act('saveSettings', { title: title.value, guidelines: rules.value.split('\n') }, save, 'Details saved');
      },
    },
    field('set-title', 'Exchange name', title, "Shown at the top of everyone's page."),
    field('set-rules', 'Guidelines', rules, 'One per line. Everyone sees these on their page.'),
    el('div', { class: 'actions' }, save)
  );
  return el(
    'section',
    { class: 'section', 'aria-labelledby': 'set-h' },
    el('h2', { id: 'set-h' }, 'Exchange details'),
    el('div', { class: 'section-body' }, form)
  );
}

// ---------- start ----------

async function boot() {
  if (DEMO) session = 'demo';
  try {
    const status = await api('status');
    if (!status.db) return renderNoDb();
    if (!status.setup) return renderSetup();
    if (!session) return renderLogin();
    await loadDashboard();
  } catch (err) {
    if (err.status === 401) {
      forgetSession();
      return renderLogin();
    }
    if (err.code === 'NO_DB') return renderNoDb();
    renderFatal(err);
  }
}

boot();
