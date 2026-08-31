# Deploy no Render

## 1. Banco
Crie um PostgreSQL com PostGIS (por exemplo, Supabase) e copie a URL de conexão.

O projeto usa SQLAlchemy assíncrono com `asyncpg`, portanto `DATABASE_URL` deve ser compatível
com `postgresql+asyncpg://...`.

## 2. GitHub
Envie este projeto para um repositório GitHub. Não envie `.env` com segredos.

## 3. Render
No Render, crie um Web Service conectado ao repositório. O `render.yaml` deste projeto
configura Docker e `autoDeploy: true`, então novos commits na branch conectada acionam novo deploy.

Se o Render pedir a porta, use 8000. O Dockerfile também aceita a variável `PORT`.

## 4. Environment Variables
Cadastre no Render:

- `APP_ENV=production`
- `SECRET_KEY=<gere uma chave aleatória forte>`
- `DATABASE_URL=<URL PostgreSQL/PostGIS>`
- `ADMIN_USERNAME=admin` (ou outro)
- `ADMIN_PASSWORD=<senha forte>`
- `SESSION_COOKIE_NAME=webgis_session`
- `MAPBOX_TOKEN=pk....`

As variáveis marcadas como `sync: false` no `render.yaml` são secretas e devem ser preenchidas
no painel do Render.

## 5. Primeiro deploy
Depois do primeiro deploy, abra a URL fornecida pelo Render e faça login.

O container executa automaticamente:
`python -m src.database.init_db`
e depois inicia o Uvicorn.

## 6. Atualizações
Com `autoDeploy: true`, o fluxo é:

git add .
git commit -m "minha alteração"
git push

O GitHub recebe o commit e o Render inicia o deploy automaticamente.

## Observação sobre arquivos
Para o teste atual, os dados geográficos são persistidos no PostgreSQL/PostGIS.
Não use armazenamento local do container como armazenamento permanente para grandes arquivos
ou GeoTIFFs. Para uma futura camada de raster/COG, use object storage + serviço de tiles.
