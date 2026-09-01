document.addEventListener("DOMContentLoaded", () => {
    setupModals();
    setupDashboard();
    setupProjectNameEditor();
    setupProjectStatus();
    initMapEditor();
});

function setupModals() {
    const openModal = (id) => {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.hidden = false;
        document.body.classList.add("modal-open");
        const input = modal.querySelector("input:not([readonly])");
        if (input) setTimeout(() => input.focus(), 20);
    };
    const closeModal = (modal) => {
        if (!modal) return;
        modal.hidden = true;
        document.body.classList.remove("modal-open");
    };
    document.querySelectorAll("[data-open-modal]").forEach(button => button.addEventListener("click", () => openModal(button.dataset.openModal)));
    document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", () => closeModal(button.closest(".modal-backdrop"))));
    document.querySelectorAll(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(backdrop); }));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            document.querySelectorAll(".modal-backdrop:not([hidden])").forEach(closeModal);
            document.querySelectorAll(".card-menu.open, .layer-context-menu.open").forEach(menu => menu.classList.remove("open"));
        }
    });
    const copyButton = document.querySelector("[data-copy-link]");
    if (copyButton) copyButton.addEventListener("click", async () => {
        const input = document.getElementById("share-link");
        try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand("copy"); }
        copyButton.textContent = "Copiado";
        setTimeout(() => copyButton.textContent = "Copiar", 1600);
    });
}

function setupDashboard() {
    document.querySelectorAll("[data-menu-button]").forEach(button => button.addEventListener("click", event => {
        event.stopPropagation();
        const menu = button.closest("[data-project-card]")?.querySelector("[data-menu]");
        document.querySelectorAll(".card-menu.open").forEach(item => { if (item !== menu) item.classList.remove("open"); });
        menu?.classList.toggle("open");
    }));
    document.addEventListener("click", () => document.querySelectorAll(".card-menu.open").forEach(menu => menu.classList.remove("open")));
    document.querySelectorAll("[data-rename-project]").forEach(button => button.addEventListener("click", () => {
        document.querySelectorAll(".card-menu.open").forEach(menu => menu.classList.remove("open"));
        const form = document.getElementById("rename-form"), input = document.getElementById("rename-name"), modal = document.getElementById("rename-project-modal");
        if (!form || !input || !modal) return;
        form.action = `/projects/${button.dataset.projectId}/rename`;
        input.value = button.dataset.projectName;
        modal.hidden = false; document.body.classList.add("modal-open"); input.focus(); input.setSelectionRange(0, input.value.length);
    }));
    document.querySelectorAll("[data-delete-project]").forEach(button => button.addEventListener("click", () => {
        document.querySelectorAll(".card-menu.open").forEach(menu => menu.classList.remove("open"));
        const name = document.getElementById("delete-project-name"), form = document.getElementById("delete-form"), modal = document.getElementById("delete-project-modal");
        if (name) name.textContent = button.dataset.projectName;
        if (form) form.action = `/projects/${button.dataset.projectId}/delete`;
        if (modal) { modal.hidden = false; document.body.classList.add("modal-open"); }
    }));
    const previews=[...document.querySelectorAll("[data-project-preview]")];
    if(previews.length) renderDashboardPreviews(previews);
}

async function renderDashboardPreviews(previews) {
    try {
        const response=await fetch("/api/dashboard/previews",{headers:{Accept:"application/json"},cache:"default"});
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload=await response.json();
        const byId=payload.projects||{};
        previews.forEach(preview=>{
            const projectId=preview.dataset.projectPreview;
            const canvas=preview.classList.contains("preview-canvas")?preview:preview.querySelector(".preview-canvas");
            const data=byId[String(projectId)];
            if(!canvas||!data)return;
            canvas.querySelectorAll(".preview-art").forEach(el=>el.remove());
            drawPreviewGeo(canvas,data.geojson||{type:"FeatureCollection",features:[]},data.camera,data.viewport);
            drawPreviewDrawings(canvas,Array.isArray(data.drawings)?data.drawings:[],data.viewport);
        });
    } catch(error) {
        console.error("[GeoDesk] Falha nas prévias do dashboard",error);
    }
}

function drawPreviewGeo(canvas, geojson, camera=null, viewport=null) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.classList.add("preview-art"); svg.setAttribute("viewBox", camera?.center ? `0 0 ${Math.max(canvas.clientWidth,1)} ${Math.max(canvas.clientHeight,1)}` : "0 0 100 70"); svg.setAttribute("preserveAspectRatio", "none");
    const coords = []; let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    const visit=v=>{
        if(!Array.isArray(v))return;
        if(v.length>=2 && typeof v[0]==="number" && typeof v[1]==="number"){
            const x=v[0],y=v[1]; minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
            if(coords.length<6000)coords.push(v); return;
        }
        v.forEach(visit);
    };
    (geojson.features||[]).forEach(f=>visit(f.geometry?.coordinates));
    if(!coords.length || !Number.isFinite(minX)) return;
    const vw=Math.max(1,Number(viewport?.width||camera?.viewport?.width||camera?.viewport_width||canvas.clientWidth||1));
    const vh=Math.max(1,Number(viewport?.height||camera?.viewport?.height||camera?.viewport_height||canvas.clientHeight||1));
    let sx,sy;
    if(camera?.center && Array.isArray(camera.center) && Number.isFinite(Number(camera.zoom))){
        const world=512*Math.pow(2,Number(camera.zoom)||0);
        const project=(lon,lat)=>{
            const x=(Number(lon)+180)/360*world;
            const latRad=Math.max(-85.05112878,Math.min(85.05112878,Number(lat)))*Math.PI/180;
            const y=(1-Math.log(Math.tan(latRad)+1/Math.cos(latRad))/Math.PI)/2*world;
            const cx=(Number(camera.center[0])+180)/360*world;
            const cr=Math.max(-85.05112878,Math.min(85.05112878,Number(camera.center[1])))*Math.PI/180;
            const cy=(1-Math.log(Math.tan(cr)+1/Math.cos(cr))/Math.PI)/2*world;
            let px=x-cx+vw/2, py=y-cy+vh/2;
            const bearing=(Number(camera.bearing)||0)*Math.PI/180;
            const rx=px*Math.cos(-bearing)-py*Math.sin(-bearing), ry=px*Math.sin(-bearing)+py*Math.cos(-bearing);
            return [rx,ry];
        };
        sx=(x,y=0)=>project(x,y)[0]*(canvas.clientWidth/vw);
        sy=(y,x=0)=>project(x,y)[1]*(canvas.clientHeight/vh);
    } else {
        sx=x=>8+((x-minX)/((maxX-minX)||1))*84; sy=y=>8+(1-(y-minY)/((maxY-minY)||1))*54;
    }
    const sample=points=>{if(!Array.isArray(points)||points.length<=180)return points||[];const step=(points.length-1)/179,out=[];for(let i=0;i<180;i++)out.push(points[Math.round(i*step)]);return out;};
    const pathFrom=points=>sample(points).map((p,i)=>`${i?"L":"M"}${sx(p[0],p[1])},${sy(p[1],p[0])}`).join(" ");
    (geojson.features||[]).slice(0,80).forEach(feature=>{
        const g=feature.geometry;if(!g)return;
        if(g.type==="Point"){const c=g.coordinates;const circle=document.createElementNS(ns,"circle");circle.setAttribute("cx",sx(c[0],c[1]));circle.setAttribute("cy",sy(c[1],c[0]));circle.setAttribute("r","1.7");circle.setAttribute("class","preview-geo-point");svg.appendChild(circle);return;}
        if(g.type==="MultiPoint"){(g.coordinates||[]).slice(0,100).forEach(c=>{const circle=document.createElementNS(ns,"circle");circle.setAttribute("cx",sx(c[0],c[1]));circle.setAttribute("cy",sy(c[1],c[0]));circle.setAttribute("r","1.7");circle.setAttribute("class","preview-geo-point");svg.appendChild(circle);});return;}
        const path=document.createElementNS(ns,"path");let d="";
        if(g.type==="LineString") d=pathFrom(g.coordinates);
        else if(g.type==="MultiLineString") d=(g.coordinates||[]).slice(0,20).map(pathFrom).join(" ");
        else if(g.type==="Polygon") d=(g.coordinates||[]).slice(0,10).map(r=>pathFrom(r)+" Z").join(" ");
        else if(g.type==="MultiPolygon") d=(g.coordinates||[]).slice(0,10).flatMap(p=>(p||[]).slice(0,10).map(r=>pathFrom(r)+" Z")).join(" ");
        if(d){path.setAttribute("d",d);path.setAttribute("class","preview-geo-shape");svg.appendChild(path);}
    });
    canvas.appendChild(svg);
}

function drawPreviewDrawings(canvas, drawings, viewport=null) {
    if (!drawings?.length) return;
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns,"svg");
    svg.classList.add("preview-art", "preview-drawings");
    const sourceW=Math.max(1,Number(viewport?.width||drawings.reduce((m,d)=>Math.max(m,d.x+(d.w||0)),0)||canvas.clientWidth));
    const sourceH=Math.max(1,Number(viewport?.height||drawings.reduce((m,d)=>Math.max(m,d.y+(d.h||0)),0)||canvas.clientHeight));
    svg.setAttribute("viewBox", `0 0 ${sourceW} ${sourceH}`);
    svg.setAttribute("preserveAspectRatio","xMidYMid meet");
    const sx=1, sy=1;
    drawings.forEach(d => {
        if (d.visible === false) return;
        if (d.type === "text") { const t=document.createElementNS(ns,"text"); t.setAttribute("x",d.x*sx); t.setAttribute("y",d.y*sy); t.textContent=d.text||"Texto"; t.setAttribute("class","preview-draw-text"); svg.appendChild(t); return; }
        if (d.type === "image" && d.src) { const img=document.createElementNS(ns,"image"); img.setAttribute("href",d.src); img.setAttribute("x",d.x*sx); img.setAttribute("y",d.y*sy); img.setAttribute("width",Math.max(1,d.w*sx)); img.setAttribute("height",Math.max(1,d.h*sy)); img.setAttribute("preserveAspectRatio","xMidYMid slice"); svg.appendChild(img); return; }
        if (["rectangle","ellipse","line","arrow"].includes(d.type)) {
            const el=document.createElementNS(ns, d.type === "ellipse" ? "ellipse" : d.type === "line" || d.type === "arrow" ? "line" : "rect");
            if (d.type === "rectangle") { el.setAttribute("x",d.x*sx);el.setAttribute("y",d.y*sy);el.setAttribute("width",d.w*sx);el.setAttribute("height",d.h*sy); }
            if (d.type === "ellipse") { el.setAttribute("cx",(d.x+d.w/2)*sx);el.setAttribute("cy",(d.y+d.h/2)*sy);el.setAttribute("rx",Math.abs(d.w/2*sx));el.setAttribute("ry",Math.abs(d.h/2*sy)); }
            if (d.type === "line" || d.type === "arrow") { el.setAttribute("x1",d.x*sx);el.setAttribute("y1",d.y*sy);el.setAttribute("x2",d.x2*sx);el.setAttribute("y2",d.y2*sy); }
            el.setAttribute("class","preview-draw-shape"); svg.appendChild(el);
        }
    });
    canvas.appendChild(svg);
}

function setupProjectStatus() {
    if(window.WEBGIS_MAP?.public)return;
    const status = document.getElementById("connection-status");
    const toggles = [...document.querySelectorAll("[data-toggle-project-status]")];
    if (!status || !toggles.length) return;
    const initial = status.dataset.online === "true";
    applyStatus(initial);
    toggles.forEach(toggle => toggle.addEventListener("click", async event => {
        event.preventDefault();
        if (toggle.disabled) return;
        toggles.forEach(t => t.disabled = true);
        const next = status.dataset.online !== "true";
        try {
            let camera=null;
            const map=window.WEBGIS_MAP_INSTANCE;
            if(map && map.loaded && map.loaded()){ const c=map.getCenter(); camera={center:[c.lng,c.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}; }
            const response = await fetch(`/api/projects/${toggle.dataset.projectId}/online`, {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({online:next,camera})});
            if (!response.ok) throw new Error();
            const data = await response.json();
            applyStatus(Boolean(data.online));
        } catch { showHint("Não foi possível atualizar o status do projeto."); }
        finally { toggles.forEach(t => t.disabled = false); }
    }));
    function applyStatus(online) {
        status.dataset.online = String(online);
        const dot = status.querySelector(".status-dot"), label = status.querySelector(".status-label");
        dot?.classList.toggle("is-online", online); dot?.classList.toggle("is-offline", !online);
        if (label) label.textContent = online ? "Online" : "Offline";
        toggles.forEach(toggle => {
            toggle.classList.toggle("is-on", online);
            toggle.classList.toggle("is-online", online);
            toggle.setAttribute("aria-label", online ? "Colocar projeto offline" : "Colocar projeto online");
            toggle.setAttribute("title", online ? "Projeto online · clique para deixar offline" : "Projeto offline · clique para colocar online");
        });
    }
}
function setupProjectNameEditor() {
    const editor = document.getElementById("project-name-editor");
    if (!editor) return;
    const original = editor.dataset.projectName || editor.textContent.trim();
    let saving = false;
    const selectOwnText = () => {
        const range = document.createRange(); range.selectNodeContents(editor);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    };
    const save = async () => {
        if (saving) return;
        const name = editor.textContent.trim().replace(/\s+/g," ").slice(0,200);
        if (!name || name === editor.dataset.projectName) { editor.textContent = editor.dataset.projectName || original; return; }
        saving = true; editor.classList.add("is-saving");
        try {
            const response = await fetch(`/api/projects/${editor.dataset.projectId}/name`, {method:"PUT",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({name})});
            if (!response.ok) throw new Error();
            const data = await response.json(); editor.dataset.projectName = data.name;
            document.querySelectorAll(".modal-kicker").forEach(el => el.textContent = data.name);
        } catch { editor.textContent = editor.dataset.projectName || original; showHint("Não foi possível salvar o nome."); }
        finally { saving=false; editor.classList.remove("is-saving"); }
    };
    editor.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); editor.blur(); }
        if (event.key === "Escape") { event.preventDefault(); editor.textContent = editor.dataset.projectName || original; editor.blur(); }
    });
    editor.addEventListener("blur", save);
    editor.addEventListener("focus", () => setTimeout(selectOwnText, 0));
    editor.addEventListener("click", event => event.stopPropagation());
}

async function initMapEditor() {
    const cfg = window.WEBGIS_MAP, mapEl = document.getElementById("map");
    if (!cfg || !mapEl) return;
    if (!window.mapboxgl) return setLoading("A biblioteca do mapa não carregou. Verifique a conexão e recarregue a página.");
    if(window.proj4){
        const defs={
            "EPSG:31980":"+proj=utm +zone=20 +south +ellps=GRS80 +units=m +no_defs",
            "EPSG:31981":"+proj=utm +zone=21 +south +ellps=GRS80 +units=m +no_defs",
            "EPSG:31982":"+proj=utm +zone=22 +south +ellps=GRS80 +units=m +no_defs",
            "EPSG:31983":"+proj=utm +zone=23 +south +ellps=GRS80 +units=m +no_defs",
            "EPSG:31984":"+proj=utm +zone=24 +south +ellps=GRS80 +units=m +no_defs",
            "EPSG:32720":"+proj=utm +zone=20 +south +datum=WGS84 +units=m +no_defs",
            "EPSG:32721":"+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs",
            "EPSG:32722":"+proj=utm +zone=22 +south +datum=WGS84 +units=m +no_defs",
            "EPSG:32723":"+proj=utm +zone=23 +south +datum=WGS84 +units=m +no_defs",
            "EPSG:32724":"+proj=utm +zone=24 +south +datum=WGS84 +units=m +no_defs"
        }; Object.entries(defs).forEach(([k,v])=>{try{proj4.defs(k,v);}catch{}});
    }
    if (!cfg.token) return setLoading("Configure MAPBOX_TOKEN no .env para exibir o mapa.");
    mapboxgl.accessToken = cfg.token;
    const styles = {streets:"mapbox://styles/mapbox/streets-v12", satellite:"mapbox://styles/mapbox/satellite-streets-v12"};
    const map = new mapboxgl.Map({container:mapEl,style:styles.satellite,center:[-51.9253,-14.235],zoom:4.2,attributionControl:false,projection:"mercator",preserveDrawingBuffer:false,failIfMajorPerformanceCaveat:false,cooperativeGestures:false,touchPitch:false});
    // Desktop: botão esquerdo fica reservado à seleção/edição e o mapa é movido com o botão central.
    // Touch: usa a navegação nativa do Mapbox (arrastar, pinça e rotação).
    const touchDevice = window.matchMedia?.("(pointer: coarse)")?.matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const appRoot = document.querySelector(".editor-app");
    appRoot?.classList.toggle("touch-device", !!touchDevice);
    if (touchDevice) {
        map.dragPan.enable();
        map.scrollZoom.enable();
        map.touchZoomRotate.enable();
    } else {
        map.dragPan.disable();
    }
    window.geoCanvasMap = map;
    let geojson={type:"FeatureCollection",features:[]};
    cfg.layers=(cfg.layers||[]).map((l,i)=>typeof l === "string" ? {id:l,name:`Camada ${i+1}`,visible:true,z_index:i} : l);
    let drawings=[], geoDrawPoints=[], geoDrawCursor=null, geoCurveDraft=null, currentTool="select", editorMode="geo", drawing=null, drawingMarquee=null, selected={type:null,id:null,layerId:null}, selectedDrawingIds=[], drawingClipboard=null, undoStack=[], redoStack=[], editingFeature=null, vertexHandles=[], selectedVertex=null, basemapVisible=true, savedCamera=null, canvasViewport=null, smartGuides=[];
    let measureMode="distance", measureUnit="m", measurePoints=[], measureFinished=false;
    let dataReady=false, mapReady=false, geoReady=false, drawingsRendered=false;
    let drawingSourceWidth=0, drawingSourceHeight=0;
    // Token de renderização deve existir antes de qualquer chamada a renderDrawings().
    let drawingRenderToken=0, drawingLayersRenderToken=0;
    const maybeHideProjectLoading=()=>{ if(dataReady && geoReady && mapReady) hideLoading(); };
    const overlay=document.getElementById("drawing-overlay");

    // Estado do canvas é pequeno e libera a tela rapidamente. O GeoJSON pode ser grande,
    // então ele continua baixando em paralelo sem bloquear a primeira pintura do mapa.
    setLoading("carregando projeto...");
    const stateUrl=cfg.public ? `/api/public/${cfg.projectId}/canvas` : `/api/projects/${cfg.projectId}/canvas`;
    const geoPromise=fetch(cfg.geojsonUrl,{headers:{Accept:"application/json"},cache:"default"});
    const canvasPromise=fetch(stateUrl,{headers:{Accept:"application/json"},cache:"default"});
    try {
        const response=await canvasPromise;
        if(response.ok){
            const state=await response.json();
            drawings=Array.isArray(state.drawings)?state.drawings:[];
            basemapVisible=state.basemap_visible!==false;
            savedCamera=state.camera||null;
            canvasViewport=state.viewport||null;
        } else console.error(`[GeoDesk] Falha ao carregar desenhos: HTTP ${response.status}`);
    } catch(e){ console.error("[GeoDesk] Falha ao carregar estado do canvas:",e); }
    dataReady=true;
    syncDrawingViewport();
    if(map.loaded()) {
        addDataLayers(); map.resize(); applyBasemapVisibility();
        if(savedCamera?.center&&Number.isFinite(Number(savedCamera.zoom))){
            map.jumpTo({center:savedCamera.center,zoom:Number(savedCamera.zoom)||0,bearing:Number(savedCamera.bearing)||0,pitch:Number(savedCamera.pitch)||0});
        }
    }
    maybeHideProjectLoading();

    try {
        const response=await geoPromise;
        if(!response.ok) throw new Error(`GeoJSON HTTP ${response.status}`);
        geojson=await response.json();
        if(!geojson || geojson.type!=="FeatureCollection" || !Array.isArray(geojson.features)) throw new Error("Resposta GeoJSON inválida");
        geoReady=true;
        if(map.loaded()) { addDataLayers(); map.resize(); }
    } catch(e){ console.error("[GeoDesk] Falha ao carregar GeoJSON:",e); geoReady=true; }
    // Migração única da versão anterior, que guardava desenhos/Geo apenas no navegador.
    if(cfg.public){
        try{ const local=JSON.parse(localStorage.getItem(`geodesk-public-view-${cfg.projectId}`)||"null"); if(local){ basemapVisible=local.basemap_visible!==false; (local.geo||{}); cfg.layers.forEach(l=>{ if(Object.prototype.hasOwnProperty.call(local.geo||{},String(l.id))) l.visible=Boolean(local.geo[String(l.id)]); }); drawings.forEach(d=>{ if(Object.prototype.hasOwnProperty.call(local.drawings||{},String(d.id))) d.visible=Boolean(local.drawings[String(d.id)]); }); } }catch{}
    }
    if(!cfg.public){
        if(!drawings.length){ const legacy=loadDrawings(`geodesk-drawings-${cfg.projectId}`); if(legacy.length){ drawings=legacy; saveDrawings(); } }
        if(!cfg.layers.length){
            const legacyLayers=loadImportedLayers(cfg.projectId);
            for(const legacy of legacyLayers){
                try{ const r=await fetch(`/api/projects/${cfg.projectId}/layers/import`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:legacy.name||"Camada Geo",data:legacy.data})}); if(r.ok)cfg.layers.push(await r.json()); }catch(e){console.error(e);} }
                if(legacyLayers.length){ const fresh=await fetch(cfg.geojsonUrl).then(r=>r.json()); geojson=fresh; }
            }
        }
    dataReady=true;
    maybeHideProjectLoading();

    // Os dados podem terminar de carregar depois do evento inicial do Mapbox.
    // Reaplica o estado quando o mapa já estiver pronto, evitando camadas ativas sem renderização.
    if(map.loaded()){ mapReady=true; addDataLayers(); map.resize(); applyBasemapVisibility(); maybeHideProjectLoading(); }

    function layerPrefix(layer){ return layer.source === "import" ? `import-${layer.id}` : `geodesk-${layer.id}`; }
    function removeLayerTriplet(prefix){ [`${prefix}-fill`,`${prefix}-line`,`${prefix}-geom-line`,`${prefix}-point`].forEach(id=>{if(map.getLayer(id))map.removeLayer(id);}); }
    function removeDataLayers(){
        if(!map.isStyleLoaded()) return;
        // Nunca remova a source antes de remover TODOS os layers que a referenciam.
        const styleLayers=map.getStyle()?.layers||[];
        const sourceIds=new Set(["geodesk-data","geodesk-draw-preview"]);
        styleLayers.forEach(layer=>{
            if(sourceIds.has(layer.source) || layer.id.startsWith("geodesk-") || layer.id.startsWith("import-")){
                try{map.removeLayer(layer.id);}catch(error){console.warn("[GeoDesk] Não foi possível remover layer",layer.id,error);}
            }
        });
        sourceIds.forEach(id=>{if(map.getSource(id)){try{map.removeSource(id);}catch(error){console.warn("[GeoDesk] Source ainda ocupada",id,error);}}});
    }
    function addGeoLayer(layer,sourceId,prefix=layerPrefix(layer)){
        const visibility=layer.visible===false?"none":"visible", id=String(layer.id), filter=["==",["get","_layer_id"],id];
        removeLayerTriplet(prefix);
        const style=layer.style||{};
        const isGeoLayer=layer.layer_type==="geojson" || layer.source==="import";
        const stroke=style.stroke||"#ffffff", fill=style.fill||"#ffffff";
        const fillOpacity=Number(style.fill_opacity??0.18);
        const polygonFilter=["all",filter,["any",["==",["geometry-type"],"Polygon"],["==",["geometry-type"],"MultiPolygon"]]];
        const lineFilter=["all",filter,["any",["==",["geometry-type"],"LineString"],["==",["geometry-type"],"MultiLineString"]]];
        const pointFilter=["all",filter,["any",["==",["geometry-type"],"Point"],["==",["geometry-type"],"MultiPoint"]]];
        map.addLayer({id:`${prefix}-fill`,type:"fill",source:sourceId,filter:polygonFilter,layout:{visibility},paint:{"fill-color":["case",["boolean",["feature-state","selected"],false],"#ccefd2",["boolean",["feature-state","hover"],false],"#e2f5e5",fill],"fill-opacity":["case",["boolean",["feature-state","selected"],false],Math.min(0.5,fillOpacity+0.18),["boolean",["feature-state","hover"],false],Math.min(0.4,fillOpacity+0.08),fillOpacity]}});
        map.addLayer({id:`${prefix}-line`,type:"line",source:sourceId,filter:polygonFilter,layout:{visibility},paint:{"line-color":stroke,"line-width":["case",["boolean",["feature-state","selected"],false],3.5,["boolean",["feature-state","hover"],false],2.5,1.2]}});
        map.addLayer({id:`${prefix}-geom-line`,type:"line",source:sourceId,filter:lineFilter,layout:{visibility},paint:{"line-color":stroke,"line-width":["case",["boolean",["feature-state","selected"],false],3.5,["boolean",["feature-state","hover"],false],2.5,2]}});
        map.addLayer({id:`${prefix}-point`,type:"circle",source:sourceId,filter:pointFilter,layout:{visibility},paint:{"circle-color":fill,"circle-radius":["case",["boolean",["feature-state","selected"],false],7,["boolean",["feature-state","hover"],false],6,5],"circle-stroke-color":stroke,"circle-stroke-width":1.5}});
    }
    function addDataLayers(){
        if(!map.isStyleLoaded())return;
        removeDataLayers();
        map.addSource("geodesk-data",{type:"geojson",data:geojson});
        [...cfg.layers].sort((a,b)=>(a.z_index??0)-(b.z_index??0)).forEach(l=>addGeoLayer(l,"geodesk-data"));

        renderGeoDraw();
        renderDrawings();
        renderVertexHandles();
        if(selected.type==="geo" && selected.id) setFeatureStateSafe(selected.id,{selected:true});
    }
    function setLayerVisibility(layerId,visible,kind="geo"){
        const prefix=kind==="import"?`import-${layerId}`:`geodesk-${layerId}`;
        ["fill","line","geom-line","point"].forEach(k=>{const id=`${prefix}-${k}`;if(map.getLayer(id))map.setLayoutProperty(id,"visibility",visible?"visible":"none");});
    }

    function setupMiddleMousePan(){
        // Comportamento igual ao pan clássico: pressionar o botão do meio NÃO move o mapa.
        // O mapa só começa a acompanhar o cursor quando o usuário realmente arrasta.
        let pan=null;
        const finish=()=>{
            if(!pan)return;
            const pointerId=pan.pointerId;
            pan=null;
            mapEl.classList.remove("middle-panning");
            document.body.classList.remove("middle-panning");
            try{mapEl.releasePointerCapture?.(pointerId);}catch{}
        };
        mapEl.addEventListener("pointerdown",event=>{
            if(event.button===2){
                mapEl.classList.add("right-pressed");
                document.body.classList.add("right-pressed");
                return;
            }
            if(event.button!==1)return;
            event.preventDefault();event.stopPropagation();
            const rect=mapEl.getBoundingClientRect();
            pan={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,
                 lastX:event.clientX,lastY:event.clientY,dragging:false,
                 startCenter:map.getCenter(),startPoint:[event.clientX-rect.left,event.clientY-rect.top]};
            mapEl.setPointerCapture?.(event.pointerId);
        },true);
        mapEl.addEventListener("pointermove",event=>{
            if(!pan)return;
            const dx=event.clientX-pan.startX,dy=event.clientY-pan.startY;
            if(!pan.dragging){
                if(Math.hypot(dx,dy)<3)return;
                pan.dragging=true;
                mapEl.classList.add("middle-panning");
                document.body.classList.add("middle-panning");
            }
            event.preventDefault();
            const stepX=event.clientX-pan.lastX,stepY=event.clientY-pan.lastY;
            map.panBy([-stepX,-stepY],{duration:0,animate:false});
            pan.lastX=event.clientX;pan.lastY=event.clientY;
        },true);
        mapEl.addEventListener("pointerup",event=>{if(event.button===1)finish();if(event.button===2){mapEl.classList.remove("right-pressed");document.body.classList.remove("right-pressed");}},true);
        mapEl.addEventListener("pointercancel",()=>{finish();mapEl.classList.remove("right-pressed");document.body.classList.remove("right-pressed");},true);
        mapEl.addEventListener("auxclick",event=>{if(event.button===1)event.preventDefault();},true);
        mapEl.addEventListener("contextmenu",event=>{if(pan)event.preventDefault();mapEl.classList.remove("right-pressed");document.body.classList.remove("right-pressed");},true);
    }

    function ensureMeasureLayers(){
        if(!map.loaded())return;
        if(!map.getSource("measure-source"))map.addSource("measure-source",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
        if(!map.getLayer("measure-fill"))map.addLayer({id:"measure-fill",type:"fill",source:"measure-source",filter:["==",["geometry-type"],"Polygon"],paint:{"fill-color":"#3fae58","fill-opacity":0.12}});
        if(!map.getLayer("measure-line"))map.addLayer({id:"measure-line",type:"line",source:"measure-source",filter:["==",["geometry-type"],"LineString"],paint:{"line-color":"#2f8e45","line-width":2.5,"line-dasharray":[2,2]}});
        if(!map.getLayer("measure-points"))map.addLayer({id:"measure-points",type:"circle",source:"measure-source",filter:["==",["geometry-type"],"Point"],paint:{"circle-radius":4,"circle-color":"#ffffff","circle-stroke-color":"#2f8e45","circle-stroke-width":2}});
        if(!map.getLayer("measure-labels"))map.addLayer({id:"measure-labels",type:"symbol",source:"measure-source",filter:["==",["get","measure_label"],true],layout:{"text-field":["get","label"],"text-size":11,"text-font":["Open Sans Semibold","Arial Unicode MS Bold"],"text-anchor":"bottom","text-offset":[0,-0.7],"text-allow-overlap":true},paint:{"text-color":"#245d30","text-halo-color":"#ffffff","text-halo-width":1.5}});
    }
    function measureDistanceMeters(points){
        let total=0;
        for(let i=1;i<points.length;i++)total+=mapboxgl.LngLat.convert(points[i-1]).distanceTo(mapboxgl.LngLat.convert(points[i]));
        return total;
    }
    function measureAreaM2(points){
        if(points.length<3)return 0;
        const lon0=points.reduce((s,p)=>s+p[0],0)/points.length,lat0=points.reduce((s,p)=>s+p[1],0)/points.length;
        const R=6371008.8,rad=Math.PI/180,cosLat=Math.cos(lat0*rad);
        const xy=points.map(p=>[R*(p[0]-lon0)*rad*cosLat,R*(p[1]-lat0)*rad]);
        let area=0;
        for(let i=0;i<xy.length;i++){const a=xy[i],b=xy[(i+1)%xy.length];area+=a[0]*b[1]-b[0]*a[1];}
        return Math.abs(area)/2;
    }
    function formatMeasure(value,unit){
        if(unit==="km")return `${(value/1000).toLocaleString("pt-BR",{maximumFractionDigits:3})} km`;
        if(unit==="m2")return `${value.toLocaleString("pt-BR",{maximumFractionDigits:2})} m²`;
        if(unit==="ha")return `${(value/10000).toLocaleString("pt-BR",{maximumFractionDigits:4})} ha`;
        return `${value.toLocaleString("pt-BR",{maximumFractionDigits:2})} m`;
    }
    function updateMeasureUI(){
        const panel=document.getElementById("measure-panel"),result=document.getElementById("measure-result"),select=document.getElementById("measure-unit");
        if(!panel)return;
        panel.hidden=currentTool!=="measure";
        document.querySelectorAll("[data-measure-mode]").forEach(btn=>btn.classList.toggle("active",btn.dataset.measureMode===measureMode));
        const isArea=measureMode==="area";
        if(select){
            [...select.options].forEach(option=>option.hidden=isArea?!["m2","ha"].includes(option.value):!["m","km"].includes(option.value));
            if(isArea&&!["m2","ha"].includes(measureUnit))measureUnit="m2";
            if(!isArea&&!["m","km"].includes(measureUnit))measureUnit="m";
            select.value=measureUnit;
        }
        if(result){
            if(measurePoints.length<2)result.textContent=isArea?"Clique em 3 pontos ou mais para calcular a área.":"Clique no mapa para marcar o início da distância.";
            else if(isArea&&measurePoints.length<3)result.textContent="Mais 1 ponto para fechar a área.";
            else result.textContent=`${isArea?"Área":"Distância"}: ${formatMeasure(isArea?measureAreaM2(measurePoints):measureDistanceMeters(measurePoints),measureUnit)}`;
        }
    }
    function updateMeasureSource(){
        if(!map.loaded())return;
        ensureMeasureLayers();
        const features=measurePoints.map(coord=>({type:"Feature",geometry:{type:"Point",coordinates:coord},properties:{}}));
        const isDistance=measureMode==="distance";
        for(let i=1;i<measurePoints.length;i++){
            const a=measurePoints[i-1],b=measurePoints[i];
            const meters=mapboxgl.LngLat.convert(a).distanceTo(mapboxgl.LngLat.convert(b));
            features.push({type:"Feature",geometry:{type:"Point",coordinates:[(a[0]+b[0])/2,(a[1]+b[1])/2]},properties:{measure_label:isDistance,label:formatMeasure(meters,measureUnit)}});
        }
        if(measurePoints.length>=2)features.push({type:"Feature",geometry:{type:"LineString",coordinates:measureMode==="area"&&measurePoints.length>=3?[...measurePoints,measurePoints[0]]:measurePoints},properties:{}});
        if(measureMode==="area"&&measurePoints.length>=3)features.push({type:"Feature",geometry:{type:"Polygon",coordinates:[[...measurePoints,measurePoints[0]]]},properties:{}});
        map.getSource("measure-source")?.setData({type:"FeatureCollection",features});
        updateMeasureUI();
    }
    function clearMeasure(){
        measurePoints=[];measureFinished=false;
        if(map.getSource("measure-source"))map.getSource("measure-source").setData({type:"FeatureCollection",features:[]});
        updateMeasureUI();
    }
    function handleMeasureClick(event){
        if(measureFinished)clearMeasure();
        measurePoints.push([event.lngLat.lng,event.lngLat.lat]);
        updateMeasureSource();
    }
    function finishMeasure(){
        // O Mapbox dispara dois "click" antes do "dblclick"; remove o ponto duplicado
        // criado pelo segundo clique para que a medição não ganhe um vértice extra.
        if(measurePoints.length>=2){
            const a=measurePoints[measurePoints.length-1],b=measurePoints[measurePoints.length-2];
            if(a[0]===b[0]&&a[1]===b[1])measurePoints.pop();
        }
        updateMeasureSource();
        if((measureMode==="distance"&&measurePoints.length>=2)||(measureMode==="area"&&measurePoints.length>=3)){
            measureFinished=true;updateMeasureUI();
            showHint(measureMode==="area"?"Área calculada · clique para uma nova medição":"Distância calculada · clique para uma nova medição");
        }
    }
    function setupMeasureUI(){
        document.querySelectorAll("[data-measure-mode]").forEach(btn=>btn.addEventListener("click",event=>{
            event.preventDefault();event.stopPropagation();measureMode=btn.dataset.measureMode==="area"?"area":"distance";measureUnit=measureMode==="area"?"m2":"m";clearMeasure();
        }));
        document.getElementById("measure-unit")?.addEventListener("change",event=>{measureUnit=event.target.value;updateMeasureSource();});
        document.getElementById("measure-clear")?.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();clearMeasure();});
        document.getElementById("measure-close")?.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();setTool("select");});
        setupMeasurePanelDrag();
    }

    map.on("error",event=>{const msg=event?.error?.message||"";console.error("Mapbox error",event);if(/token|access token|unauthorized|forbidden|401|403/i.test(msg))setLoading("O Mapbox recusou o token. Verifique MAPBOX_TOKEN no .env.");});
    window.WEBGIS_MAP_INSTANCE=map;
    map.on("load",()=>{mapReady=true;syncDrawingViewport();addDataLayers();map.resize();applyBasemapVisibility();if(savedCamera?.center&&Number.isFinite(Number(savedCamera.zoom))){map.jumpTo({center:savedCamera.center,zoom:Number(savedCamera.zoom)||0,bearing:Number(savedCamera.bearing)||0,pitch:Number(savedCamera.pitch)||0});}else if(!cfg.public&&geojson.features?.length)fitToGeoJSON(map,geojson);maybeHideProjectLoading();});
    map.on("style.load",()=>{
        restoreCustomLayersAfterStyle(styleSwitchToken);
        maybeHideProjectLoading();
    });
    let hoveredFeatureId=null;
    function setFeatureStateSafe(id,state){
        if(id===undefined || id===null || !map.getSource("geodesk-data")) return;
        try{ map.setFeatureState({source:"geodesk-data",id},state); }catch{}
    }
    function clearGeoHover(){
        if(hoveredFeatureId!==null){ setFeatureStateSafe(hoveredFeatureId,{hover:false}); hoveredFeatureId=null; }
    }
    map.on("mousemove",event=>{
        if(currentTool.startsWith("geo-") && geoDrawPoints.length){
            geoDrawCursor=[event.lngLat.lng,event.lngLat.lat];
            renderGeoDraw();
        }
        if(!map.isStyleLoaded())return;
        const hits=map.queryRenderedFeatures(event.point).filter(f=>f.layer?.id?.startsWith("geodesk-")||f.layer?.id?.startsWith("import-"));
        const feature=hits[0];
        const id=feature?.id;
        if(id===undefined || id===null){ clearGeoHover(); return; }
        if(String(id)!==String(hoveredFeatureId)){ clearGeoHover(); hoveredFeatureId=id; setFeatureStateSafe(id,{hover:true}); }
    });
    map.on("zoom",()=>renderVertexHandles());
    map.on("move",()=>renderVertexHandles());
    let cameraSaveTimer=null;
    function saveCameraState(){
        if(cfg.public||!map.loaded())return;
        clearTimeout(cameraSaveTimer);
        cameraSaveTimer=setTimeout(async()=>{
            const c=map.getCenter();
            const camera={center:[c.lng,c.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};
            canvasViewport={width:mapEl.clientWidth,height:mapEl.clientHeight}; savedCamera=camera;
            try{const r=await fetch(`/api/projects/${cfg.projectId}/canvas`,{method:"PUT",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({camera,viewport:canvasViewport}),cache:"no-store"});if(!r.ok)console.error("[GeoDesk] Falha ao salvar câmera",r.status,await r.text());}
            catch(e){console.error("[GeoDesk] Erro ao salvar câmera",e);}
        },250);
    }
    map.on("moveend",saveCameraState);
    window.addEventListener("pagehide",()=>{
        if(cfg.public||!map.loaded())return;
        const c=map.getCenter(); const payload={camera:{center:[c.lng,c.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()},viewport:{width:mapEl.clientWidth,height:mapEl.clientHeight},basemap_visible:basemapVisible};
        try{fetch(`/api/projects/${cfg.projectId}/canvas`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),keepalive:true});}catch{}
    });
    map.addControl(new mapboxgl.NavigationControl({showCompass:true}),"bottom-right");
    function applyBasemapVisibility(){
        document.querySelectorAll("[data-layer-toggle-base]").forEach(btn=>{btn.textContent=basemapVisible?"◉":"○";btn.classList.toggle("is-visible",basemapVisible);btn.setAttribute("aria-pressed",String(basemapVisible));});
        if(!map.isStyleLoaded())return;
        const layers=map.getStyle()?.layers||[];
        layers.forEach(layer=>{
            if(!layer.id.startsWith("geodesk-") && !layer.id.startsWith("import-") && !layer.id.startsWith("measure-")){
                try{map.setLayoutProperty(layer.id,"visibility",basemapVisible?"visible":"none");}catch{}
            }
        });
    }
    let styleSwitchToken=0;
    async function restoreCustomLayersAfterStyle(token){
        if(token!==styleSwitchToken)return;
        for(const delay of [0,60,180,450]){
            if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
            if(token!==styleSwitchToken)return;
            if(!map.isStyleLoaded())continue;
            try{syncDrawingViewport();addDataLayers();map.resize();applyBasemapVisibility();renderDrawings();renderGeoDraw();return;}
            catch(error){console.warn("[GeoDesk] Falha ao restaurar camadas após troca de estilo",error);}
        }
    }
    document.querySelectorAll("[data-map-style]").forEach(btn=>btn.addEventListener("click",()=>{
        const nextStyle=btn.dataset.mapStyle;
        if(!styles[nextStyle])return;
        basemapVisible=true;
        const token=++styleSwitchToken;
        document.querySelectorAll("[data-map-style]").forEach(b=>b.classList.toggle("active",b===btn));
        map.setStyle(styles[nextStyle]);
        restoreCustomLayersAfterStyle(token);
    }));

    setupTools(); setupLayers(); setupGeoImport(); setupContextMenu(); updateLayerRows(); updateDrawingLayers();

    function setupTools(){
        if(cfg.public){ document.querySelectorAll("[data-tool]").forEach(btn=>{if(!["select","measure"].includes(btn.dataset.tool))btn.remove();}); document.getElementById("drawing-image-input")?.remove(); document.querySelector(".editor-mode-switcher")?.remove(); }
        document.querySelectorAll("[data-tool]").forEach(btn=>btn.addEventListener("click",()=>{const t=btn.dataset.tool;if(["rectangle","ellipse","curve-line","arrow","text","image"].includes(t))setEditorMode("drawing",false);else if(["geo-point","geo-line","geo-polygon","measure"].includes(t))setEditorMode("geo",false);setTool(t);}));
        document.querySelectorAll("[data-editor-mode]").forEach(btn=>btn.addEventListener("click",()=>setEditorMode(btn.dataset.editorMode,true)));

        setupMiddleMousePan();
        setupMeasureUI();
        setEditorMode("geo",false);
        document.addEventListener("keydown",event=>{
            if(event.target.matches("input,textarea,[contenteditable='true']"))return;
            const key=event.key.toLowerCase(), mod=event.ctrlKey||event.metaKey;
            if(key==="escape"){clearSelection();setTool("select");event.preventDefault();return;}
            if(cfg.public){
                if(!mod && key==="1"){setTool("measure");event.preventDefault();return;}
                return;
            }
            if(mod&&key==="z"){if(editorMode==="drawing"){event.preventDefault();undoDrawings();}else if(editorMode==="geo"){event.preventDefault();undoLastGeoAction();}return;}
            if(mod&&key==="y"){if(editorMode==="drawing"){event.preventDefault();redoDrawings();}return;}
            if(mod&&key==="c"){if(editorMode==="drawing"&&selectedDrawingIds.length){drawingClipboard=selectedDrawingIds.map(id=>drawings.find(d=>d.id===id)).filter(Boolean).map(d=>JSON.parse(JSON.stringify(d)));event.preventDefault();showHint(`${drawingClipboard.length} desenho(s) copiado(s)`);}return;}
            if(mod&&key==="v"){if(editorMode==="drawing"&&drawingClipboard?.length){pasteDrawings();event.preventDefault();}return;}
            const shortcuts={r:"rectangle",o:"ellipse",l:"line",a:"arrow",t:"text"};
            if(!mod&&(key==="g"||key==="d")){setEditorMode(key==="g"?"geo":"drawing",true);event.preventDefault();return;}
            const numbered=editorMode==="drawing"?{"1":"rectangle","2":"ellipse","3":"curve-line","4":"arrow","5":"text","6":"image"}:{"1":"geo-point","2":"geo-line","3":"geo-polygon","4":"measure"};
            if(!mod&&numbered[key]){const btn=document.querySelector(`[data-tool="${numbered[key]}"]`);if(btn&&!btn.disabled){setTool(numbered[key]);event.preventDefault();return;}}
            if(key==="delete"||key==="backspace"){if(editingFeature){deleteSelectedVertex();event.preventDefault();}else if(editorMode==="drawing"&&selectedDrawingIds.length){removeDrawings(selectedDrawingIds);event.preventDefault();}else if(editorMode==="geo"&&selected.type==="geo"){deleteSelectedGeo();event.preventDefault();}return;}
            if(!mod&&shortcuts[key]){const tool=shortcuts[key];setEditorMode("drawing",false);setTool(tool);}
        });
        map.on("mousedown",event=>{
            if(cfg.public || editorMode!=="geo" || currentTool!=="geo-line" || event.originalEvent.button!==0)return;
            if(!selected.layerId){showHint("Selecione uma camada Geo antes de inserir.");return;}
            const p=[event.lngLat.lng,event.lngLat.lat];
            if(!geoCurveDraft){geoCurveDraft={start:p,end:null,control:null};if(!touchDevice)map.dragPan.disable();showHint("Linha · clique no ponto final e arraste para definir a curva");event.preventDefault();return;}
            if(!geoCurveDraft.end){geoCurveDraft.end=p;geoCurveDraft.control=p;showHint("Arraste para definir a curvatura e solte");event.preventDefault();}
        });
        map.on("mousemove",event=>{
            if(!geoCurveDraft || !geoCurveDraft.end || currentTool!=="geo-line")return;
            geoCurveDraft.control=[event.lngLat.lng,event.lngLat.lat];renderGeoDraw();
        });
        map.on("mouseup",event=>{
            if(!geoCurveDraft || !geoCurveDraft.end || currentTool!=="geo-line" || event.originalEvent.button!==0)return;
            geoCurveDraft.control=[event.lngLat.lng,event.lngLat.lat];
            finishGeoCurve();event.preventDefault();
        });
        map.on("click",event=>{
            closeLayerContextMenu();
            if(currentTool==="text"){
                const p=map.project(event.lngLat);
                const d={id:`text-${Date.now()}-${Math.random().toString(16).slice(2)}`,type:"text",x:p.x,y:p.y,w:0,h:0,x2:p.x,y2:p.y,text:"Texto",name:"Texto",visible:true,fill:"#1e1e1e",stroke:"transparent",strokeWidth:0,textStrokeWidth:0,fontSize:16,fontFamily:"Inter",fontWeight:600};
                drawings.push(d); saveDrawings(); renderDrawings(); updateDrawingLayers(); selectDrawing(d); editDrawingText(d); setTool("select");
                return;
            }
            if(currentTool.startsWith("geo-")){
                if(!selected.layerId){showHint("Selecione uma camada Geo antes de inserir.");return;}
                const type=geoToolGeometryType(currentTool);
                if(type==="Point"){createGeoPoint([event.lngLat.lng,event.lngLat.lat]);return;}
                if(currentTool==="geo-line")return;
                geoDrawPoints.push([event.lngLat.lng,event.lngLat.lat]);renderGeoDraw();showHint(`${geoDrawPoints.length} pontos · duplo clique para finalizar`);return;
            }
            if(currentTool==="measure"){handleMeasureClick(event);return;}
            if(currentTool!=="select"||editorMode!=="geo")return;
            if(cfg.public){clearSelection();return;}
            const hits=map.queryRenderedFeatures(event.point).filter(f=>f.layer?.id?.startsWith("geodesk-")||f.layer?.id?.startsWith("import-"));
            if(hits.length){selectGeoFeature(hits[0]);return;}
            clearSelection();
        });
        map.on("dblclick",event=>{
            if(cfg.public)return;
            if(currentTool.startsWith("geo-")){
                event.preventDefault();
                const type=geoToolGeometryType(currentTool);
                if(type==="LineString"){
                    if(geoCurveDraft?.start&&geoCurveDraft?.end)finishGeoCurve();
                    else if(geoDrawPoints.length>=2)finishGeoFeature("LineString");
                } else if(type==="Polygon"&&geoDrawPoints.length>=3)finishGeoFeature("Polygon");
                return;
            }
            if(currentTool==="measure"){event.preventDefault();finishMeasure();return;}
            if(currentTool!=="select"||editorMode!=="geo")return;
            const hits=map.queryRenderedFeatures(event.point).filter(f=>f.layer?.id?.startsWith("geodesk-")||f.layer?.id?.startsWith("import-"));
            if(hits.length){event.preventDefault();beginGeoVertexEdit(hits[0]);}
        });
        map.on("contextmenu",event=>{
            if(editorMode!=="geo")return;
            if(currentTool.startsWith("geo-")){
                event.preventDefault();
                const type=geoToolGeometryType(currentTool);
                if(type==="LineString"&&currentTool==="geo-line"){
                    if(geoCurveDraft?.start&&geoCurveDraft?.end){finishGeoCurve();return;}
                    if(geoDrawPoints.length>=2){finishGeoFeature("LineString");return;}
                }
                if(type==="Polygon"&&geoDrawPoints.length>=3){finishGeoFeature("Polygon");return;}
                return;
            }
            if(cfg.public)return;
            const hits=map.queryRenderedFeatures(event.point).filter(f=>f.layer?.id?.startsWith("geodesk-")||f.layer?.id?.startsWith("import-"));
            if(!hits.length)return;
            event.preventDefault();
            openGeoFeatureContextMenu(event.point.x+mapEl.getBoundingClientRect().left,event.point.y+mapEl.getBoundingClientRect().top,hits[0]);
        });
        if(overlay){
            overlay.addEventListener("pointerdown",onDrawingPointerDown);overlay.addEventListener("pointermove",onDrawingPointerMove);overlay.addEventListener("pointerup",onDrawingPointerUp);
            overlay.addEventListener("contextmenu",e=>{if(editorMode!=="drawing")return;const el=e.target.closest?.("[data-drawing-id]");const d=el&&drawings.find(x=>x.id===el.dataset.drawingId);if(!d)return;e.preventDefault();e.stopPropagation();selectDrawing(d);openDrawingContextMenu(e.clientX,e.clientY,d);},true);
            overlay.addEventListener("dblclick",e=>{const el=e.target.closest?.("[data-drawing-id]");if(!el)return;const d=drawings.find(x=>x.id===el.dataset.drawingId);if(d?.type==="text"){e.preventDefault();e.stopPropagation();selectedDrawingIds=[d.id];selected={type:"drawing",id:d.id,layerId:null};updateDrawingLayerActiveRows();editDrawingText(d);}});
        }
    }
    function setEditorMode(mode,resetTool=true){
        if(cfg.public)return;
        editorMode=mode==="drawing"?"drawing":"geo";
        const app=document.querySelector(".editor-app");app?.classList.toggle("mode-drawing",editorMode==="drawing");app?.classList.toggle("mode-geo",editorMode==="geo");
        document.querySelectorAll("[data-editor-mode]").forEach(btn=>{const active=btn.dataset.editorMode===editorMode;btn.classList.toggle("active",active);btn.setAttribute("aria-selected",String(active));});
        if(resetTool){clearSelection();setTool("select");}else updateToolVisibility();
        if(touchDevice) map.dragPan.enable();
        else if(editorMode==="geo" && currentTool==="select") map.dragPan.disable();
        renderDrawings();
    }
    function updateToolVisibility(){
        document.querySelectorAll("[data-tool]").forEach(btn=>{const t=btn.dataset.tool;const visible=t==="select"||(editorMode==="geo"&&["geo-point","geo-line","geo-polygon","measure"].includes(t))||(editorMode==="drawing"&&["rectangle","ellipse","curve-line","arrow","text","image"].includes(t));btn.style.display=visible?"":"none";});
        const gg=document.querySelector(".geo-tool-buttons")?.closest(".tool-group"),dg=document.querySelector(".drawing-tool-buttons")?.closest(".tool-group");if(gg)gg.style.display=editorMode==="geo"?"":"none";if(dg)dg.style.display=editorMode==="drawing"?"":"none";
        const dividers=[...document.querySelectorAll(".editor-toolbar>.tool-divider")];dividers.forEach((d,i)=>{d.style.display=(editorMode==="geo"?(i===0||i===1||i===2) :(i===0))?"":"none";});
    }
    function setTool(tool){
        // Em projetos publicados somente a Régua fica disponível.
        if(cfg.public && !["measure","select"].includes(tool))return;
        if(["rectangle","ellipse","curve-line","arrow","text","image"].includes(tool))editorMode="drawing";
        if(["geo-point","geo-line","geo-polygon","measure"].includes(tool))editorMode="geo";
        currentTool=tool; if(tool!=="select")endVertexEdit();
        document.querySelectorAll("[data-editor-mode]").forEach(btn=>{const active=btn.dataset.editorMode===editorMode;btn.classList.toggle("active",active);btn.setAttribute("aria-selected",String(active));});
        if(tool.startsWith("geo-")||tool==="measure")map.doubleClickZoom.disable();else map.doubleClickZoom.enable();
        if(tool.startsWith("geo-")){geoDrawPoints=[];geoDrawCursor=null;geoCurveDraft=null;if(touchDevice||tool!=="geo-line")map.dragPan.enable();else map.dragPan.disable();}
        if(tool!=="measure" && measurePoints.length)clearMeasure();
        document.querySelectorAll("[data-tool]").forEach(btn=>btn.classList.toggle("active",btn.dataset.tool===tool));
        if(overlay){overlay.classList.toggle("is-drawing",!["select","text","image","measure"].includes(tool) && !tool.startsWith("geo-"));overlay.classList.toggle("selection-mode",editorMode==="drawing"&&tool==="select");}
        mapEl.querySelector(".mapboxgl-canvas-container")?.classList.toggle("selection-cursor",tool==="select");
        updateToolVisibility();
        updateMeasureUI();
        if(tool==="select")showHint(editorMode==="drawing"?"Desenho · arraste para criar uma caixa e selecionar vários objetos":"Geo · clique em uma feição para selecionar · botão central + arraste para mover o mapa");
        else if(tool==="measure")showHint(measureMode==="area"?"Régua · clique para marcar a área":"Régua · clique para marcar a distância");
        else if(tool.startsWith("geo-")){
            const type=geoToolGeometryType(tool);
            if(!selected.layerId){showHint("Selecione uma camada Geo antes de inserir.");setTool("select");return;}
            const layerType=getSelectedGeoGeometryType();
            if(layerType!=="mixed"&&layerType!==type){showHint(`Esta camada é de ${layerType==="LineString"?"linha":layerType==="Point"?"ponto":"polígono"}. Selecione outra camada.`);setTool("select");return;}
            showHint(`Geo · clique para criar ${type==="LineString"?"uma linha":type==="Point"?"um ponto":"um polígono"}`);
        }
        else if(tool==="text")showHint("Clique no mapa para inserir texto");
        else if(tool==="image"){document.getElementById("drawing-image-input")?.click();}
        else showHint(`Desenho · ${toolLabel(tool)} · arraste para criar`);
    }
    function geoToolGeometryType(tool){
        return ({"geo-point":"Point","geo-line":"LineString","geo-polygon":"Polygon"})[tool] || null;
    }
    function getSelectedGeoGeometryType(){
        if(!selected.layerId)return null;
        const layer=cfg.layers.find(l=>String(l.id)===String(selected.layerId));
        return layer?.geometry_type||layer?.style?.geometry_type||"mixed";
    }
    function createGeoPoint(coord){
        if(!selected.layerId)return;
        const layerId=selected.layerId;
        const data={type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"Point",coordinates:coord}}]};
        persistNewGeoFeature(layerId,data);
    }
    async function finishGeoFeature(type){
        if(cfg.public||!selected.layerId)return;
        const coords=[...geoDrawPoints]; if((type==="Polygon"&&coords.length<3)||(type==="LineString"&&coords.length<2))return;
        const coordinates=type==="Polygon" ? [[...coords,coords[0]]] : coords;
        const layerId=selected.layerId;
        const feature={type:"Feature",properties:{},geometry:{type,coordinates}};
        try{
            const response=await fetch(`/api/projects/${cfg.projectId}/layers/${layerId}/features`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(feature)});
            if(!response.ok)throw new Error();
            const createdResponse=await response.json();
            const created=createdResponse.feature;
            if(created){geojson.features.push(created);trackGeoAction(created.id);}
            geoDrawPoints=[]; geoDrawCursor=null; renderGeoDraw(); addDataLayers();
            if(created)selectGeoFeature(created);
            showHint(`${type==="LineString"?"Linha":"Polígono"} geográfico criado`);
        }catch(error){console.error("[GeoDesk] Falha ao criar geometria",{type,layerId,error});showHint(`Não foi possível salvar a geometria: ${error.message||"erro"}`);}
    }
    async function persistNewGeoFeature(layerId,data){
        try{
            const feature=data.features[0];
            const response=await fetch(`/api/projects/${cfg.projectId}/layers/${layerId}/features`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(feature)});
            if(!response.ok)throw new Error();
            const createdResponse=await response.json();
            const created=createdResponse.feature;
            if(created){geojson.features.push(created);trackGeoAction(created.id);}
            addDataLayers();
            if(created)selectGeoFeature(created);
            showHint("Ponto geográfico criado");
        }catch(error){console.error("[GeoDesk] Falha ao criar ponto",{layerId,error});showHint(`Não foi possível salvar o ponto: ${error.message||"erro"}`);}
    }
    async function finishGeoCurve(){
        const d=geoCurveDraft;if(!d?.start||!d?.end)return;
        const [x0,y0]=d.start,[x1,y1]=d.end,[cx,cy]=d.control||d.end;
        const coords=[];for(let i=0;i<=24;i++){const t=i/24,u=1-t;coords.push([u*u*x0+2*u*t*cx+t*t*x1,u*u*y0+2*u*t*cy+t*t*y1]);}
        const layerId=selected.layerId;
        try{
            const feature={type:"Feature",properties:{},geometry:{type:"LineString",coordinates:coords}};
            const response=await fetch(`/api/projects/${cfg.projectId}/layers/${layerId}/features`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(feature)});
            if(!response.ok)throw new Error();const data=await response.json();if(data.feature){geojson.features.push(data.feature);trackGeoAction(data.feature.id);}
            geoCurveDraft=null;if(!touchDevice)map.dragPan.disable();addDataLayers();renderGeoDraw();if(data.feature)selectGeoFeature(data.feature);showHint("Linha geográfica criada · clique para criar outra");
        }catch(error){console.error("[GeoDesk] Falha ao criar linha curva",error);showHint("Não foi possível salvar a linha curva.");}
    }

    function renderGeoDraw(){
        if(!map.loaded())return;
        const sourceId="geodesk-draw-preview";
        if(!map.getSource(sourceId))map.addSource(sourceId,{type:"geojson",data:{type:"FeatureCollection",features:[]}});
        const type=geoToolGeometryType(currentTool);
        const features=[];
        if(geoCurveDraft?.start){
            const d=geoCurveDraft;if(d.end){const [x0,y0]=d.start,[x1,y1]=d.end,[cx,cy]=(d.control||d.end);const coords=[];for(let i=0;i<=24;i++){const t=i/24,u=1-t;coords.push([u*u*x0+2*u*t*cx+t*t*x1,u*u*y0+2*u*t*cy+t*t*y1]);}features.push({type:"Feature",geometry:{type:"LineString",coordinates:coords},properties:{}});}else features.push({type:"Feature",geometry:{type:"LineString",coordinates:[d.start]},properties:{}});
        }
        if(geoDrawPoints.length){
            const preview=[...geoDrawPoints];
            if(geoDrawCursor) preview.push(geoDrawCursor);
            if(type==="Polygon" && preview.length>1)features.push({type:"Feature",geometry:{type:"LineString",coordinates:preview},properties:{}});
            else if(type==="LineString")features.push({type:"Feature",geometry:{type:"LineString",coordinates:preview},properties:{}});
            if(type==="Polygon" && geoDrawPoints.length>2)features.push({type:"Feature",geometry:{type:"Polygon",coordinates:[[...geoDrawPoints,geoDrawPoints[0]]]},properties:{}});
        }
        // Mostra os vértices já criados no mapa para dar feedback visual durante a edição.
        const vertexCoords=[];
        if(geoDrawPoints.length) vertexCoords.push(...geoDrawPoints);
        if(geoCurveDraft?.start) { vertexCoords.push(geoCurveDraft.start); if(geoCurveDraft.end) vertexCoords.push(geoCurveDraft.end); if(geoCurveDraft.control) vertexCoords.push(geoCurveDraft.control); }
        if(vertexCoords.length) vertexCoords.forEach((coord,i)=>features.push({type:"Feature",geometry:{type:"Point",coordinates:coord},properties:{vertex_index:i+1}}));
        map.getSource(sourceId).setData({type:"FeatureCollection",features});
        if(!map.getLayer("geodesk-draw-preview-fill"))map.addLayer({id:"geodesk-draw-preview-fill",type:"fill",source:sourceId,filter:["==",["geometry-type"],"Polygon"],paint:{"fill-color":"#ffffff","fill-opacity":.12}});
        if(!map.getLayer("geodesk-draw-preview-line"))map.addLayer({id:"geodesk-draw-preview-line",type:"line",source:sourceId,paint:{"line-color":"#ffffff","line-width":2,"line-dasharray":[2,2]}});
        if(!map.getLayer("geodesk-draw-preview-vertices"))map.addLayer({id:"geodesk-draw-preview-vertices",type:"circle",source:sourceId,filter:["==",["geometry-type"],"Point"],paint:{"circle-radius":5,"circle-color":"#ffffff","circle-stroke-color":"#2f8e45","circle-stroke-width":2}});
    }

    function drawingBounds(d){
        let b;
        if(d.type==="line"||d.type==="arrow"){
            const pts=[[d.x,d.y],[d.x2,d.y2]];if(d.curve)pts.push([Number(d.cx),Number(d.cy)]);const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);b={x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
        }
        else if(d.type==="text"){const fs=Number(d.fontSize)||16;b={x:d.x,y:d.y-fs,w:Math.max(18,String(d.text||"Texto").length*fs*.62),h:fs*1.25};}
        else b={x:d.x,y:d.y,w:Math.max(1,d.w||0),h:Math.max(1,d.h||0)};
        const angle=((Number(d.rotation)||0)%360)*Math.PI/180;
        if(!angle)return b;
        const cx=b.x+b.w/2,cy=b.y+b.h/2,c=Math.abs(Math.cos(angle)),si=Math.abs(Math.sin(angle));
        const w=b.w*c+b.h*si,h=b.w*si+b.h*c;
        return {x:cx-w/2,y:cy-h/2,w,h};
    }
    function drawingCenter(d){const b=drawingBounds({...d,rotation:0});return{x:b.x+b.w/2,y:b.y+b.h/2};}
    function rotatePoint(point,center,angleDeg){const a=angleDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a),dx=point.x-center.x,dy=point.y-center.y;return{x:center.x+dx*c-dy*s,y:center.y+dx*s+dy*c};}
    function boundsIntersect(a,b){return a.x<=b.x+b.w&&a.x+a.w>=b.x&&a.y<=b.y+b.h&&a.y+a.h>=b.y;}
    function onDrawingPointerDown(event){
        if(cfg.public||editorMode!=="drawing")return;
        if(currentTool!=="select"){
            if(["image","text"].includes(currentTool))return;
            const p=pointerPosition(event,overlay);
            if(currentTool==="curve-line" && drawing?.phase==="end"){
                drawing.control=p; drawing.phase="curve"; overlay.setPointerCapture?.(event.pointerId); renderDrawings(); return;
            }
            drawing={tool:currentTool,start:p,current:p,phase:(currentTool==="curve-line")?"end":"draw"};
            overlay.setPointerCapture?.(event.pointerId);renderDrawings();return;
        }
        if(event.target.closest?.("[data-drawing-id], .drawing-handle, .drawing-group-box"))return;
        const p=pointerPosition(event,overlay);drawingMarquee={pointerId:event.pointerId,start:p,current:p,add:event.shiftKey||event.ctrlKey||event.metaKey};
        overlay.setPointerCapture?.(event.pointerId);
        if(!drawingMarquee.add)selectedDrawingIds=[];
        selected={type:selectedDrawingIds.length?"drawing":null,id:selectedDrawingIds[0]||null,layerId:null};
        renderDrawings();
    }
    function onDrawingPointerMove(event){if(drawing){drawing.current=pointerPosition(event,overlay);if(drawing.tool==="curve-line"&&drawing.phase==="curve")drawing.control=drawing.current;renderDrawings();return;}if(!drawingMarquee)return;drawingMarquee.current=pointerPosition(event,overlay);renderDrawings();}
    function onDrawingPointerUp(event){
        if(drawing){
            drawing.current=pointerPosition(event,overlay);
            
            if(drawing.tool==="curve-line" && drawing.phase==="end"){return;}
            const created=makeDrawing(drawing);drawing=null;if(created){recordDrawingUndo();drawings.push(created);saveDrawings();updateDrawingLayers();selectDrawing(created);setTool("select");}renderDrawings();return;
        }
        if(!drawingMarquee)return;
        drawingMarquee.current=pointerPosition(event,overlay);const a=drawingMarquee.start,b=drawingMarquee.current,box={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)};
        if(box.w<4&&box.h<4){drawingMarquee=null;renderDrawings();return;}
        const hits=drawings.filter(d=>d.visible!==false&&boundsIntersect(drawingBounds(d),box)).map(d=>d.id);
        selectedDrawingIds=drawingMarquee.add?[...new Set([...selectedDrawingIds,...hits])]:hits;selected=selectedDrawingIds.length?{type:"drawing",id:selectedDrawingIds[0],layerId:null}:{type:null,id:null,layerId:null};drawingMarquee=null;renderDrawings();renderDrawingStylePanel();updateDrawingLayerActiveRows();
    }
    function renderDrawingMarquee(){
        if(!drawingMarquee||!overlay)return;const ns="http://www.w3.org/2000/svg",a=drawingMarquee.start,b=drawingMarquee.current,r=document.createElementNS(ns,"rect");r.classList.add("selection-marquee");r.setAttribute("x",Math.min(a.x,b.x));r.setAttribute("y",Math.min(a.y,b.y));r.setAttribute("width",Math.abs(b.x-a.x));r.setAttribute("height",Math.abs(b.y-a.y));overlay.appendChild(r);
    }
    function makeDrawing(state){
        const{x:x1,y:y1}=state.start,{x:x2,y:y2}=state.current,w=Math.abs(x2-x1),h=Math.abs(y2-y1);
        if(w<5&&h<5)return null;
        const storedType=state.tool==="curve-line"?"line":state.tool;
        const base={id:`drawing-${Date.now()}-${Math.random().toString(16).slice(2)}`,type:storedType,x:x1,y:y1,w,h,x2,y2,text:"Texto",visible:true,fill:storedType==="line"||storedType==="arrow"?"none":"#ffffff",stroke:"#2f8e45",strokeWidth:2,hasStroke:true,radius:storedType==="rectangle"?0:undefined,fontSize:16,fontFamily:"Inter",fontWeight:600};
        if((state.tool==="curve-line"||state.tool==="line") && state.control){base.curve=true;base.cx=state.control.x;base.cy=state.control.y;}
        return base;
    }
    function renderDrawings(){
        if(!overlay)return;
        const token=++drawingRenderToken;
        overlay.innerHTML="";
        const visible=drawings.filter(d=>d.visible!==false);
        const loading=document.getElementById("drawing-loading");
        const isInitialRender=!drawingsRendered;
        if(isInitialRender){
            drawingsRendered=false;
            if(loading){loading.hidden=false; const text=loading.querySelector(".drawing-loading-text"); if(text)text.textContent=visible.length?`Carregando desenhos... ${visible.length}`:"Preparando desenhos...";}
        }
        // Lotes maiores reduzem drasticamente o tempo total: o canvas continua responsivo,
        // mas não esperamos um requestAnimationFrame para cada pequeno grupo de objetos.
        const batchSize=240; let index=0;
        const paintBatch=()=>{
            if(token!==drawingRenderToken)return;
            const fragment=document.createDocumentFragment();
            for(let end=Math.min(index+batchSize,visible.length);index<end;index++){const el=svgElement(visible[index]);if(el)fragment.appendChild(el);}
            overlay.appendChild(fragment);
            if(index<visible.length){
                requestAnimationFrame(paintBatch);
            }else{
                if(drawing){const draft=makeDrawing(drawing);const el=draft&&svgElement(draft);if(el){el.classList.add("draft-object");overlay.appendChild(el);}}
                renderSmartGuides(); renderDrawingHandles(); renderDrawingMarquee();
                drawingsRendered=true;
                if(loading)loading.hidden=true;
                maybeHideProjectLoading();
            }
        };
        if(!visible.length){
            drawingsRendered=true;
            if(loading)loading.hidden=true;
            maybeHideProjectLoading();
            return;
        }
        requestAnimationFrame(paintBatch);
    }
    function renderDrawingHandles(){
        if(cfg.public || !overlay || editorMode!=="drawing" || !selectedDrawingIds.length) return;
        const selectedObjects=selectedDrawingIds.map(id=>drawings.find(x=>x.id===id)).filter(d=>d&&d.visible!==false);
        if(!selectedObjects.length)return;
        if(selectedObjects.length>1){const boxes=selectedObjects.map(drawingBounds),minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.w)),maxY=Math.max(...boxes.map(b=>b.y+b.h));const ns="http://www.w3.org/2000/svg",r=document.createElementNS(ns,"rect");r.setAttribute("x",minX);r.setAttribute("y",minY);r.setAttribute("width",maxX-minX);r.setAttribute("height",maxY-minY);r.classList.add("drawing-group-box");r.addEventListener("pointerdown",e=>{if(e.button!==0)return;startDrawingTransform(e,selectedObjects[0],"move");});overlay.appendChild(r);const rot=document.createElementNS(ns,"circle");rot.setAttribute("cx",(minX+maxX)/2);rot.setAttribute("cy",minY-24);rot.setAttribute("r",6);rot.classList.add("drawing-rotate-handle");rot.dataset.handle="rotate";rot.addEventListener("pointerdown",e=>startDrawingTransform(e,selectedObjects[0],"rotate"));overlay.appendChild(rot);return;}
        const d=selectedObjects[0];
        const ns="http://www.w3.org/2000/svg";
        const handles=[];
        if(["rectangle","ellipse","image"].includes(d.type)){
            const x=d.x,y=d.y,w=d.w,h=d.h;
            [[x,y,"nw"],[x+w/2,y,"n"],[x+w,y,"ne"],[x+w,y+h/2,"e"],[x+w,y+h,"se"],[x+w/2,y+h,"s"],[x,y+h,"sw"],[x,y+h/2,"w"]].forEach(([hx,hy,mode])=>handles.push([hx,hy,mode]));
        } else if(d.type==="line"||d.type==="arrow"){ handles.push([d.x,d.y,"start"],[d.x2,d.y2,"end"]); }
        else if(d.type==="text"){ handles.push([d.x,d.y,"move"]); }
        const box=drawingBounds(d),rot=document.createElementNS(ns,"circle");rot.setAttribute("cx",box.x+box.w/2);rot.setAttribute("cy",box.y-24);rot.setAttribute("r",6);rot.classList.add("drawing-rotate-handle");rot.dataset.handle="rotate";rot.addEventListener("pointerdown",e=>startDrawingTransform(e,d,"rotate"));overlay.appendChild(rot);
        handles.forEach(([x,y,mode])=>{const h=document.createElementNS(ns,"rect");h.setAttribute("x",x-5);h.setAttribute("y",y-5);h.setAttribute("width",10);h.setAttribute("height",10);h.setAttribute("rx",2);h.classList.add("drawing-handle");h.dataset.handle=mode;h.addEventListener("pointerdown",e=>startDrawingTransform(e,d,mode));overlay.appendChild(h);});
    }
    let drawingTransform=null;
    function startDrawingTransform(e,d,mode){
        if(cfg.public||editorMode!=="drawing")return;e.preventDefault();e.stopPropagation();
        if(!selectedDrawingIds.includes(d.id))selectedDrawingIds=e.shiftKey||e.ctrlKey||e.metaKey?[...selectedDrawingIds,d.id]:[d.id];
        if(mode!=="rotate" && (e.shiftKey||e.ctrlKey||e.metaKey)){selected={type:selectedDrawingIds.length?"drawing":null,id:selectedDrawingIds[0]||null,layerId:null};renderDrawings();renderDrawingStylePanel();return;}
        recordDrawingUndo();const p=pointerPosition(e,overlay);drawingTransform={ids:[...selectedDrawingIds],mode,start:p,original:Object.fromEntries(selectedDrawingIds.map(id=>{const item=drawings.find(x=>x.id===id);return[id,item?{...item}:null]}))};
        window.addEventListener("pointermove",onDrawingTransformMove);window.addEventListener("pointerup",endDrawingTransform,{once:true});
    }
    function snapValue(value,candidates,tolerance=7){
        let best=value,diffBest=tolerance+0.001,candidate=null;
        candidates.forEach(c=>{const diff=Math.abs(value-c);if(diff<diffBest){best=c;diffBest=diff;candidate=c;}});
        return {value:best,snapped:candidate!==null,candidate};
    }
    function getSmartSnapForSelection(ids,dx,dy){
        const selectedSet=new Set(ids),moving=ids.map(id=>drawings.find(d=>d.id===id)).filter(Boolean);if(!moving.length)return{dx,dy,guides:[]};
        const boxes=moving.map(drawingBounds),minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.w)),maxY=Math.max(...boxes.map(b=>b.y+b.h)),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
        const others=drawings.filter(d=>d.visible!==false&&!selectedSet.has(d.id)).map(drawingBounds);
        const xs=[...others.flatMap(b=>[b.x,b.x+b.w,b.x+b.w/2])],ys=[...others.flatMap(b=>[b.y,b.y+b.h,b.y+b.h/2])];
        const sx=snapValue(cx+dx,xs),sy=snapValue(cy+dy,ys);let outDx=dx,outDy=dy,guides=[];
        if(sx.snapped){outDx=sx.value-cx;guides.push({axis:"x",value:sx.candidate});}
        if(sy.snapped){outDy=sy.value-cy;guides.push({axis:"y",value:sy.candidate});}
        return{dx:outDx,dy:outDy,guides};
    }
    function renderSmartGuides(){
        if(!overlay||!smartGuides.length)return;const ns="http://www.w3.org/2000/svg";
        smartGuides.forEach(g=>{const line=document.createElementNS(ns,"line");if(g.axis==="x"){line.setAttribute("x1",g.value);line.setAttribute("x2",g.value);line.setAttribute("y1",0);line.setAttribute("y2",drawingSourceHeight||overlay.clientHeight);}else{line.setAttribute("x1",0);line.setAttribute("x2",drawingSourceWidth||overlay.clientWidth);line.setAttribute("y1",g.value);line.setAttribute("y2",g.value);}line.classList.add("smart-guide");overlay.appendChild(line);});
    }
    function onDrawingTransformMove(e){
        if(!drawingTransform)return;const p=pointerPosition(e,overlay),rawDx=p.x-drawingTransform.start.x,rawDy=p.y-drawingTransform.start.y;let dx=rawDx,dy=rawDy;smartGuides=[];
        const isMove=drawingTransform.mode==="move";
        if(isMove){
            if(e.shiftKey){if(Math.abs(rawDx)>=Math.abs(rawDy))dy=0;else dx=0;}
            const snap=getSmartSnapForSelection(drawingTransform.ids,dx,dy);dx=snap.dx;dy=snap.dy;smartGuides=snap.guides;
            if(e.shiftKey){if(Math.abs(rawDx)>=Math.abs(rawDy))dy=0;else dx=0;}
        }
        if(drawingTransform.mode==="rotate"){
            const ids=drawingTransform.ids,items=ids.map(id=>drawings.find(x=>x.id===id)).filter(Boolean),boxes=items.map(d=>drawingBounds({...d,rotation:0}));
            const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y)),maxX=Math.max(...boxes.map(b=>b.x+b.w)),maxY=Math.max(...boxes.map(b=>b.y+b.h)),center={x:(minX+maxX)/2,y:(minY+maxY)/2};
            const a0=Math.atan2(drawingTransform.start.y-center.y,drawingTransform.start.x-center.x)*180/Math.PI,a1=Math.atan2(p.y-center.y,p.x-center.x)*180/Math.PI;let delta=a1-a0;
            if(e.shiftKey)delta=Math.round(delta/15)*15;const normalized=((delta+180)%360+360)%360-180;
            ids.forEach(id=>{const d=drawings.find(x=>x.id===id),o=drawingTransform.original[id];if(!d||!o)return;const oc=drawingCenter(o),nc=rotatePoint(oc,center,normalized),ox=nc.x-oc.x,oy=nc.y-oc.y;
                if(o.type==="line"||o.type==="arrow"){d.x=o.x+ox;d.y=o.y+oy;d.x2=o.x2+ox;d.y2=o.y2+oy;}else{d.x=o.x+ox;d.y=o.y+oy;}d.rotation=(Number(o.rotation)||0)+normalized;});
            renderDrawings();return;
        }
        drawingTransform.ids.forEach(id=>{const d=drawings.find(x=>x.id===id),o=drawingTransform.original[id];if(!d||!o)return;if(drawingTransform.mode==="move"||d.type==="text"){d.x=o.x+dx;d.y=o.y+dy;if("x2" in o)d.x2=o.x2+dx;if("y2" in o)d.y2=o.y2+dy;if(o.curve){d.curve=true;d.cx=o.cx+dx;d.cy=o.cy+dy;}}else if(d.type==="line"||d.type==="arrow"){if(drawingTransform.mode==="start"){d.x=o.x+dx;d.y=o.y+dy;}else{d.x2=o.x2+dx;d.y2=o.y2+dy;}}else{let left=o.x,top=o.y,right=o.x+o.w,bottom=o.y+o.h;const m=drawingTransform.mode;if(m.includes("w"))left=o.x+dx;if(m.includes("e"))right=o.x+o.w+dx;if(m.includes("n"))top=o.y+dy;if(m.includes("s"))bottom=o.y+o.h+dy;if(right-left<8){if(m.includes("w"))left=right-8;else right=left+8;}if(bottom-top<8){if(m.includes("n"))top=bottom-8;else bottom=top+8;}if(drawingTransform.ids.length===1){const others=drawings.filter(x=>x.visible!==false&&x.id!==d.id).map(x=>drawingBounds(x));if(m.includes("e")||m.includes("w")){const target=others.map(b=>b.w).find(v=>Math.abs(v-(right-left))<=7);if(target!==undefined){if(m.includes("w"))left=right-target;else right=left+target;smartGuides.push({axis:"x",value:left},{axis:"x",value:right});}}if(m.includes("n")||m.includes("s")){const target=others.map(b=>b.h).find(v=>Math.abs(v-(bottom-top))<=7);if(target!==undefined){if(m.includes("n"))top=bottom-target;else bottom=top+target;smartGuides.push({axis:"y",value:top},{axis:"y",value:bottom});}}}d.x=left;d.y=top;d.w=right-left;d.h=bottom-top;}});renderDrawings();
    }
    function endDrawingTransform(){if(!drawingTransform)return;drawingTransform=null;smartGuides=[];window.removeEventListener("pointermove",onDrawingTransformMove);saveDrawings();renderDrawings();}
    function svgElement(d){
        const ns="http://www.w3.org/2000/svg";let el;
        if(d.type==="rectangle"){el=document.createElementNS(ns,"rect");el.setAttribute("x",d.x);el.setAttribute("y",d.y);el.setAttribute("width",d.w);el.setAttribute("height",d.h);const radius=Math.max(0,Math.min(100,Number(d.radius)||0));el.setAttribute("rx",Math.min(radius,Math.min(Math.abs(d.w),Math.abs(d.h))/2));el.setAttribute("ry",Math.min(radius,Math.min(Math.abs(d.w),Math.abs(d.h))/2));}
        else if(d.type==="ellipse"){el=document.createElementNS(ns,"ellipse");el.setAttribute("cx",d.x+d.w/2);el.setAttribute("cy",d.y+d.h/2);el.setAttribute("rx",Math.max(1,d.w/2));el.setAttribute("ry",Math.max(1,d.h/2));}
        else if(d.type==="line"||d.type==="arrow"){
            if(d.curve){el=document.createElementNS(ns,"path");const cx=Number(d.cx ?? ((d.x+d.x2)/2)),cy=Number(d.cy ?? ((d.y+d.y2)/2));el.setAttribute("d",`M ${d.x} ${d.y} Q ${cx} ${cy} ${d.x2} ${d.y2}`);}
            else {el=document.createElementNS(ns,"line");el.setAttribute("x1",d.x);el.setAttribute("y1",d.y);el.setAttribute("x2",d.x2);el.setAttribute("y2",d.y2);}
            if(d.type==="arrow")el.setAttribute("marker-end","url(#arrowhead)");}
        else if(d.type==="text"){
            el=document.createElementNS(ns,"text");el.setAttribute("x",d.x);el.setAttribute("y",d.y);el.textContent=d.text||"Texto";
            el.setAttribute("font-size",Number(d.fontSize)||16); el.setAttribute("font-family",d.fontFamily||"Inter"); el.setAttribute("font-weight",d.fontWeight||600);
            el.setAttribute("paint-order","stroke");
            el.style.setProperty("font-size",`${Number(d.fontSize)||16}px`,"important");
            el.style.setProperty("font-family",d.fontFamily||"Inter","important");
            el.style.setProperty("font-weight",String(d.fontWeight||600),"important");
        }
        else if(d.type==="image"){el=document.createElementNS(ns,"image");el.setAttribute("href",d.src||"");el.setAttribute("x",d.x);el.setAttribute("y",d.y);el.setAttribute("width",d.w);el.setAttribute("height",d.h);el.setAttribute("preserveAspectRatio","xMidYMid slice");}
        else return null;
        el.dataset.drawingId=d.id||"draft";el.classList.toggle("is-selected",selectedDrawingIds.includes(d.id));el.addEventListener("pointerdown",e=>{
            if(cfg.public||editorMode!=="drawing"||currentTool!=="select"||!d.id)return;e.preventDefault();e.stopPropagation();
            if(e.shiftKey||e.ctrlKey||e.metaKey){if(selectedDrawingIds.includes(d.id))selectedDrawingIds=selectedDrawingIds.filter(id=>id!==d.id);else selectedDrawingIds.push(d.id);selected={type:selectedDrawingIds.length?"drawing":null,id:selectedDrawingIds[0]||null,layerId:null};renderDrawings();renderDrawingStylePanel();updateDrawingLayerActiveRows();return;}
            if(d.type==="text"){
                // Primeiro clique apenas seleciona. Não recriamos o SVG aqui, para que o segundo
                // clique do dblclick continue tendo o mesmo alvo e possa entrar na edição.
                const wasSelected=selectedDrawingIds.includes(d.id);
                if(!wasSelected){
                    selectedDrawingIds=[d.id]; selected={type:"drawing",id:d.id,layerId:null};
                    document.querySelectorAll(".layer-row").forEach(r=>r.classList.remove("active"));
                    document.querySelectorAll(".drawing-layer-row").forEach(r=>r.classList.toggle("active",r.dataset.drawingId===d.id));
                    el.classList.add("is-selected"); renderDrawingStylePanel();
                }
                let moved=false, startX=e.clientX, startY=e.clientY;
                const cleanup=()=>{window.removeEventListener("pointermove",onMove);window.removeEventListener("pointerup",onUp);};
                const onMove=ev=>{if(moved)return;if(Math.hypot(ev.clientX-startX,ev.clientY-startY)<4)return;moved=true;cleanup();startDrawingTransform(ev,d,"move");};
                const onUp=()=>cleanup();
                window.addEventListener("pointermove",onMove); window.addEventListener("pointerup",onUp,{once:true});
            } else if(selectedDrawingIds.includes(d.id)){
                selected={type:"drawing",id:selectedDrawingIds[0]||d.id,layerId:null};
                updateDrawingLayerActiveRows(); renderDrawingStylePanel(); startDrawingTransform(e,d,"move");
            } else{selectDrawing(d);startDrawingTransform(e,d,"move");}
        });
        el.addEventListener("click",e=>{if(currentTool!=="select"||editorMode!=="drawing")return;e.stopPropagation();if(d.type!=="text")selectDrawing(d);});
        el.addEventListener("dblclick",e=>{e.preventDefault();e.stopPropagation();if(d.type==="text"&&editorMode==="drawing"){selectedDrawingIds=[d.id];selected={type:"drawing",id:d.id,layerId:null};updateDrawingLayerActiveRows();editDrawingText(d);}});
        if(d.type!=="image"){
            const hasStroke=d.hasStroke!==false && d.stroke!="transparent";
            const fillValue=d.type==="line"||d.type==="arrow"?"none":(d.fill||"rgba(63,174,88,.08)");
            el.setAttribute("fill",fillValue);
            el.setAttribute("stroke",hasStroke?(d.stroke||"#2f8e45"):"none");
            const strokeWidth=Number(d.strokeWidth)||2;
            el.setAttribute("stroke-width",strokeWidth);
            if(d.type==="text"){
                const textStroke=hasStroke?(d.textStrokeWidth ?? d.strokeWidth ?? 0):0;
                el.setAttribute("stroke-width",textStroke);
                el.style.setProperty("fill",d.fill||"#1e1e1e","important");
                el.style.setProperty("stroke",hasStroke?(d.stroke||"transparent"):"none","important");
                el.style.setProperty("stroke-width",String(textStroke),"important");
            }
        }
        if(d.type==="arrow"){
            const markerId=`arrowhead-${String(d.stroke||"#2f8e45").replace(/[^a-zA-Z0-9]/g,"")}`;
            let defs=overlay.querySelector("defs");
            if(!defs){defs=document.createElementNS(ns,"defs");overlay.prepend(defs);}
            if(!defs.querySelector(`#${CSS.escape(markerId)}`)){
                const marker=document.createElementNS(ns,"marker");marker.id=markerId;marker.setAttribute("markerWidth","8");marker.setAttribute("markerHeight","8");marker.setAttribute("refX","7");marker.setAttribute("refY","4");marker.setAttribute("orient","auto");marker.setAttribute("markerUnits","strokeWidth");
                const path=document.createElementNS(ns,"path");path.setAttribute("d","M0 0 L8 4 L0 8 z");path.setAttribute("fill",d.stroke||"#2f8e45");marker.appendChild(path);defs.appendChild(marker);
            }
            el.setAttribute("marker-end",`url(#${markerId})`);
        }
        if(Number(d.rotation)){const b=drawingBounds({...d,rotation:0}),cx=b.x+b.w/2,cy=b.y+b.h/2;el.setAttribute("transform",`rotate(${Number(d.rotation)||0} ${cx} ${cy})`);}
        return el;
    }
    function updateDrawingLayerActiveRows(){document.querySelectorAll(".drawing-layer-row").forEach(r=>r.classList.toggle("active",selectedDrawingIds.includes(r.dataset.drawingId)));}
    function selectDrawing(d){selectedDrawingIds=[d.id];selected={type:"drawing",id:d.id,layerId:null};document.querySelectorAll(".layer-row").forEach(r=>r.classList.remove("active"));document.querySelector(`[data-drawing-id="${CSS.escape(d.id)}"]`)?.classList.add("active");renderDrawings();renderDrawingStylePanel();showHint(`Desenho selecionado · ${toolLabel(d.type)}`);}
    function recordDrawingUndo(){if(cfg.public)return;undoStack.push(JSON.stringify(drawings));if(undoStack.length>60)undoStack.shift();redoStack=[];}
    function restoreDrawingSnapshot(snapshot){try{drawings=JSON.parse(snapshot)||[];selectedDrawingIds=[];selected={type:null,id:null,layerId:null};saveDrawings();updateDrawingLayers();renderDrawings();renderDrawingStylePanel();}catch(e){console.error(e);}}
    function undoDrawings(){if(!undoStack.length)return;redoStack.push(JSON.stringify(drawings));restoreDrawingSnapshot(undoStack.pop());showHint("Desfazer");}
    function redoDrawings(){if(!redoStack.length)return;undoStack.push(JSON.stringify(drawings));restoreDrawingSnapshot(redoStack.pop());showHint("Refazer");}
    function pasteDrawings(){if(!drawingClipboard?.length)return;recordDrawingUndo();const pasted=drawingClipboard.map((d,i)=>{const copy=JSON.parse(JSON.stringify(d));copy.id=`drawing-${Date.now()}-${Math.random().toString(16).slice(2)}-${i}`;copy.x=(copy.x||0)+20;copy.y=(copy.y||0)+20;if("x2" in copy)copy.x2+=20;if("y2" in copy)copy.y2+=20;return copy;});drawings.push(...pasted);selectedDrawingIds=pasted.map(d=>d.id);selected={type:"drawing",id:pasted[0]?.id||null,layerId:null};saveDrawings();updateDrawingLayers();renderDrawings();renderDrawingStylePanel();showHint(`${pasted.length} desenho(s) colado(s)`);}
    let activeTextEditor=null;
    function editDrawingText(d){
        if(cfg.public)return;
        activeTextEditor?.remove(); activeTextEditor=null;
        const editor=document.createElement("div");
        editor.className="canvas-text-editor";
        editor.contentEditable="true"; editor.spellcheck=false; editor.textContent=d.text||"Texto";
        editor.style.left=`${d.x}px`; editor.style.top=`${d.y-18}px`;
        editor.style.setProperty("color",toColor(d.fill||d.stroke,"#1e1e1e"),"important");
        editor.style.setProperty("font-size",`${Number(d.fontSize)||16}px`,`important`); editor.style.setProperty("font-family",d.fontFamily||"Inter","important"); editor.style.setProperty("font-weight",String(d.fontWeight||600),"important");
        const initialTextStroke=d.hasStroke!==false && d.stroke!=="transparent" ? (d.textStrokeWidth ?? d.strokeWidth ?? 0) : 0;
        editor.style.setProperty("-webkit-text-stroke",`${initialTextStroke}px ${d.stroke||"transparent"}`,"important");
        document.querySelector(".editor-app")?.appendChild(editor); activeTextEditor=editor; editor.addEventListener("pointerdown",e=>e.stopPropagation());
        selected={type:"drawing",id:d.id,layerId:null}; renderDrawingStylePanel();
        editor.focus({preventScroll:true}); const range=document.createRange(); range.selectNodeContents(editor); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        const finish=()=>{
            if(activeTextEditor!==editor)return;
            d.text=editor.textContent.replace(/\n/g," ").trim()||"Texto";
            d.fill=d.fill||"#1e1e1e"; editor.remove(); activeTextEditor=null;
            saveDrawings(); renderDrawings(); updateDrawingLayers(); renderDrawingStylePanel();
        };
        editor.addEventListener("input",()=>{
            d.text=editor.textContent.replace(/\n/g," ");
            renderDrawings();
            // Mantém o editor por cima do texto atual, sem criar outro objeto.
            editor.style.left=`${d.x}px`; editor.style.top=`${d.y-18}px`;
        });
        editor.addEventListener("blur",finish,{once:true});
        editor.addEventListener("keydown",e=>{
            if(e.key==="Enter"){e.preventDefault();editor.blur();}
            if(e.key==="Escape"){e.preventDefault();editor.textContent=d.text||"Texto";editor.blur();}
        });
    }
    function removeDrawing(id){removeDrawings([id]);}
    function removeDrawings(ids){const set=new Set(ids||[]);if(!set.size)return;recordDrawingUndo();drawings=drawings.filter(d=>!set.has(d.id));selectedDrawingIds=[];selected={type:null,id:null,layerId:null};saveDrawings();renderDrawings();updateDrawingLayers();renderDrawingStylePanel();showHint(`${set.size} desenho(s) removido(s)`);}


    document.getElementById("drawing-image-input")?.addEventListener("change",event=>{const file=event.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{
            const src=reader.result;
            let optimized=src;
            try{
                const img=new Image();
                await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=src;});
                const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth||max,img.naturalHeight||max));
                const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round((img.naturalWidth||max)*scale));canvas.height=Math.max(1,Math.round((img.naturalHeight||max)*scale));
                const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,canvas.width,canvas.height);
                optimized=canvas.toDataURL("image/jpeg",.82);
            }catch{}
            drawings.push({id:`image-${Date.now()}`,type:"image",x:Math.max(20,mapEl.clientWidth/2-120),y:Math.max(20,mapEl.clientHeight/2-90),w:240,h:180,src:optimized,visible:true});saveDrawings();renderDrawings();updateDrawingLayers();setTool("select");
        };reader.readAsDataURL(file);event.target.value="";});

    function selectGeoFeature(feature){
        const fid=feature.id??feature.properties?.id, layerId=feature.properties?._layer_id;
        if(selected.type==="geo" && selected.id && selected.id!==String(fid||"")) setFeatureStateSafe(selected.id,{selected:false});
        selected={type:"geo",id:String(fid||layerId||""),layerId:String(layerId||"")};
        if(fid!==undefined && fid!==null) setFeatureStateSafe(String(fid),{selected:true});
        document.querySelectorAll(".layer-row").forEach(r=>r.classList.remove("active"));
        const row=document.querySelector(`[data-layer-id="${CSS.escape(String(layerId||""))}"]`);row?.classList.add("active");
        updateGeoToolState(); renderVertexHandles();showHint("Geo selecionado");
    }
    function clearSelection(){
        if(selected.type==="geo" && selected.id) setFeatureStateSafe(selected.id,{selected:false});
        selectedDrawingIds=[];selected={type:null,id:null,layerId:null}; endVertexEdit(); renderDrawings(); renderDrawingStylePanel();
        document.querySelectorAll(".layer-row").forEach(r=>r.classList.remove("active"));
        updateGeoToolState();
    }
    function getFeatureBySelection(){
        if(selected.type!=="geo")return null;
        const all=[...geojson.features];
        return all.find(f=>String(f.id??f.properties?._layer_id)===selected.id)||all.find(f=>String(f.properties?._layer_id)===selected.layerId);
    }
    function beginGeoVertexEdit(feature){
        selectGeoFeature(feature);
        const fid=String(feature.id??feature.properties?._layer_id??"");
        const sourceFeatures=[...geojson.features];
        editingFeature=sourceFeatures.find(f=>String(f.id??f.properties?._layer_id??"")===fid)||feature;
        map.doubleClickZoom.disable();renderVertexHandles();showHint("Edição de Geo · arraste vértices · Delete remove o vértice");
    }
    function endVertexEdit(){editingFeature=null;map.doubleClickZoom.enable();clearVertexHandles();}
    function renderVertexHandles(){clearVertexHandles();if(!editingFeature)return;const geom=editingFeature.geometry;if(!geom)return;const positions=[];if(geom.type==="Polygon")geom.coordinates.forEach((ring,ri)=>ring.forEach((coord,ci)=>positions.push({coord,ri,ci})));else if(geom.type==="LineString")geom.coordinates.forEach((coord,ci)=>positions.push({coord,ri:0,ci}));else if(geom.type==="Point")positions.push({coord:geom.coordinates,ri:0,ci:0});
        positions.forEach(pos=>{const el=document.createElement("button");el.type="button";el.className="vertex-handle";el.title="Vértice · clique para selecionar · Delete para remover";el.style.left=`${map.project(pos.coord).x}px`;el.style.top=`${map.project(pos.coord).y}px`;el.dataset.vertex=`${pos.ri}:${pos.ci}`;el.addEventListener("pointerdown",e=>startVertexDrag(e,pos,el));el.addEventListener("click",e=>{e.stopPropagation();selectedVertex=pos;document.querySelectorAll(".vertex-handle").forEach(v=>v.classList.remove("selected"));el.classList.add("selected");});mapEl.appendChild(el);vertexHandles.push(el);});
    }
    let dragVertex=null;
    function startVertexDrag(e,pos,el){e.preventDefault();e.stopPropagation();selectedVertex=pos;el.classList.add("selected");dragVertex={pos,el};el.setPointerCapture?.(e.pointerId);el.addEventListener("pointermove",moveVertex);el.addEventListener("pointerup",endVertexDrag,{once:true});}
    function moveVertex(e){if(!dragVertex)return;const rect=mapEl.getBoundingClientRect(),lngLat=map.unproject([e.clientX-rect.left,e.clientY-rect.top]);const coord=[lngLat.lng,lngLat.lat];const g=editingFeature.geometry;if(g.type==="Polygon"){const ring=g.coordinates[dragVertex.pos.ri];ring[dragVertex.pos.ci]=coord;if(dragVertex.pos.ci===0)ring[ring.length-1]=[...coord];else if(dragVertex.pos.ci===ring.length-1)ring[0]=[...coord];}else if(g.type==="LineString")g.coordinates[dragVertex.pos.ci]=coord;else if(g.type==="Point")g.coordinates=coord;updateFeatureSource();renderVertexHandles();}
    function endVertexDrag(){if(!dragVertex)return;dragVertex.el.removeEventListener("pointermove",moveVertex);dragVertex=null;persistFeature(editingFeature);}
    function deleteSelectedVertex(){if(!editingFeature||!selectedVertex)return;const g=editingFeature.geometry;let ring;if(g.type==="Polygon"){ring=g.coordinates[selectedVertex.ri];if(ring.length<=4)return showHint("Um polígono precisa manter pelo menos 3 vértices");ring.splice(selectedVertex.ci,1);if(selectedVertex.ci===0)ring[ring.length-1]=[...ring[0]];else if(selectedVertex.ci===ring.length-1)ring[ring.length-1]=[...ring[0]];}else if(g.type==="LineString"){if(g.coordinates.length<=2)return showHint("Uma linha precisa manter pelo menos 2 vértices");g.coordinates.splice(selectedVertex.ci,1);}else if(g.type==="Point"){deleteSelectedGeo();return;}selectedVertex=null;updateFeatureSource();renderVertexHandles();persistFeature(editingFeature);showHint("Vértice removido");}
    function clearVertexHandles(){vertexHandles.forEach(h=>h.remove());vertexHandles=[];selectedVertex=null;}
    function updateFeatureSource(){if(map.getSource("geodesk-data"))map.getSource("geodesk-data").setData(geojson);renderGeoDraw();}
    async function persistFeature(feature){
        const id=feature.id;
        if(!id||String(id).startsWith("draw-")){saveClientGeo();return;}
        try{const response=await fetch(`/api/projects/${cfg.projectId}/features/${id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({geometry:feature.geometry}),cache:"no-store"});if(!response.ok){const body=await response.text();throw new Error(`HTTP ${response.status}: ${body.slice(0,300)}`);}trackGeoAction(id);showHint("Geometria salva");}catch(error){console.error("[GeoDesk] Falha ao salvar geometria",{featureId:id,error});showHint("Alteração local aplicada, mas não foi possível salvar no servidor.");}
    }
    function saveClientGeo(){try{localStorage.setItem(`geodesk-client-geo-${cfg.projectId}`,JSON.stringify(geojson));}catch{}}
    async function deleteSelectedGeo(){
        if(selected.type!=="geo")return;
        if(!selected.id){
            const row=document.querySelector(`[data-layer-id="${CSS.escape(selected.layerId)}"]`);
            if(row)await handleLayerAction("delete",row);
            selected={type:null,id:null,layerId:null};return;
        }
        const feature=getFeatureBySelection();if(!feature)return;const id=feature.id;
        if(id&&!String(id).startsWith("draw-")){try{const response=await fetch(`/api/projects/${cfg.projectId}/features/${id}`,{method:"DELETE"});if(!response.ok)throw new Error();trackGeoAction(id);}catch{showHint("Não foi possível excluir o geo.");return;}}
        else{geojson.features=geojson.features.filter(f=>f!==feature);saveClientGeo();}
        geojson.features=geojson.features.filter(f=>f.id!==id);
        selected={type:null,id:null,layerId:null};endVertexEdit();addDataLayers();updateLayerRows();showHint("Feição geo removida · Ctrl+Z para desfazer");
    }
    let lastGeoActionFeatureId=null;
    function trackGeoAction(featureId){lastGeoActionFeatureId=featureId;}
    async function undoLastGeoAction(){
        if(!lastGeoActionFeatureId){showHint("Nada para desfazer");return;}
        const featureId=lastGeoActionFeatureId;
        try{
            const response=await fetch(`/api/projects/${cfg.projectId}/features/${featureId}/undo`,{method:"POST"});
            if(!response.ok){if(response.status===404){showHint("Nada para desfazer nesta feição");lastGeoActionFeatureId=null;return;}throw new Error();}
            const data=await response.json();
            lastGeoActionFeatureId=null;
            await refreshGeoData();
            showHint(data.deleted?"Criação desfeita":"Última alteração desfeita");
        }catch(error){console.error("[GeoDesk] Falha ao desfazer",{featureId,error});showHint("Não foi possível desfazer a última alteração.");}
    }

    function setupLayers(){
        document.querySelectorAll("[data-collapse-section]").forEach(btn=>btn.addEventListener("click",()=>btn.closest(".layer-section")?.classList.toggle("collapsed")));
        document.querySelectorAll("[data-collapse-layers]").forEach(btn=>btn.addEventListener("click",event=>{
            event.preventDefault(); event.stopPropagation();
            const panel=btn.closest(".editor-layers"); if(!panel)return;
            const collapsed=panel.classList.toggle("layers-collapsed");
            btn.setAttribute("aria-expanded",String(!collapsed));
            btn.setAttribute("aria-label",collapsed?"Expandir painel de camadas":"Minimizar painel de camadas");
            btn.textContent=collapsed?"›":"‹";
        }));
        document.querySelectorAll(".layer-row[data-layer-id]").forEach(row=>bindLayerRow(row));
        setupLayerDnD(document.querySelectorAll(".section-content"));
        document.querySelectorAll("[data-new-layer='drawing']").forEach(btn=>btn.addEventListener("click",()=>{if(!cfg.public)setEditorMode("drawing",true);}));
        const base=document.querySelector("[data-layer-kind='base']");
        base?.querySelector("[data-layer-toggle-base]")?.addEventListener("click",e=>{
            e.preventDefault(); e.stopPropagation();
            basemapVisible=!basemapVisible;
            applyBasemapVisibility();
            requestAnimationFrame(applyBasemapVisibility);
            saveDrawings(); savePublicViewState();
        });
        renderDrawingStylePanel();
        updateGeoToolState();
    }
    function bindLayerRow(row){
        row.draggable=!cfg.public && row.dataset.layerKind!=="base";
        row.addEventListener("dragstart",e=>{if(cfg.public)return;e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",row.dataset.layerId||row.dataset.drawingId);row.classList.add("dragging");});
        row.addEventListener("dragend",()=>row.classList.remove("dragging"));
        row.addEventListener("dragover",e=>{if(cfg.public)return;e.preventDefault();row.classList.add("drag-over")});
        row.addEventListener("dragleave",()=>row.classList.remove("drag-over"));
        row.addEventListener("drop",e=>{if(cfg.public)return;e.preventDefault();row.classList.remove("drag-over");const id=e.dataTransfer.getData("text/plain"),dragged=document.querySelector(`[data-layer-id="${CSS.escape(id)}"], [data-drawing-id="${CSS.escape(id)}"]`);if(!dragged||dragged===row)return;row.parentElement.insertBefore(dragged,e.offsetY<row.offsetHeight/2?row:row.nextSibling);if(row.dataset.layerKind==="geo")persistLayerOrder();else reorderDrawingsFromList();});
        row.querySelector(".layer-visibility")?.addEventListener("click",e=>{e.stopPropagation();toggleLayerRow(row)});
        row.addEventListener("click",event=>{
            if(cfg.public)return;
            const isDrawing=Boolean(row.dataset.drawingId);
            if(isDrawing){
                const d=drawings.find(x=>x.id===row.dataset.drawingId); if(!d)return;
                const multi=event.shiftKey||event.ctrlKey||event.metaKey;
                if(multi){
                    if(selectedDrawingIds.includes(d.id)) selectedDrawingIds=selectedDrawingIds.filter(id=>id!==d.id);
                    else selectedDrawingIds=[...selectedDrawingIds,d.id];
                }else selectedDrawingIds=[d.id];
                selected=selectedDrawingIds.length?{type:"drawing",id:selectedDrawingIds[0],layerId:null}:{type:null,id:null,layerId:null};
                document.querySelectorAll(".layer-row").forEach(r=>r.classList.toggle("active",selectedDrawingIds.includes(r.dataset.drawingId)));
                renderDrawings();renderDrawingStylePanel();updateDrawingLayerActiveRows();
                showHint(selectedDrawingIds.length>1?`${selectedDrawingIds.length} desenhos selecionados`:`Desenho selecionado · ${toolLabel(d.type)}`);
                return;
            }
            document.querySelectorAll(".layer-row").forEach(r=>r.classList.remove("active"));row.classList.add("active");
            if(row.dataset.layerKind==="geo"){selected={type:"geo",id:"",layerId:row.dataset.layerId};updateGeoToolState();showHint(`Camada geo selecionada · ${row.querySelector(".layer-name")?.textContent||""}`);}
        });
        row.querySelector(".layer-more")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openLayerContextMenu(e.clientX,e.clientY,row)});
        // O menu contextual da camada deve funcionar diretamente na própria linha, inclusive em Desenhos.
        row.addEventListener("contextmenu",e=>{
            if(cfg.public && row.dataset.layerKind!=="geo" && row.dataset.layerKind!=="drawing")return;
            e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
            openLayerContextMenu(e.clientX,e.clientY,row);
            return false;
        },true);
        if(!cfg.public){
            row.querySelector(".layer-name")?.addEventListener("dblclick",e=>{
                e.preventDefault();e.stopPropagation();
                startInlineLayerRename(row);
            });
        }
    }
    function displayLayerName(name){
        const value=String(name??"");
        return value.length>20 ? `${value.slice(0,20)}...` : value;
    }
    function startInlineLayerRename(row){
        const kind=row.dataset.layerKind, label=row.querySelector(".layer-name");
        if(!label||label.querySelector("input"))return;
        const item=kind==="drawing" ? drawings.find(x=>x.id===row.dataset.drawingId) : cfg.layers.find(x=>String(x.id)===String(row.dataset.layerId));
        if(!item)return;
        const original=String(item.name||drawingLayerLabel(item,0)||"Camada");
        const input=document.createElement("input");
        input.value=original; input.maxLength=20; input.className="layer-name-editor";
        label.textContent=""; label.appendChild(input);
        let finished=false;
        const finish=(commit=true)=>{
            if(finished)return; finished=true;
            const name=input.value.trim();
            if(commit&&name){
                item.name=name;
                if(kind==="drawing") saveDrawings();
                else fetch(`/api/projects/${cfg.projectId}/layers/${item.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})})
                    .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);})
                    .catch(error=>{console.error("[GeoDesk] Falha ao renomear camada",error);showHint("Não foi possível renomear a camada.");});
            }
            if(kind==="drawing") updateDrawingLayers();
            else { label.textContent=displayLayerName(item.name||original); }
        };
        input.addEventListener("keydown",e=>{
            if(e.key==="Enter"){e.preventDefault();finish(true);}
            if(e.key==="Escape"){e.preventDefault();finish(false);}
        });
        input.addEventListener("blur",()=>finish(true),{once:true});
        requestAnimationFrame(()=>{input.focus();input.select();});
    }
    function startInlineDrawingRename(row,fromMenu=false){ startInlineLayerRename(row); }
    function setupLayerDnD(contents){contents.forEach(c=>c.addEventListener("dragover",e=>{if(!cfg.public)e.preventDefault()}));}
    async function moveGeoLayer(row,delta){
        if(cfg.public)return;
        const rows=[...document.querySelectorAll("[data-section='geo'] .layer-row[data-layer-id]")], index=rows.indexOf(row), target=index+delta;
        if(index<0||target<0||target>=rows.length)return;
        const ids=rows.map(r=>r.dataset.layerId); [ids[index],ids[target]]=[ids[target],ids[index]];
        const parent=row.parentElement, targetRow=rows[target];
        if(parent&&targetRow) parent.insertBefore(row,target<index?targetRow:targetRow.nextSibling);
        await persistLayerOrder(ids);
    }
    async function persistLayerOrder(ids=null){
        if(cfg.public)return;
        const rowIds=ids||[...document.querySelectorAll("[data-section='geo'] .layer-row[data-layer-id]")].map(r=>r.dataset.layerId);
        const byId=new Map(cfg.layers.map(l=>[String(l.id),l]));
        rowIds.forEach((id,index)=>{const l=byId.get(String(id));if(l)l.z_index=rowIds.length-index;});
        cfg.layers.sort((a,b)=>rowIds.indexOf(String(a.id))-rowIds.indexOf(String(b.id)));
        const section=document.querySelector("[data-section='geo'] .section-content"); const base=section?.querySelector(".base-layer");
        if(section){section.querySelectorAll(".layer-row[data-layer-id]").forEach(r=>r.remove());rowIds.forEach(id=>{const layer=byId.get(String(id));if(layer){const r=makeGeoLayerRow(layer);base?section.insertBefore(r,base):section.appendChild(r);bindLayerRow(r);}});}
        try{const response=await fetch(`/api/projects/${cfg.projectId}/layers/reorder`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({layer_ids:rowIds}),cache:"no-store"});const body=await response.text();if(!response.ok)throw new Error(`HTTP ${response.status}: ${body.slice(0,300)}`);addDataLayers();console.info("[GeoDesk] Ordem Geo salva",rowIds);showHint("Ordem da camada salva");}catch(error){console.error("[GeoDesk] Falha ao salvar ordem Geo",{ids:rowIds,error});showHint("Não foi possível salvar a ordem das camadas.");}
    }
    function reorderDrawingsFromList(){const ids=[...document.querySelectorAll("#drawing-layers-list .drawing-layer-row")].map(r=>r.dataset.drawingId);drawings=ids.reverse().map(id=>drawings.find(d=>d.id===id)).filter(Boolean);saveDrawings();renderDrawings();updateDrawingLayers();}
    function savePublicViewState(){if(!cfg.public)return;try{localStorage.setItem(`geodesk-public-view-${cfg.projectId}`,JSON.stringify({basemap_visible:basemapVisible,geo:Object.fromEntries(cfg.layers.map(l=>[String(l.id),l.visible!==false])),drawings:Object.fromEntries(drawings.map(d=>[String(d.id),d.visible!==false]))}));}catch{}}
    function toggleLayerRow(row){
        const visible=!row.querySelector(".layer-visibility")?.classList.contains("is-visible"),btn=row.querySelector(".layer-visibility");btn.textContent=visible?"◉":"○";btn.classList.toggle("is-visible",visible);
        if(row.dataset.layerKind==="base"){basemapVisible=visible;applyBasemapVisibility();saveDrawings();savePublicViewState();return;}
        setLayerVisibility(row.dataset.layerId,visible,"geo");
        const layer=cfg.layers.find(l=>String(l.id)===String(row.dataset.layerId));if(layer)layer.visible=visible;
        savePublicViewState();if(!cfg.public)fetch(`/api/projects/${cfg.projectId}/layers/${row.dataset.layerId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({visible})}).catch(()=>{});
    }
    function normalizeGeoGeometryType(type){
        const map={Point:"Point",MultiPoint:"Point",LineString:"LineString",MultiLineString:"LineString",Polygon:"Polygon",MultiPolygon:"Polygon"};
        return map[type] || null;
    }

    async function setupGeoImport(){
        if(cfg.public)return;
        const input=document.getElementById("geo-file-input"), modal=document.getElementById("geo-import-modal"), info=document.getElementById("geo-import-info"), confirm=document.getElementById("geo-import-confirm");
        const open=()=>{if(!modal)return;modal.hidden=false;document.body.classList.add("modal-open");if(info)info.hidden=true;if(confirm)confirm.disabled=true;};
        document.querySelectorAll("[data-new-layer='geo']").forEach(btn=>btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();open();}));
        document.querySelector("[data-import-file]")?.addEventListener("click",()=>input?.click());
        document.querySelectorAll("[data-empty-geo]").forEach(btn=>btn.addEventListener("click",async()=>{
            try{const type=btn.dataset.emptyGeo; const name=type==="Point"?"Pontos":type==="LineString"?"Linhas":"Polígonos"; await createEmptyGeoLayer(type,name); if(modal){modal.hidden=true;document.body.classList.remove("modal-open");}}
            catch(error){console.error("[GeoDesk] Falha ao criar camada vazia",error);showHint(error.message||"Não foi possível criar a camada.");}
        }));
        input?.addEventListener("change",async event=>{
            const file=event.target.files?.[0]; if(!file)return;
            setGeoLoading(`Lendo ${file.name}...`);
            try{
                const parsed=await inspectGeoFile(file);
                window.__pendingGeoImport={file,data:parsed.data,geometryTypes:parsed.geometryTypes,projection:parsed.projection};
                setGeoLoading(`Arquivo lido · preparando ${parsed.data.features.length.toLocaleString("pt-BR")} feição(ões)...`);
                if(info){info.hidden=false;info.innerHTML=`<div><strong>${escapeHtml(file.name)}</strong></div><div>Projeção detectada: <b>${escapeHtml(parsed.projection.label)}</b></div><div>Geometria: <b>${escapeHtml(parsed.geometryTypes.join(", ")||"não identificada")}</b> · ${parsed.data.features.length.toLocaleString("pt-BR")} feição(ões)</div><small>${parsed.projection.note||"Os dados serão convertidos para EPSG:4326, padrão do mapa."}</small>`;}
                if(confirm){confirm.disabled=false;confirm.onclick=()=>commitGeoImport();}
            }catch(error){console.error("[GeoDesk] Falha ao analisar arquivo",{name:file.name,size:file.size,error});if(info){info.hidden=false;info.textContent=`Não foi possível ler o arquivo: ${error.message}`;}if(confirm)confirm.disabled=true;hideGeoLoading();}
            finally{event.target.value="";}
        });
    }
    async function inspectGeoFile(file){
        let data, projection={epsg:4326,label:"EPSG:4326 / WGS84",note:"O mapa usa EPSG:4326."};
        if(/\.zip$/i.test(file.name)){
            if(!window.shp)throw new Error("Leitor de Shapefile não carregou");
            let prjText="";
            try{if(window.JSZip){const zip=await JSZip.loadAsync(await file.arrayBuffer());const prj=Object.keys(zip.files).find(n=>/\.prj$/i.test(n));if(prj)prjText=await zip.files[prj].async("text");}}catch(e){console.warn("[GeoDesk] Não foi possível ler o .prj do Shapefile",e);}
            if(prjText)projection=detectProjectionFromPrj(prjText);
            else projection={epsg:null,label:"projeção não informada no .prj",note:"O Shapefile será lido pelo shpjs e convertido para WGS84 quando houver .prj."};
            data=await window.shp(await file.arrayBuffer());
            if(Array.isArray(data))data={type:"FeatureCollection",features:data.flatMap(item=>item.features||[])};
        }else{
            const raw=await file.text();
            console.info("[GeoDesk] Analisando arquivo",{name:file.name,size:file.size,type:file.type,preview:raw.slice(0,300)});
            const text=raw.replace(/^\uFEFF/,"").trim();
            if(/\.kml$/i.test(file.name)){data=parseKmlGeoJSON(text);projection={epsg:4326,label:"KML / WGS84",note:"Coordenadas KML são tratadas como longitude/latitude."};}
            else {try{data=JSON.parse(text);}catch(parseError){console.error("[GeoDesk] JSON.parse falhou",{name:file.name,message:parseError.message,preview:text.slice(0,1000)});throw new Error(`JSON inválido: ${parseError.message}`);} projection=detectProjectionFromGeoJSON(data);}
        }
        data=normalizeImportedGeoJSON(data);
        if(projection.epsg && Number(projection.epsg)!==4326) data=reprojectGeoJSON(data,projection.epsg);
        const geometryTypes=[...new Set(data.features.map(f=>normalizeGeoGeometryType(f.geometry?.type)).filter(Boolean))];
        if(!data.features.length||!geometryTypes.length)throw new Error("O arquivo não contém geometrias válidas.");
        return {data,geometryTypes,projection};
    }
    function detectProjectionFromGeoJSON(data){
        const crs=data?.crs, props=crs?.properties||{}; const raw=String(props.name||props.href||"");
        const m=raw.match(/EPSG(?:::|\/|:|\s+)(\d+)/i); const epsg=m?Number(m[1]):(/CRS84|WGS.?84/i.test(raw)?4326:null);
        return epsg?{epsg,label:`EPSG:${epsg}${epsg===4326?" / WGS84":""}`,note:epsg===4326?"O mapa usa EPSG:4326.":`Convertendo automaticamente de EPSG:${epsg} para EPSG:4326.`}:{epsg:null,label:raw||"CRS não informado",note:"Sem EPSG reconhecível; o arquivo será enviado e o servidor tentará interpretar a projeção informada."};
    }
    function detectProjectionFromPrj(prj){
        const m=String(prj).match(/AUTHORITY\s*\[\s*["']EPSG["']\s*,\s*["'](\d+)["']\s*\]/i)||String(prj).match(/EPSG[:\s"]+(\d{4,6})/i); const epsg=m?Number(m[1]):null;
        return epsg?{epsg,label:`EPSG:${epsg}${epsg===4326?" / WGS84":""}`,note:epsg===4326?"O mapa usa EPSG:4326.":`Projeção detectada no .prj. Convertendo para EPSG:4326.`}:{epsg:null,label:"WKT do .prj (EPSG não identificado)",note:"O .prj foi encontrado. O Shapefile será lido pelo shpjs."};
    }
    function reprojectGeoJSON(data,epsg){
        if(!window.proj4)throw new Error("Biblioteca de projeção não carregou");
        const from=`EPSG:${epsg}`;
        try{proj4(from,"EPSG:4326",[0,0]);}catch(e){throw new Error(`EPSG:${epsg} não está cadastrado no conversor do navegador. O arquivo não foi enviado para evitar posicionamento incorreto.`);}
        const transformCoords=v=>{if(!Array.isArray(v))return v;if(v.length>=2&&typeof v[0]==="number"&&typeof v[1]==="number"){const out=proj4(from,"EPSG:4326",[v[0],v[1]]);return [out[0],out[1],...v.slice(2)];}return v.map(transformCoords);};
        return {...data,crs:undefined,features:data.features.map(f=>({...f,geometry:f.geometry?{...f.geometry,coordinates:transformCoords(f.geometry.coordinates)}:f.geometry}))};
    }
    function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
    async function commitGeoImport(){
        const pending=window.__pendingGeoImport;if(!pending)return; const {file,data,geometryTypes}=pending; const started=performance.now(); setGeoLoading(`Carregando ${file.name}...`);
        const confirm=document.getElementById("geo-import-confirm");if(confirm)confirm.disabled=true;
        try{
            const response=await fetch(`/api/projects/${cfg.projectId}/layers/import`,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({name:file.name.replace(/\.[^.]+$/,""),data})});
            const responseText=await response.text();
            if(!response.ok){console.error("[GeoDesk] API de importação recusou o arquivo",{status:response.status,body:responseText.slice(0,3000)});throw new Error(`HTTP ${response.status}: ${responseText.slice(0,500)}`);}
            let created;try{created=JSON.parse(responseText);}catch(e){console.error("[GeoDesk] API retornou JSON inválido",responseText.slice(0,3000));throw new Error("Resposta inválida da API");}
            const ids=Array.isArray(created.feature_ids)?created.feature_ids:[];
            data.features.forEach((f,i)=>{f.id=ids[i]||f.id||`import-${created.id}-${i}`;f.properties={...(f.properties||{}),_layer_id:String(created.id)};});
            cfg.layers.push(created);geojson.features.push(...data.features);const section=document.querySelector("[data-section='geo'] .section-content");section?.querySelector(".layers-empty")?.remove();const row=makeGeoLayerRow(created);section?.appendChild(row);bindLayerRow(row);selected={type:"geo",id:"",layerId:String(created.id)};updateGeoToolState();updateLayerRows();addDataLayers();fitToGeoJSON(map,{type:"FeatureCollection",features:data.features});
            const modal=document.getElementById("geo-import-modal");if(modal){modal.hidden=true;document.body.classList.remove("modal-open");}
            showHint(`${file.name} importado · ${data.features.length.toLocaleString("pt-BR")} feição(ões) · ${Math.round(performance.now()-started)} ms`);console.info("[GeoDesk] Importação concluída",{layerId:created.id,features:data.features.length,geometryTypes,elapsedMs:Math.round(performance.now()-started)});
        }catch(error){console.error("[GeoDesk] ERRO NA IMPORTAÇÃO",{name:file.name,size:file.size,geometryTypes,projection:pending.projection,error});showHint(`Erro ao importar ${file.name}: ${error.message||"verifique o console"}`);}finally{window.__pendingGeoImport=null;hideGeoLoading();if(confirm)confirm.disabled=true;}
    }
    async function createEmptyGeoLayer(geometryType,name){
        const response=await fetch(`/api/projects/${cfg.projectId}/layers/empty`,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({name,geometry_type:geometryType})});
        const text=await response.text();if(!response.ok)throw new Error(`HTTP ${response.status}: ${text.slice(0,300)}`);const layer=JSON.parse(text);cfg.layers.push(layer);const section=document.querySelector("[data-section='geo'] .section-content");section?.querySelector(".layers-empty")?.remove();const row=makeGeoLayerRow(layer);section?.appendChild(row);bindLayerRow(row);selected={type:"geo",id:"",layerId:String(layer.id)};updateGeoToolState();updateLayerRows();addDataLayers();showHint(`Camada vazia de ${geometryType==="Point"?"ponto":geometryType==="LineString"?"linha":"polígono"} criada`);
    }
    function parseKmlGeoJSON(text){
        const xml=new DOMParser().parseFromString(text,"application/xml");
        if(xml.querySelector("parsererror"))throw new Error("KML inválido ou corrompido");
        const features=[];
        const coordinateList=node=>String(node?.textContent||"").trim().split(/\s+/).map(pair=>pair.split(",").slice(0,2).map(Number)).filter(p=>p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
        xml.querySelectorAll("Placemark").forEach(pm=>{
            const name=pm.querySelector("name")?.textContent?.trim()||"";
            const props=name?{name}:{ };
            pm.querySelectorAll(":scope > Point").forEach(n=>{const c=coordinateList(n.querySelector("coordinates"))[0];if(c)features.push({type:"Feature",properties:props,geometry:{type:"Point",coordinates:c}});});
            pm.querySelectorAll(":scope > LineString").forEach(n=>{const c=coordinateList(n.querySelector("coordinates"));if(c.length>=2)features.push({type:"Feature",properties:props,geometry:{type:"LineString",coordinates:c}});});
            pm.querySelectorAll(":scope > Polygon").forEach(n=>{const rings=[...n.querySelectorAll("outerBoundaryIs LinearRing, innerBoundaryIs LinearRing")].map(r=>coordinateList(r.querySelector("coordinates"))).filter(r=>r.length>=4);if(rings.length)features.push({type:"Feature",properties:props,geometry:{type:"Polygon",coordinates:rings}});});
        });
        return {type:"FeatureCollection",features};
    }
    function normalizeImportedGeoJSON(data){
        if(!data||typeof data!=="object")throw new Error("Conteúdo geográfico vazio");
        if(data.type==="FeatureCollection") return {type:"FeatureCollection",features:(data.features||[]).filter(f=>f&&f.geometry)};
        if(data.type==="Feature") return {type:"FeatureCollection",features:[data]};
        if(["Point","MultiPoint","LineString","MultiLineString","Polygon","MultiPolygon"].includes(data.type)) return {type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:data}]};
        throw new Error(`Tipo GeoJSON não suportado: ${data.type||"desconhecido"}`);
    }
    async function refreshGeoData({fitLayerId=null}={}){
        const response=await fetch(cfg.geojsonUrl,{headers:{Accept:"application/json"},cache:"no-store"});
        const text=await response.text();
        if(!response.ok)throw new Error(`GeoJSON HTTP ${response.status}: ${text.slice(0,300)}`);
        try{geojson=JSON.parse(text);}catch(e){console.error("[GeoDesk] JSON inválido ao atualizar Geo",{message:e.message,body:text.slice(0,1000)});throw e;}
        addDataLayers();
        if(fitLayerId){const features=geojson.features.filter(f=>String(f.properties?._layer_id)===String(fitLayerId));if(features.length)fitToGeoJSON(map,{type:"FeatureCollection",features});}
    }

    function updateGeoToolState(){
        if(cfg.public)return;
        const layerType=getSelectedGeoGeometryType();
        ["geo-point","geo-line","geo-polygon"].forEach(tool=>{
            const btn=document.querySelector(`[data-tool="${tool}"]`); if(!btn)return;
            const type=geoToolGeometryType(tool), enabled=Boolean(layerType)&&(layerType==="mixed"||layerType===type); btn.disabled=!enabled;
            btn.title=enabled?`Inserir ${tool==="geo-point"?"ponto":tool==="geo-line"?"linha":"polígono"} na camada selecionada`:(layerType?`Camada de ${layerType==="Point"?"ponto":layerType==="LineString"?"linha":"polígono"}`:"Selecione uma camada Geo");
        });
    }
    function makeGeoLayerRow(layer){
        const row=document.createElement("div");
        row.className="layer-row"; row.dataset.layerId=String(layer.id); row.dataset.layerKind="geo";
        const type=String(layer.geometry_type||layer.style?.geometry_type||"mixed").toLowerCase();
        row.innerHTML=`<span class="layer-grip">⠿</span><button class="layer-visibility ${layer.visible===false?"":"is-visible"}" type="button">${layer.visible===false?"○":"◉"}</button><span class="layer-symbol geo-symbol geo-symbol-${type}" title="${escapeHtml(layer.geometry_type||layer.style?.geometry_type||"Geometria mista")}"></span><span class="layer-name"></span><button class="layer-more" type="button" title="Opções">⋯</button>`;
        row.querySelector(".layer-name").textContent=displayLayerName(layer.name);
        return row;
    }


    function updateLayerRows(){document.querySelectorAll("[data-section='geo'] .layer-row[data-layer-id]").forEach(row=>{const layer=cfg.layers.find(l=>String(l.id)===row.dataset.layerId);if(layer){const btn=row.querySelector(".layer-visibility");btn.textContent=layer.visible===false?"○":"◉";btn.classList.toggle("is-visible",layer.visible!==false);}});}
    function drawingLayerLabel(d,index){ return d.name || (d.type==="text" ? d.text : null) || toolLabel(d.type) || `Desenho ${index+1}`; }
    function drawingSymbolClass(d){ return `drawing-symbol drawing-symbol-${d.type}`; }
    function updateDrawingLayers(){const list=document.getElementById("drawing-layers-list"),count=document.getElementById("drawing-layer-count"),empty=document.getElementById("drawing-empty");if(!list)return;if(count)count.textContent=String(drawings.length);if(empty)empty.style.display=drawings.length?"none":"block";list.querySelectorAll(".drawing-layer-row").forEach(el=>el.remove());drawings.slice().reverse().forEach((d,index)=>{const row=document.createElement("div");row.className="layer-row drawing-layer-row";row.dataset.drawingId=d.id;row.dataset.layerKind="drawing";row.innerHTML=`<span class="layer-grip">⠿</span><button class="layer-visibility ${d.visible===false?"":"is-visible"}" type="button">${d.visible===false?"○":"◉"}</button><span class="layer-symbol ${drawingSymbolClass(d)}"></span><span class="layer-name"></span>${cfg.public?"":"<button class=\"layer-more\" type=\"button\" title=\"Opções\">⋯</button>"}`;row.querySelector(".layer-name").textContent=displayLayerName(drawingLayerLabel(d,index));list.appendChild(row);bindLayerRow(row);row.querySelector(".layer-visibility").addEventListener("click",e=>{e.stopPropagation();d.visible=d.visible===false;saveDrawings();savePublicViewState();renderDrawings();updateDrawingLayers();});});}

    function setupContextMenu(){
        const menu=document.createElement("div");
        menu.id="layer-context-menu"; menu.className="layer-context-menu";
        document.body.appendChild(menu);
        menu.addEventListener("click",async event=>{
            event.preventDefault();
            event.stopPropagation();
            const button=event.target.closest("button[data-action]");
            const action=button?.dataset.action;
            if(!action)return;
            const drawingId=menu.dataset.rowDrawingId||"";
            const row=contextRow || (drawingId ? document.querySelector(`.drawing-layer-row[data-drawing-id="${CSS.escape(drawingId)}"]`) : null);
            const feature=contextFeature, drawingContext=contextDrawing;
            try{
                if(feature)await handleFeatureContextAction(action,feature);
                else if(row)await handleLayerAction(action,row);
                else if(drawingContext)await handleDrawingContextAction(action,drawingContext);
            }catch(error){showHint("Não foi possível executar esta ação.");}
            menu.classList.remove("open");contextRow=null;contextFeature=null;contextDrawing=null;
        });
        document.addEventListener("contextmenu",event=>{
            const row=event.target.closest(".layer-row[data-layer-id], .drawing-layer-row");
            if(row&&document.querySelector(".editor-app")?.contains(row)){
                event.preventDefault();event.stopPropagation();openLayerContextMenu(event.clientX,event.clientY,row);return;
            }
            const drawingEl=event.target.closest?.("[data-drawing-id]");
            if(drawingEl&&editorMode==="drawing"){
                const d=drawings.find(x=>x.id===drawingEl.dataset.drawingId);
                if(d){event.preventDefault();event.stopPropagation();selectDrawing(d);openDrawingContextMenu(event.clientX,event.clientY,d);}
            }
        });
        document.addEventListener("click",closeLayerContextMenu);
    }
    function getLayerContextMenu(){return document.getElementById("layer-context-menu");}
    let contextRow=null;
    let contextDrawing=null;
    function openLayerContextMenu(x,y,row){
        contextRow=row;contextFeature=null;contextDrawing=null;
        const menu=getLayerContextMenu(); if(!menu)return;
        menu.dataset.rowDrawingId=row.dataset.layerKind==="drawing" ? String(row.dataset.drawingId||"") : "";
        menu.dataset.contextKind=row.dataset.layerKind||"";
        menu.dataset.contextId=row.dataset.layerKind==="drawing" ? String(row.dataset.drawingId||"") : String(row.dataset.layerId||"");
        if(cfg.public){
            menu.dataset.rowDrawingId=row.dataset.drawingId||"";
        menu.innerHTML=row.dataset.layerKind==="drawing"?`<button disabled>Somente visualização</button>`:`<button data-action="zoom">Zoom para camada</button><button data-action="table">Visualizar tabela de atributos</button><button data-action="download">Baixar GeoJSON</button>`;
        }else{
            menu.dataset.rowDrawingId=row.dataset.drawingId||"";
        menu.innerHTML=row.dataset.layerKind==="drawing"
                ?`<button data-action="up">Mover para cima</button><button data-action="down">Mover para baixo</button><button data-action="rename">Renomear</button><button data-action="delete" class="danger">Excluir</button>`
                :`<button data-action="zoom">Zoom para camada</button><button data-action="up">Mover para cima</button><button data-action="down">Mover para baixo</button><button data-action="table">Visualizar tabela de atributos</button><button data-action="download">Baixar GeoJSON</button><button data-action="rename">Renomear</button><button data-action="delete" class="danger">Excluir</button>`;
        }
        menu.style.left=`${Math.min(x,window.innerWidth-220)}px`;
        menu.style.top=`${Math.min(y,window.innerHeight-180)}px`;
        menu.classList.add("open");
    }
    function closeLayerContextMenu(){const menu=getLayerContextMenu();if(menu){menu.classList.remove("open");menu.dataset.rowDrawingId="";menu.dataset.contextKind="";menu.dataset.contextId="";}contextRow=null;contextFeature=null;contextDrawing=null;}
    function openDrawingContextMenu(x,y,d){
        contextDrawing=d;contextRow=null;contextFeature=null;
        const menu=getLayerContextMenu();if(!menu)return;
        menu.dataset.rowDrawingId=d?.id?String(d.id):"";
        menu.dataset.contextKind="drawing";
        menu.dataset.contextId=d?.id?String(d.id):"";
        menu.innerHTML=`<button data-action="up">Mover para cima</button><button data-action="down">Mover para baixo</button><button data-action="rename">Renomear</button><button data-action="delete" class="danger">Excluir</button>`;
        menu.style.left=`${Math.min(x,window.innerWidth-220)}px`;menu.style.top=`${Math.min(y,window.innerHeight-180)}px`;menu.classList.add("open");
    }
    async function handleDrawingContextAction(action,d){
        if(!d)return;
        const row=document.querySelector(`[data-drawing-id="${CSS.escape(String(d.id))}"]`);
        if(action==="rename"&&row)startInlineLayerRename(row);
        if(action==="delete")removeDrawings([d.id]);
        if((action==="up"||action==="down")&&row){
            const list=document.getElementById("drawing-layers-list"),rows=[...list?.querySelectorAll(".drawing-layer-row")||[]];
            const index=rows.indexOf(row),target=index+(action==="up"?-1:1),targetRow=rows[target];
            if(index>=0&&targetRow){recordDrawingUndo();if(action==="up")list.insertBefore(row,targetRow);else list.insertBefore(targetRow,row);reorderDrawingsFromList();showHint(action==="up"?"Desenho movido para cima":"Desenho movido para baixo");}
        }
    }
    let contextFeature=null;
    function openGeoFeatureContextMenu(x,y,feature){
        contextFeature=feature;contextRow=null;
        const menu=getLayerContextMenu(); if(!menu)return;
        menu.innerHTML=`<button data-action="zoom">Zoom para feição</button><button data-action="table">Visualizar atributos</button><button data-action="rename-layer">Renomear camada</button><button data-action="delete" class="danger">Excluir feição</button>`;
        menu.style.left=`${Math.min(x,window.innerWidth-220)}px`;
        menu.style.top=`${Math.min(y,window.innerHeight-180)}px`;
        menu.classList.add("open");
    }
    async function handleFeatureContextAction(action,feature){
        if(action==="zoom")fitToGeoJSON(map,{type:"FeatureCollection",features:[feature]});
        if(action==="table")showAttributeTable({type:"FeatureCollection",features:[feature]});
        if(action==="rename-layer"){const row=document.querySelector(`[data-layer-id="${CSS.escape(String(feature.properties?._layer_id||""))}"]`);if(row)handleLayerAction("rename",row);}
        if(action==="delete"){selected={type:"geo",id:String(feature.id||feature.properties?._layer_id),layerId:String(feature.properties?._layer_id||"")};await deleteSelectedGeo();}
    }
    async function handleLayerAction(action,row){
        const id=String(row.dataset.layerId||row.dataset.drawingId||""), kind=row.dataset.layerKind;
        if(kind==="drawing"){
            const d=drawings.find(x=>String(x.id)===id);
            if(!d){return;}
            if(action==="rename"&&!cfg.public){startInlineDrawingRename(row,true);}
            if(action==="delete"){removeDrawing(d.id);return;}
            if((action==="up"||action==="down")&&!cfg.public){
                const ids=[...drawings].map(x=>String(x.id));
                const index=ids.indexOf(String(d.id));
                // A lista visual é exibida em reverse; por isso "up" visualmente significa avançar no array de drawings.
                const target=index+(action==="up"?1:-1);
                if(index>=0&&target>=0&&target<ids.length){
                    recordDrawingUndo();
                    [ids[index],ids[target]]=[ids[target],ids[index]];
                    const byId=new Map(drawings.map(x=>[x.id,x]));
                    drawings=ids.map(id=>byId.get(id)).filter(Boolean);
                    saveDrawings();updateDrawingLayers();renderDrawings();
                    selectedDrawingIds=[d.id];selected={type:"drawing",id:d.id,layerId:null};updateDrawingLayerActiveRows();
                    showHint(action==="up"?"Desenho movido para cima":"Desenho movido para baixo");
                }
            }
            return;
        }
        const layer=cfg.layers.find(l=>String(l.id)===String(id)); if(!layer)return;
        if(action==="rename"&&!cfg.public){
            startInlineLayerRename(row);
        }
        if(action==="delete" && !cfg.public){try{const response=await fetch(`/api/projects/${cfg.projectId}/layers/${id}`,{method:"DELETE"});if(!response.ok)throw new Error();cfg.layers=cfg.layers.filter(l=>String(l.id)!==id);row.remove();addDataLayers();updateDrawingLayers();showHint("Camada removida");}catch(error){console.error("[GeoDesk] Falha ao excluir camada",error);showHint("Não foi possível excluir a camada.");}}
        if(action==="zoom"){const data={type:"FeatureCollection",features:geojson.features.filter(f=>String(f.properties?._layer_id)===String(id))};fitToGeoJSON(map,data);}
        if(action==="table"){const data={type:"FeatureCollection",features:geojson.features.filter(f=>String(f.properties?._layer_id)===String(id))};showAttributeTable(data);}
        if(action==="download") downloadGeoLayer(id, layer.name);
        if((action==="up"||action==="down")&&!cfg.public){moveGeoLayer(row,action==="up"?-1:1);}
    }
    function downloadGeoLayer(layerId, layerName){
        const url=cfg.public ? `/api/public/${cfg.projectId}/layers/${layerId}/geojson` : `/api/projects/${cfg.projectId}/layers/${layerId}/geojson`;
        const a=document.createElement("a"); a.href=url; a.download=`${String(layerName||"camada").replace(/[^\w\-]+/g,"_")}.geojson`; document.body.appendChild(a); a.click(); a.remove();
    }
    function showAttributeTable(data){const modal=document.getElementById("attribute-table-modal"),body=document.getElementById("attribute-table-body"),title=document.getElementById("attribute-table-title");if(!modal||!body)return;const features=data?.features||[];const keys=[...new Set(features.flatMap(f=>Object.keys(f.properties||{}).filter(k=>k!=="_layer_id")))];title.textContent=`Tabela de atributos · ${features.length} feição${features.length===1?"":"s"}`;body.innerHTML="";const table=document.createElement("table");table.className="attribute-table";const thead=document.createElement("thead"),tr=document.createElement("tr");["#",...keys].forEach(k=>{const th=document.createElement("th");th.textContent=k;tr.appendChild(th);});thead.appendChild(tr);table.appendChild(thead);const tbody=document.createElement("tbody");features.forEach((f,i)=>{const row=document.createElement("tr"), first=document.createElement("td");first.textContent=i+1;row.appendChild(first);keys.forEach(k=>{const td=document.createElement("td");const value=f.properties?.[k];td.textContent=typeof value==="object"?JSON.stringify(value):String(value??"");row.appendChild(td);});tbody.appendChild(row);});table.appendChild(tbody);body.appendChild(table);modal.hidden=false;document.body.classList.add("modal-open");}

    function syncDrawingViewport(){
        if(!overlay)return;
        const width=Math.max(1,Number(canvasViewport?.width)||mapEl.clientWidth||window.innerWidth||1);
        const height=Math.max(1,Number(canvasViewport?.height)||mapEl.clientHeight||window.innerHeight||1);
        drawingSourceWidth=width; drawingSourceHeight=height;
        overlay.setAttribute("viewBox",`0 0 ${width} ${height}`);
        overlay.setAttribute("preserveAspectRatio","xMinYMin meet");
    }
    function pointerPosition(event,element){
        const r=element.getBoundingClientRect();
        const sx=drawingSourceWidth>0 ? drawingSourceWidth/Math.max(1,r.width) : 1;
        const sy=drawingSourceHeight>0 ? drawingSourceHeight/Math.max(1,r.height) : 1;
        return{x:Math.max(0,Math.min(drawingSourceWidth||r.width,(event.clientX-r.left)*sx)),y:Math.max(0,Math.min(drawingSourceHeight||r.height,(event.clientY-r.top)*sy))};
    }
    function renderDrawingStylePanel(){
        if(cfg.public)return;
        let panel=document.getElementById("drawing-style-panel");
        if(!panel){
            panel=document.createElement("div"); panel.id="drawing-style-panel"; panel.className="drawing-style-panel";
            panel.innerHTML=`<span class="style-label">Desenho</span>
                <label class="drawing-fill-label">Preenchimento <input id="drawing-fill-color" type="color" value="#ffffff"></label>
                <label class="drawing-border-label">Usar borda <input id="drawing-has-border" type="checkbox" checked></label>
                <label id="drawing-radius-wrap">Arredondar <input id="drawing-radius" type="number" min="0" max="100" step="1" value="0"></label>
                <label id="drawing-font-size-wrap">Tamanho <input id="drawing-font-size" type="number" min="6" max="160" step="1" value="16"></label>
                <label id="drawing-font-family-wrap">Fonte <select id="drawing-font-family"><option>Inter</option><option>Arial</option><option>Georgia</option><option>Verdana</option><option>Courier New</option><option>Times New Roman</option></select></label>
                <label>Borda <input id="drawing-stroke-color" type="color" value="#2f8e45"></label>
                <label>Espessura <input id="drawing-stroke-width" type="number" min="0" max="12" step="1" value="2"></label>
                <button type="button" id="drawing-delete" class="drawing-delete" title="Excluir desenho">Excluir</button>`;
            document.querySelector(".editor-app")?.appendChild(panel);
            panel.querySelectorAll("input,select").forEach(input=>input.addEventListener("input",()=>{
                const d=drawings.find(x=>x.id===selected.id); if(!d||selected.type!=="drawing")return;
                if(input.id==="drawing-fill-color") d.fill=input.value;
                if(input.id==="drawing-has-border"){
                    d.hasStroke=input.checked;
                    if(input.checked && Number(d.strokeWidth)<=0){d.strokeWidth=2;if(d.type==="text")d.textStrokeWidth=2;}
                }
                if(input.id==="drawing-stroke-color") d.stroke=input.value;
                if(input.id==="drawing-stroke-width"){d.strokeWidth=Math.max(0,Number(input.value)||0);if(d.type==="text")d.textStrokeWidth=d.strokeWidth;}
                if(input.id==="drawing-radius")d.radius=Math.max(0,Math.min(100,Number(input.value)||0));
                if(input.id==="drawing-font-size") d.fontSize=Math.max(6,Number(input.value)||16);
                if(input.id==="drawing-font-family") d.fontFamily=input.value;
                if(d.type==="text" && activeTextEditor){
                    activeTextEditor.style.setProperty("color",d.fill||"#1e1e1e","important");
                    activeTextEditor.style.setProperty("font-size",`${d.fontSize||16}px`,`important`);
                    activeTextEditor.style.setProperty("font-family",d.fontFamily||"Inter","important");
                    activeTextEditor.style.setProperty("font-weight",String(d.fontWeight||600),"important");
                    const textStroke=d.hasStroke!==false && d.stroke!=="transparent" ? (d.textStrokeWidth ?? d.strokeWidth ?? 0) : 0;
                    activeTextEditor.style.setProperty("-webkit-text-stroke",`${textStroke}px ${d.stroke||"transparent"}`,"important");
                }
                saveDrawings(); renderDrawings();
            }));
            panel.querySelector("#drawing-delete")?.addEventListener("click",()=>{if(selected.type==="drawing")removeDrawing(selected.id);});
        }
        const d=drawings.find(x=>x.id===selected.id);
        panel?.classList.toggle("visible",!!d&&selected.type==="drawing");
        if(!d)return;
        const fillLabel=panel.querySelector(".drawing-fill-label"); if(fillLabel)fillLabel.childNodes[0].nodeValue=d.type==="text"?"Cor ":"Preenchimento ";
        panel.querySelector("#drawing-fill-color").value=toColor(d.fill,d.type==="text"?"#1e1e1e":"#ffffff");
        panel.querySelector("#drawing-stroke-color").value=toColor(d.stroke,"#2f8e45");
        panel.querySelector("#drawing-has-border").checked=d.hasStroke!==false && d.stroke!=="transparent";
        panel.querySelector("#drawing-stroke-width").value=d.strokeWidth??2;
        panel.querySelector("#drawing-radius").value=d.radius??0;
        panel.querySelector("#drawing-font-size").value=d.fontSize||16;
        panel.querySelector("#drawing-font-family").value=d.fontFamily||"Inter";
        const isText=d.type==="text", isLine=d.type==="line"||d.type==="arrow", isRectangle=d.type==="rectangle";
        panel.querySelector("#drawing-font-size-wrap").style.display=isText?"flex":"none";
        panel.querySelector("#drawing-font-family-wrap").style.display=isText?"flex":"none";
        panel.querySelector("#drawing-fill-color")?.closest(".drawing-fill-label")?.style.setProperty("display",(isLine?"none":"flex"));
        panel.querySelector(".drawing-border-label")?.style.setProperty("display",isText||isRectangle||isLine?"flex":"none");
        panel.querySelector("#drawing-radius-wrap")?.style.setProperty("display",isRectangle?"flex":"none");
        panel.querySelector("#drawing-stroke-color")?.closest("label")?.style.setProperty("display",isLine?"flex":"flex");
    }
    function toColor(value,fallback){const m=String(value||"").match(/^#([0-9a-f]{6})$/i);return m?value:fallback;}

    function setupMeasurePanelDrag(){
        const panel=document.getElementById("measure-panel"),head=panel?.querySelector(".measure-panel-head"),collapse=document.getElementById("measure-minimize");
        if(!panel||!head||panel.dataset.dragReady)return; panel.dataset.dragReady="1";
        collapse?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();panel.classList.toggle("is-minimized");collapse.textContent=panel.classList.contains("is-minimized")?"＋":"−";});
        let drag=null;
        head.addEventListener("pointerdown",e=>{if(e.target.closest("button"))return;const r=panel.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};panel.classList.add("is-dragging");head.setPointerCapture?.(e.pointerId);});
        head.addEventListener("pointermove",e=>{if(!drag)return;panel.style.left=`${Math.max(6,Math.min(window.innerWidth-panel.offsetWidth-6,e.clientX-drag.x))}px`;panel.style.top=`${Math.max(6,Math.min(window.innerHeight-panel.offsetHeight-6,e.clientY-drag.y))}px`;panel.style.bottom="auto";panel.style.transform="none";});
        const end=()=>{drag=null;panel.classList.remove("is-dragging");}; head.addEventListener("pointerup",end);head.addEventListener("pointercancel",end);
    }

    let saveCanvasTimer=null;
    function saveDrawings(){
        if(cfg.public)return;
        clearTimeout(saveCanvasTimer);
        saveCanvasTimer=setTimeout(async()=>{
            try{const response=await fetch(`/api/projects/${cfg.projectId}/canvas`,{method:"PUT",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({drawings,basemap_visible:basemapVisible,camera:savedCamera,viewport:canvasViewport}),cache:"no-store"});if(!response.ok){const body=await response.text();console.error("[GeoDesk] Falha ao salvar desenhos",{status:response.status,body:body.slice(0,1000)});}}catch(e){console.error("[GeoDesk] Erro de rede ao salvar desenhos",e);}
        },120);
    }
    function saveDrawingsStorage(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
    function loadDrawingsLocal(){return[];}
    window.addEventListener("resize",()=>{map.resize();syncDrawingViewport();renderDrawings();renderVertexHandles();});
}

function loadDrawings(key){try{return JSON.parse(localStorage.getItem(key)||"[]");}catch{return[];}}
function saveDrawings(key,drawings){try{localStorage.setItem(key,JSON.stringify(drawings));}catch{}}
function loadImportedLayers(projectId){try{const value=JSON.parse(localStorage.getItem(`geodesk-imported-${projectId}`)||"[]");return Array.isArray(value)?value:[];}catch{return[];}}
function saveImportedLayers(projectId,layers){try{localStorage.setItem(`geodesk-imported-${projectId}`,JSON.stringify(layers));}catch{}}
function toolLabel(tool){return({rectangle:"Retângulo",ellipse:"Elipse",line:"Linha",arrow:"Seta",text:"Texto",image:"Imagem"})[tool]||tool;}
function setLoading(message){const el=document.getElementById("map-loading");if(!el)return;const msg=el.querySelector("small");if(msg)msg.textContent=message;el.classList.remove("hidden");}
function setGeoLoading(message){const el=document.getElementById("geo-loading");if(!el)return;const text=el.querySelector(".geo-loading-text");if(text)text.textContent=message;el.hidden=false;}
function hideGeoLoading(){const el=document.getElementById("geo-loading");if(el)el.hidden=true;}
function hideLoading(){const el=document.getElementById("map-loading");if(el)el.classList.add("hidden");}
function showHint(message){const el=document.getElementById("editor-hint");if(!el)return;el.textContent=message;el.classList.add("visible");clearTimeout(window.__hintTimer);window.__hintTimer=setTimeout(()=>el.classList.remove("visible"),2800);}
function fitToGeoJSON(map,geojson){const coords=[],walk=v=>{if(!Array.isArray(v))return;if(v.length>=2&&typeof v[0]==="number"&&typeof v[1]==="number")coords.push(v);else v.forEach(walk);};(geojson?.features||[]).forEach(f=>walk(f.geometry?.coordinates));if(!coords.length)return;const bounds=coords.reduce((b,c)=>b.extend(c),new mapboxgl.LngLatBounds(coords[0],coords[0]));map.fitBounds(bounds,{padding:90,maxZoom:16,duration:700});}
