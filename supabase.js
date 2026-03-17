// ===== Supabase 認証・DB モジュール =====

const _sb = (
  typeof SUPABASE_URL !== 'undefined' &&
  typeof SUPABASE_ANON_KEY !== 'undefined' &&
  typeof window.supabase !== 'undefined'
) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let _sbUser = null;

// ===== 認証 =====
async function sbGetSession() {
  if (!_sb) return null;
  const { data } = await _sb.auth.getSession();
  _sbUser = data?.session?.user || null;
  return _sbUser;
}

async function sbSignInGoogle() {
  if (!_sb) throw new Error('Supabase未設定');
  const { error } = await _sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

async function sbSignInEmail(email, password) {
  if (!_sb) return { error: { message: 'Supabase未設定' } };
  return _sb.auth.signInWithPassword({ email, password });
}

async function sbSignUpEmail(email, password) {
  if (!_sb) return { error: { message: 'Supabase未設定' } };
  return _sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
}

async function sbSignOut() {
  if (!_sb) return;
  await _sb.auth.signOut();
  _sbUser = null;
}

function sbOnAuthChange(callback) {
  if (!_sb) return;
  _sb.auth.onAuthStateChange((event, session) => {
    _sbUser = session?.user || null;
    callback(event, _sbUser);
  });
}

function sbCurrentUser() { return _sbUser; }

// ===== ユーザー設定 =====
async function sbLoadSettings() {
  if (!_sb || !_sbUser) return null;
  const { data, error } = await _sb
    .from('user_settings')
    .select('*')
    .eq('user_id', _sbUser.id)
    .single();
  if (error && error.code !== 'PGRST116') console.warn('[Supabase]', error.message);
  return data || null;
}

async function sbSaveSettings(patch) {
  if (!_sb || !_sbUser) return;
  await _sb.from('user_settings').upsert(
    { user_id: _sbUser.id, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
}

// ===== ユーザーログ =====
function sbLog(action, payload = {}) {
  if (!_sb || !_sbUser) return;
  _sb.from('user_logs')
    .insert({ user_id: _sbUser.id, action, payload })
    .then(() => {});
}
