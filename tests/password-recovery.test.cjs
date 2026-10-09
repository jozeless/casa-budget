const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const incoming = {user: {id: 'recovery-user'}, access_token: 'synthetic-incoming'};
const previous = {user: {id: 'previous-user'}, access_token: 'synthetic-previous'};
const recoveryHash = '#type=recovery&access_token=synthetic-incoming&refresh_token=synthetic-refresh';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const settle = () => new Promise(resolve => setImmediate(resolve));

function mount({hash = recoveryHash, initialize, getSession, updateUser} = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', value: '', disabled: false, hidden: true,
      classList: {toggle(_name, hidden) {element(id).hidden = hidden;}, add() {}, remove() {}},
      reset() {}, focus() {}, reportValidity() {return true;}
    });
    return elements.get(id);
  };
  let callback, session = incoming;
  const calls = {updates: 0, queries: 0, resets: 0};
  const logs = [];
  const timers = [];
  const client = {auth: {
    onAuthStateChange(fn) {callback = fn; return {data: {subscription: {unsubscribe() {}}}};},
    initialize: initialize || (async () => ({error: null})),
    getSession: getSession || (async () => ({data: {session}, error: null})),
    async updateUser(options) {
      calls.updates++;
      return updateUser ? updateUser(options) : {error: null};
    },
    async resetPasswordForEmail() {calls.resets++; return {error: null};}
  }, from() {
    calls.queries++;
    return {select() {return this;}, eq() {return this;}, async maybeSingle() {return {data: null, error: null};}};
  }};
  const context = {
    Date, Intl, URLSearchParams, Number, String, Map, Math, Promise,
    setTimeout(fn) {timers.push(fn); return timers.length;}, clearTimeout() {},
    console: {error(...args) {logs.push(args);}, warn(...args) {logs.push(args);}, log(...args) {logs.push(args);}},
    location: {hash, search: '', pathname: '/casa-budget/', protocol: 'http:', hostname: 'test'},
    history: {replaceState() {}}, navigator: {},
    window: {CASA_CONFIG: {supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'sb_publishable_test'}, supabase: {createClient() {return client;}}},
    document: {getElementById: element, querySelectorAll() {return [];}},
    localStorage: {getItem() {return null;}}
  };
  vm.runInNewContext(app, context);
  return {
    element, calls, logs, timers,
    emit(event, next = session) {session = next; callback(event, next);},
    setSession(next) {session = next;},
    submit() {return element('recovery-form').onsubmit({preventDefault() {}});},
    valid() {assert.equal(element('save-password').disabled, false); assert.equal(element('recovery-view').hidden, false);},
    pending() {assert.equal(element('save-password').disabled, true); assert.equal(element('recovery-message').textContent, 'Verificando enlace…'); assert.equal(element('recovery-view').hidden, false);},
    invalid() {assert.equal(element('save-password').disabled, true); assert.match(element('recovery-message').textContent, /caducado o no es válido/);}
  };
}

test('pending while initialization runs; submission does not mark the link invalid', async () => {
  const init = deferred();
  const ui = mount({initialize: () => init.promise});
  ui.pending();
  await ui.submit();
  ui.pending();
  assert.equal(ui.calls.updates, 0);
  init.resolve({error: null});
  await settle();
  ui.valid();
});

test('getSession before PASSWORD_RECOVERY accepts only the session from the processed URL', async () => {
  const ui = mount();
  await settle();
  ui.valid();
  assert.doesNotMatch(ui.element('recovery-message').textContent, /caducado/);
  ui.emit('PASSWORD_RECOVERY', incoming);
  ui.valid();
  assert.equal(ui.calls.queries, 0);
});

test('PASSWORD_RECOVERY before initialization completes stays valid', async () => {
  const init = deferred();
  const ui = mount({initialize: () => init.promise});
  ui.emit('PASSWORD_RECOVERY', incoming);
  ui.valid();
  init.resolve({error: null});
  await settle();
  ui.valid();
});

test('old INITIAL_SESSION followed by getSession remains pending until recovery event', async () => {
  const ui = mount({getSession: async () => ({data: {session: previous}, error: null})});
  ui.emit('INITIAL_SESSION', previous);
  await settle();
  ui.pending();
  ui.emit('SIGNED_IN', previous);
  ui.pending();
  ui.emit('PASSWORD_RECOVERY', incoming);
  ui.valid();
});

test('recovery event between initialize and getSession completion', async () => {
  const read = deferred();
  const ui = mount({getSession: () => read.promise});
  await settle();
  ui.pending();
  ui.emit('PASSWORD_RECOVERY', incoming);
  read.resolve({data: {session: incoming}, error: null});
  await settle();
  ui.valid();
});

test('malformed type-only link cannot authorize an old stored session', async () => {
  const ui = mount({hash: '#type=recovery', getSession: async () => ({data: {session: previous}, error: null})});
  await settle();
  ui.invalid();
  await ui.submit();
  assert.equal(ui.calls.updates, 0);
});

test('expired link initialization error is terminal even if a notification arrives late', async () => {
  const ui = mount({initialize: async () => ({error: {name: 'AuthImplicitGrantRedirectError', code: 'otp_expired'}})});
  await settle();
  ui.invalid();
  ui.emit('PASSWORD_RECOVERY', incoming);
  ui.invalid();
});

test('error metadata in URL disables saving without displaying its description', async () => {
  const ui = mount({hash: '#error=access_denied&error_code=otp_expired&error_description=untrusted-description'});
  await settle();
  ui.invalid();
  assert.doesNotMatch(ui.element('recovery-message').textContent, /untrusted-description/);
  assert.equal(ui.logs.length, 0);
});

test('completed initialization with no session confirms an unusable link', async () => {
  const ui = mount({getSession: async () => ({data: {session: null}, error: null})});
  await settle();
  ui.invalid();
});

test('network initialization failure remains pending, not expired', async () => {
  const ui = mount({initialize: async () => {throw Error('sensitive-placeholder');}});
  await settle();
  assert.equal(ui.element('save-password').disabled, true);
  assert.match(ui.element('recovery-message').textContent, /conexión/);
  assert.doesNotMatch(ui.element('recovery-message').textContent, /caducado|sensitive-placeholder/);
  assert.equal(ui.logs.length, 0);
});

test('SIGNED_OUT and a different signed-in user invalidate an authorized recovery', async () => {
  for (const [event, session] of [['SIGNED_OUT', null], ['SIGNED_IN', previous]]) {
    const ui = mount();
    await settle();
    ui.valid();
    ui.emit(event, session);
    ui.invalid();
  }
});

test('saving checks the current user and rejects replacement by an old session', async () => {
  const ui = mount();
  await settle();
  ui.setSession(previous);
  ui.element('new-password').value = ui.element('confirm-password').value = 'synthetic-password';
  await ui.submit();
  ui.invalid();
  assert.equal(ui.calls.updates, 0);
});

test('deferred events cannot re-enable saving during updateUser', async () => {
  const update = deferred();
  const ui = mount({updateUser: () => update.promise});
  await settle();
  ui.element('new-password').value = ui.element('confirm-password').value = 'synthetic-password';
  const saving = ui.submit();
  await settle();
  assert.equal(ui.calls.updates, 1);
  ui.emit('PASSWORD_RECOVERY', incoming);
  assert.equal(ui.element('save-password').disabled, true);
  update.resolve({error: {code: 'weak_password', status: 422}});
  await saving;
  ui.valid();
  assert.match(ui.element('recovery-message').textContent, /rechazada/);
});

test('successful update resumes normal household routing without logging credentials', async () => {
  const ui = mount();
  await settle();
  ui.element('new-password').value = ui.element('confirm-password').value = 'synthetic-password';
  await ui.submit();
  assert.equal(ui.calls.updates, 1);
  assert.equal(ui.element('home-setup-view').hidden, false);
  assert.equal(ui.logs.length, 0);
});

test('normal startup without a recovery link still displays login', async () => {
  const ui = mount({hash: '', getSession: async () => ({data: {session: null}, error: null})});
  await settle();
  assert.equal(ui.element('auth-view').hidden, false);
  assert.equal(ui.element('recovery-view').hidden, true);
});

test('requesting another link cancels late recovery notifications', async () => {
  const init = deferred();
  const ui = mount({initialize: () => init.promise});
  ui.element('recovery-retry-btn').onclick();
  ui.emit('PASSWORD_RECOVERY', incoming);
  assert.equal(ui.element('auth-view').hidden, false);
  assert.equal(ui.element('save-password').disabled, true);
  init.resolve({error: null});
  await settle();
});

test('invalid link still allows requesting a replacement email', async () => {
  const ui = mount({hash: '#error=access_denied&error_code=otp_expired'});
  await settle();
  ui.invalid();
  ui.element('recovery-retry-btn').onclick();
  ui.element('auth-email').value = 'test@example.com';
  await ui.element('forgot-password-btn').onclick();
  assert.equal(ui.calls.resets, 1);
  assert.match(ui.element('auth-message').textContent, /Si existe una cuenta/);
});
