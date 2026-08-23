# Mercado Virtual — Backend

Stack: **Node.js · Express · SQLite (better-sqlite3) · JWT · bcryptjs**

---

## Estrutura

```
mercado-backend/
├── server.js          ← API REST + serve o frontend
├── package.json
├── mercado.db         ← criado automaticamente na 1ª execução
└── public/
    └── index.html     ← frontend completo (HTML + CSS + JS)
```

---

## Instalação e execução

```bash
# 1. Entre na pasta
cd mercado-backend

# 2. Instale as dependências
npm install

# 3. Inicie o servidor
npm start
# → http://localhost:3000
```

Para desenvolvimento com reload automático (Node 18+):
```bash
npm run dev
```

Para mudar a porta:
```bash
PORT=8080 npm start
```

Para usar um JWT Secret próprio em produção:
```bash
JWT_SECRET="sua-chave-segura-aqui" npm start
```

---

## Acesso inicial

| Tipo       | Como entrar                              |
|------------|------------------------------------------|
| Cliente    | Clique em "Entrar como cliente" (sem senha) |
| Gerente    | Usuário: `gerente` · Senha: `1234`       |

> ⚠️ Troque a senha padrão logo na primeira sessão em "Configurações do gerente".

---

## Endpoints da API

### Autenticação
| Método | Rota                       | Acesso   | Descrição                      |
|--------|----------------------------|----------|--------------------------------|
| POST   | /api/auth/login            | Público  | Retorna JWT                    |
| POST   | /api/auth/change-password  | Auth     | Troca a senha do usuário atual |
| POST   | /api/auth/create-manager   | Gerente  | Cria outro gerente             |
| GET    | /api/auth/managers         | Gerente  | Lista gerentes cadastrados     |
| DELETE | /api/auth/managers/:id     | Gerente  | Remove um gerente              |

### Layouts
| Método | Rota                         | Acesso   | Descrição                         |
|--------|------------------------------|----------|-----------------------------------|
| GET    | /api/layouts/active          | Público  | Layout publicado atualmente        |
| GET    | /api/layouts                 | Gerente  | Lista todos os layouts            |
| GET    | /api/layouts/:id             | Gerente  | Carrega um layout específico      |
| POST   | /api/layouts                 | Gerente  | Cria novo layout                  |
| PUT    | /api/layouts/:id             | Gerente  | Atualiza (salva versão anterior)  |
| POST   | /api/layouts/:id/publish     | Gerente  | Publica o layout                  |
| POST   | /api/layouts/:id/unpublish   | Gerente  | Despublica                        |
| DELETE | /api/layouts/:id             | Gerente  | Exclui (só layouts despublicados) |
| GET    | /api/layouts/:id/history     | Gerente  | Histórico de versões (últimas 20) |

---

## Funcionalidades do frontend

### Modo Cliente
- Carrega automaticamente o layout **publicado** pelo gerente
- Clique em prateleiras para ver os produtos cadastrados
- Monta lista de compras e calcula a **melhor rota** (BFS + vizinho mais próximo)

### Modo Gerente
- **Biblioteca de layouts**: salvar, carregar, publicar, despublicar, excluir
- **Editor de planta**: pintar/apagar células (entrada, caixa, prateleiras, paredes)
- **Editor de prateleiras**: cadastrar/remover produtos por célula
- **Mesclar prateleiras** (Ctrl+clique em 2+ prateleiras):
  - Vê quais produtos são comuns a todas, quais são parciais
  - Adiciona um produto a **todas** de uma vez
  - "Equalizar": aplica a **união** de todos os produtos a todas as prateleiras selecionadas
  - "→todas": promove produto parcial para todas
- **Histórico automático**: cada `PUT` salva a versão anterior no `layout_history`
- **Configurações**: trocar senha, criar outros gerentes

---

## Produção (exemplo simples com PM2)

```bash
npm install -g pm2
JWT_SECRET="troque-aqui" pm2 start server.js --name mercado
pm2 save && pm2 startup
```

Para HTTPS em produção, coloque um nginx/caddy na frente como reverse proxy.
