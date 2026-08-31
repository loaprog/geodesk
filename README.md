# GeoDesk — editor geográfico + whiteboard

MVP de um espaço de trabalho que combina mapa, dados geográficos e desenho livre. A interface do projeto segue uma organização inspirada em Figma/Excalidraw: camadas à esquerda, ferramentas no topo e o mapa ocupando o canvas.

## O que esta versão faz

- Login com sessão e dashboard de projetos.
- Nome do projeto editável diretamente no editor, no estilo Figma.
- Indicador delicado de conexão Online/Offline.
- Editor em canvas, sem barra branca ocupando toda a parte superior.
- Painel de camadas dividido em **Geo** e **Desenhos**.
- Ferramentas de seleção, mover mapa, polígono geográfico, retângulo, elipse, linha, seta, texto e imagem.
- Importação de GeoJSON e Shapefile em `.zip` pelo navegador.
- Desenhos livres ficam em uma camada visual independente e não são georreferenciados.
- Camadas geográficas continuam usando PostGIS/GeoJSON e Mapbox.
- Alternância entre mapa de ruas e satélite.
- Compartilhamento e publicação do projeto.

## Executar

1. Ajuste `.env` com `SECRET_KEY`, `DATABASE_URL` e `MAPBOX_TOKEN`.
2. Execute:

```bash
docker compose up --build
```

3. Acesse `http://localhost:8001`.

O usuário inicial é `admin` / `admin`. Não existe cadastro público. O banco e as tabelas são criados automaticamente na inicialização; o admin só é criado se não existir.

## GeoDesk editor updates

- Geo layers and drawing layers are separated in the editor.
- Imported GeoJSON/Shapefile data is persisted in PostgreSQL/PostGIS.
- Drawings (including embedded images), drawing visibility/order and basemap visibility are persisted in `project_settings`.
- Shared links are read-only viewers; each viewer keeps independent layer visibility in their own browser.
- Geo layers support selection, double-click vertex editing, delete-vertex, zoom and attribute table actions.
- Drawing layers support zoom, rename/delete and per-drawing fill/border styling.
