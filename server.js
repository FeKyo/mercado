/**
 * Mercado Virtual — Backend v2
 * Novidades:
 *  - Clientes podem se cadastrar e fazer login
 *  - Listas de compras salvas por cliente (privadas)
 *  - Layouts isolados por gerente (cada um só vê os seus)
 *  - Layout publicado continua acessível a todos (clientes)
 */

const express  = require('express');
const Database = require('better-sqlite3');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');
const path     = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'mercado-secret-dev-troque-em-producao';
const SALT   = 10;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Banco ───────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'mercado.db'));
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'customer',
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS layouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    data        TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT    DEFAULT (datetime('now')),
    updated_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS layout_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    layout_id   INTEGER NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    data        TEXT    NOT NULL,
    saved_by    INTEGER REFERENCES users(id),
    saved_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shopping_lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL DEFAULT 'Minha lista',
    items       TEXT    NOT NULL DEFAULT '[]',
    created_at  TEXT    DEFAULT (datetime('now')),
    updated_at  TEXT    DEFAULT (datetime('now'))
  );
`);

// Seed: gerente padrão
const userCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='manager'").get();
if (userCount.c === 0) {
  db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'manager')`)
    .run('gerente', bcrypt.hashSync('1234', SALT));
  console.log('  Gerente padrão: usuário=gerente / senha=1234');
}

// ─── Middlewares ──────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token ausente' });
  try { req.user = jwt.verify(h.slice(7), SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido ou expirado' }); }
}

function managerOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'manager')
      return res.status(403).json({ error: 'Acesso restrito a gerentes' });
    next();
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

// POST /api/auth/register  — cadastro de cliente
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password)
    return res.status(400).json({ error: 'Informe usuário e senha' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Senha precisa ter ao menos 4 caracteres' });
  try {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'customer')`)
      .run(username.trim(), bcrypt.hashSync(password, SALT));
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Esse nome de usuário já existe' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password)
    return res.status(400).json({ error: 'Informe usuário e senha' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET, { expiresIn: '8h' }
  );
  res.json({ token, role: user.role, username: user.username });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Informe senha atual e nova' });
  if (newPassword.length < 4)
    return res.status(400).json({ error: 'Nova senha precisa ter ao menos 4 caracteres' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(400).json({ error: 'Senha atual incorreta' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, SALT), req.user.id);
  res.json({ ok: true });
});

// POST /api/auth/create-manager  (somente gerentes)
app.post('/api/auth/create-manager', managerOnly, (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password)
    return res.status(400).json({ error: 'Informe usuário e senha' });
  try {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'manager')`)
      .run(username.trim(), bcrypt.hashSync(password, SALT));
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Esse nome de usuário já existe' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(user);
});

// ─── Layouts ──────────────────────────────────────────────────────────────────

// GET /api/layouts/active  — público: retorna o layout publicado mais recente
app.get('/api/layouts/active', (req, res) => {
  const layout = db.prepare(`
    SELECT l.*, u.username as created_by_name
    FROM layouts l
    LEFT JOIN users u ON u.id = l.created_by
    WHERE l.is_active = 1
    ORDER BY l.updated_at DESC LIMIT 1
  `).get();
  if (!layout) return res.json(null);
  res.json({ ...layout, data: JSON.parse(layout.data) });
});

// GET /api/layouts  — gerente: APENAS os layouts desse gerente
app.get('/api/layouts', managerOnly, (req, res) => {
  const layouts = db.prepare(`
    SELECT id, name, is_active, created_at, updated_at
    FROM layouts
    WHERE created_by = ?
    ORDER BY updated_at DESC
  `).all(req.user.id);
  res.json(layouts);
});

// GET /api/layouts/:id  — gerente: só pode acessar o próprio
app.get('/api/layouts/:id', managerOnly, (req, res) => {
  const layout = db.prepare('SELECT * FROM layouts WHERE id = ? AND created_by = ?')
    .get(req.params.id, req.user.id);
  if (!layout) return res.status(404).json({ error: 'Layout não encontrado' });
  res.json({ ...layout, data: JSON.parse(layout.data) });
});

// POST /api/layouts  — gerente: cria layout vinculado a ele
app.post('/api/layouts', managerOnly, (req, res) => {
  const { name, data, publish } = req.body ?? {};
  if (!name || !data) return res.status(400).json({ error: 'Informe nome e dados' });

  const tx = db.transaction(() => {
    // ao publicar, despublica todos do mesmo gerente
    if (publish) db.prepare('UPDATE layouts SET is_active = 0 WHERE created_by = ?').run(req.user.id);
    const r = db.prepare(`
      INSERT INTO layouts (name, data, is_active, created_by) VALUES (?, ?, ?, ?)
    `).run(name, JSON.stringify(data), publish ? 1 : 0, req.user.id);
    return r.lastInsertRowid;
  });

  res.json({ id: tx(), ok: true });
});

// PUT /api/layouts/:id  — gerente: atualiza (só o próprio)
app.put('/api/layouts/:id', managerOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM layouts WHERE id = ? AND created_by = ?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Layout não encontrado' });

  const { name, data, publish } = req.body ?? {};

  db.transaction(() => {
    db.prepare('INSERT INTO layout_history (layout_id, data, saved_by) VALUES (?, ?, ?)')
      .run(existing.id, existing.data, req.user.id);
    if (publish) db.prepare('UPDATE layouts SET is_active = 0 WHERE created_by = ?').run(req.user.id);
    db.prepare(`
      UPDATE layouts SET name=?, data=?, is_active=?, updated_at=datetime('now') WHERE id=?
    `).run(
      name ?? existing.name,
      JSON.stringify(data),
      publish ? 1 : (publish === false ? 0 : existing.is_active),
      existing.id
    );
  })();

  res.json({ ok: true });
});

// POST /api/layouts/:id/publish
app.post('/api/layouts/:id/publish', managerOnly, (req, res) => {
  const layout = db.prepare('SELECT id FROM layouts WHERE id = ? AND created_by = ?')
    .get(req.params.id, req.user.id);
  if (!layout) return res.status(404).json({ error: 'Layout não encontrado' });
  db.transaction(() => {
    db.prepare('UPDATE layouts SET is_active = 0 WHERE created_by = ?').run(req.user.id);
    db.prepare(`UPDATE layouts SET is_active=1, updated_at=datetime('now') WHERE id=?`).run(layout.id);
  })();
  res.json({ ok: true });
});

// POST /api/layouts/:id/unpublish
app.post('/api/layouts/:id/unpublish', managerOnly, (req, res) => {
  db.prepare(`UPDATE layouts SET is_active=0, updated_at=datetime('now') WHERE id=? AND created_by=?`)
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// DELETE /api/layouts/:id
app.delete('/api/layouts/:id', managerOnly, (req, res) => {
  const layout = db.prepare('SELECT * FROM layouts WHERE id = ? AND created_by = ?')
    .get(req.params.id, req.user.id);
  if (!layout) return res.status(404).json({ error: 'Layout não encontrado' });
  if (layout.is_active) return res.status(400).json({ error: 'Despublique antes de excluir' });
  db.prepare('DELETE FROM layouts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Listas de compras (clientes autenticados) ────────────────────────────────

// GET /api/shopping-lists  — listas do usuário logado
app.get('/api/shopping-lists', auth, (req, res) => {
  const lists = db.prepare(`
    SELECT id, name, items, created_at, updated_at
    FROM shopping_lists WHERE user_id = ? ORDER BY updated_at DESC
  `).all(req.user.id);
  res.json(lists.map(l => ({ ...l, items: JSON.parse(l.items) })));
});

// POST /api/shopping-lists  — cria nova lista
app.post('/api/shopping-lists', auth, (req, res) => {
  const { name, items } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'Informe um nome para a lista' });
  const r = db.prepare(`
    INSERT INTO shopping_lists (user_id, name, items) VALUES (?, ?, ?)
  `).run(req.user.id, name.trim(), JSON.stringify(items ?? []));
  res.json({ id: r.lastInsertRowid, ok: true });
});

// PUT /api/shopping-lists/:id  — atualiza lista (só a própria)
app.put('/api/shopping-lists/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM shopping_lists WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Lista não encontrada' });
  const { name, items } = req.body ?? {};
  db.prepare(`
    UPDATE shopping_lists SET name=?, items=?, updated_at=datetime('now') WHERE id=?
  `).run(name ?? existing.name, JSON.stringify(items ?? JSON.parse(existing.items)), req.params.id);
  res.json({ ok: true });
});

// DELETE /api/shopping-lists/:id
app.delete('/api/shopping-lists/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT id FROM shopping_lists WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Lista não encontrada' });
  db.prepare('DELETE FROM shopping_lists WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── SPA catch-all ───────────────────────────────────────────────────────────
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🛒  Mercado Virtual rodando em http://localhost:${PORT}`);
  console.log(`    Gerente padrão: gerente / 1234\n`);
});
