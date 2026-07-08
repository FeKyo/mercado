/**
 * Mercado Virtual — Backend
 * Stack: Express · better-sqlite3 · jsonwebtoken · bcryptjs
 *
 * Rodando: npm install && npm start
 * Porta padrão: 3000  (sobrescreva com PORT=xxxx)
 */

const express  = require('express');
const Database = require('better-sqlite3');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');
const path     = require('path');

// ─── App & Config ────────────────────────────────────────────────────────────
const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'mercado-secret-dev-troque-em-producao';
const SALT   = 10;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Banco de dados ───────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'mercado.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'manager',
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS layouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    data        TEXT    NOT NULL,       -- JSON completo da planta
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES users(id),
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
`);

// Seed: cria gerente padrão se não houver usuários
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (userCount.c === 0) {
  db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'manager')`)
    .run('gerente', bcrypt.hashSync('1234', SALT));
  console.log('  Gerente padrão criado — usuário: gerente / senha: 1234');
}

// ─── Middlewares de autenticação ──────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token ausente ou mal-formatado' });
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function managerOnly(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'manager')
      return res.status(403).json({ error: 'Apenas gerentes têm acesso a essa rota' });
    next();
  });
}

// ─── Rotas: Auth ─────────────────────────────────────────────────────────────
// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password)
    return res.status(400).json({ error: 'Informe usuário e senha' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Usuário ou senha incorretos' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, role: user.role, username: user.username });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Informe a senha atual e a nova senha' });
  if (newPassword.length < 4)
    return res.status(400).json({ error: 'A nova senha precisa ter ao menos 4 caracteres' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(400).json({ error: 'Senha atual incorreta' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, SALT), req.user.id);
  res.json({ ok: true });
});

// POST /api/auth/create-manager  (somente gerentes criam outros gerentes)
app.post('/api/auth/create-manager', managerOnly, (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password)
    return res.status(400).json({ error: 'Informe usuário e senha' });
  try {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'manager')`)
      .run(username, bcrypt.hashSync(password, SALT));
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Esse nome de usuário já existe' });
  }
});

// GET /api/auth/managers  (lista gerentes — somente gerentes)
app.get('/api/auth/managers', managerOnly, (req, res) => {
  const rows = db.prepare(`SELECT id, username, created_at FROM users WHERE role = 'manager' ORDER BY username`).all();
  res.json(rows);
});

// DELETE /api/auth/managers/:id
app.delete('/api/auth/managers/:id', managerOnly, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Não é possível remover a si mesmo' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Rotas: Layouts ───────────────────────────────────────────────────────────

// GET /api/layouts/active   ← público (clientes)
app.get('/api/layouts/active', (req, res) => {
  const layout = db
    .prepare(`SELECT l.*, u.username as created_by_name
              FROM layouts l
              LEFT JOIN users u ON u.id = l.created_by
              WHERE l.is_active = 1
              ORDER BY l.updated_at DESC LIMIT 1`)
    .get();
  if (!layout) return res.json(null);
  res.json({ ...layout, data: JSON.parse(layout.data) });
});

// GET /api/layouts           ← gerente: lista todos
app.get('/api/layouts', managerOnly, (req, res) => {
  const layouts = db.prepare(`
    SELECT l.id, l.name, l.is_active, l.created_at, l.updated_at, u.username as created_by_name
    FROM layouts l
    LEFT JOIN users u ON u.id = l.created_by
    ORDER BY l.updated_at DESC
  `).all();
  res.json(layouts);
});

// GET /api/layouts/:id       ← gerente
app.get('/api/layouts/:id', managerOnly, (req, res) => {
  const layout = db.prepare('SELECT * FROM layouts WHERE id = ?').get(req.params.id);
  if (!layout) return res.status(404).json({ error: 'Layout não encontrado' });
  res.json({ ...layout, data: JSON.parse(layout.data) });
});

// GET /api/layouts/:id/history  ← gerente: histórico de versões
app.get('/api/layouts/:id/history', managerOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT h.id, h.saved_at, u.username as saved_by_name
    FROM layout_history h
    LEFT JOIN users u ON u.id = h.saved_by
    WHERE h.layout_id = ?
    ORDER BY h.saved_at DESC
    LIMIT 20
  `).all(req.params.id);
  res.json(rows);
});

// GET /api/layouts/history/:histId  ← gerente: restaura versão específica
app.get('/api/layouts/history/:histId', managerOnly, (req, res) => {
  const row = db.prepare('SELECT * FROM layout_history WHERE id = ?').get(req.params.histId);
  if (!row) return res.status(404).json({ error: 'Versão não encontrada' });
  res.json({ ...row, data: JSON.parse(row.data) });
});

// POST /api/layouts          ← gerente: cria novo
app.post('/api/layouts', managerOnly, (req, res) => {
  const { name, data, publish } = req.body ?? {};
  if (!name || !data) return res.status(400).json({ error: 'Informe nome e dados do layout' });

  const createPublish = db.transaction(() => {
    if (publish) db.prepare('UPDATE layouts SET is_active = 0').run();
    const result = db.prepare(
      'INSERT INTO layouts (name, data, is_active, created_by) VALUES (?, ?, ?, ?)'
    ).run(name, JSON.stringify(data), publish ? 1 : 0, req.user.id);
    return result.lastInsertRowid;
  });

  const id = createPublish();
  res.json({ id, ok: true });
});

// PUT /api/layouts/:id       ← gerente: atualiza (salva nova versão no histórico)
app.put('/api/layouts/:id', managerOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM layouts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Layout não encontrado' });

  const { name, data, publish } = req.body ?? {};

  const updateTx = db.transaction(() => {
    // Salva versão anterior no histórico
    db.prepare('INSERT INTO layout_history (layout_id, data, saved_by) VALUES (?, ?, ?)')
      .run(existing.id, existing.data, req.user.id);

    if (publish) db.prepare('UPDATE layouts SET is_active = 0').run();

    db.prepare(`
      UPDATE layouts
      SET name = ?, data = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? existing.name,
      JSON.stringify(data),
      publish ? 1 : (publish === false ? 0 : existing.is_active),
      existing.id
    );
  });

  updateTx();
  res.json({ ok: true });
});

// POST /api/layouts/:id/publish  ← gerente: publica sem alterar dados
app.post('/api/layouts/:id/publish', managerOnly, (req, res) => {
  const existing = db.prepare('SELECT id FROM layouts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Layout não encontrado' });

  db.transaction(() => {
    db.prepare('UPDATE layouts SET is_active = 0').run();
    db.prepare(`UPDATE layouts SET is_active = 1, updated_at = datetime('now') WHERE id = ?`)
      .run(existing.id);
  })();

  res.json({ ok: true });
});

// POST /api/layouts/:id/unpublish ← gerente: despublica
app.post('/api/layouts/:id/unpublish', managerOnly, (req, res) => {
  db.prepare(`UPDATE layouts SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/layouts/:id    ← gerente
app.delete('/api/layouts/:id', managerOnly, (req, res) => {
  const layout = db.prepare('SELECT * FROM layouts WHERE id = ?').get(req.params.id);
  if (!layout) return res.status(404).json({ error: 'Layout não encontrado' });
  if (layout.is_active) return res.status(400).json({ error: 'Despublique o layout antes de deletá-lo' });
  db.prepare('DELETE FROM layouts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Catch-all: SPA ──────────────────────────────────────────────────────────
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛒  Mercado Virtual rodando em http://localhost:${PORT}`);
  console.log(`    Banco: mercado.db`);
  console.log(`    Gerente padrão: gerente / 1234 (troque na primeira sessão)\n`);
});
