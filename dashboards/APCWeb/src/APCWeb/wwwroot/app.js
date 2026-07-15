"use strict";
// UI de APCWeb — replica el flujo de frmMain (selección → importar → grilla → editar → exportar)

const $ = id => document.getElementById(id);
let estado = { tab: "tabProveedor", filtro: 5, perfil: "", seleccionado: false, importado: false };

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { mostrarLogin(); throw new Error("Sesión expirada"); }
  const data = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) throw new Error(data?.error || "Error " + r.status);
  return data;
}
const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function mostrarLogin() { $("login").classList.remove("oculto"); $("appUI").classList.add("oculto"); }
function mostrarApp() { $("login").classList.add("oculto"); $("appUI").classList.remove("oculto"); }

// ---------------- LOGIN ----------------
$("btnLogin").onclick = async () => {
  $("lMsg").textContent = "";
  try {
    const d = await post("/api/login", { usuario: $("lUsuario").value, password: $("lPass").value });
    estado.perfil = d.perfil;
    await iniciar();
  } catch (e) { $("lMsg").textContent = e.message; }
};
$("lPass").addEventListener("keydown", e => { if (e.key === "Enter") $("btnLogin").click(); });
$("btnLogout").onclick = async () => { await post("/api/logout", {}); location.reload(); };

// ---------------- INICIO ----------------
async function iniciar() {
  const est = await api("/api/estado");
  estado.perfil = est.perfil;
  $("hUsuario").textContent = est.usuario;
  $("hPerfil").textContent = est.perfil;
  $("hVersion").textContent = est.version || "1.0.0";
  mostrarApp();

  const esAdmin = est.perfil === "Administrador";
  $("tabLiquiBtn").disabled = !esAdmin;
  $("tabRebajaBtn").disabled = !esAdmin;

  avisoReglas(est);
  await cargarCombos();
}

function avisoReglas(est) {
  const l = $("lblReglas");
  const mal = estado.tab === "tabLiquidación" || estado.tab === "tabRebaja" ? est.reglaLiquiDesactivada : est.reglaDesactivada;
  l.textContent = mal ? "UNA REGLA DE VALIDACIÓN DESACTIVADA" : "REGLAS DE VALIDACIONES ACTIVAS.";
  l.className = "avisoReglas " + (mal ? "mal" : "ok");
}

function llenar(sel, filas, campo) {
  sel.innerHTML = "";
  for (const f of filas) {
    const o = document.createElement("option");
    o.value = o.textContent = f[campo] ?? "";
    sel.appendChild(o);
  }
}

async function cargarCombos() {
  const [provs, marcas] = await Promise.all([api("/api/proveedores"), api("/api/marcas")]);
  llenar($("cmbProveedoresP"), provs, "NOMPROV");
  llenar($("cmbMarcaM"), marcas, "NOMMARCA");
  await marcasDeProveedor();
  await proveedoresDeMarca();
}

async function marcasDeProveedor() {
  const p = $("cmbProveedoresP").value;
  if (!p) return;
  llenar($("cmbMarcaP"), await api("/api/marcas-por-proveedor?proveedor=" + encodeURIComponent(p)), "NOMMARCA");
}
async function proveedoresDeMarca() {
  const m = $("cmbMarcaM").value;
  if (!m) return;
  llenar($("cmbProveedoresM"), await api("/api/proveedores-por-marca?marca=" + encodeURIComponent(m)), "NOMPROV");
}
$("cmbProveedoresP").onchange = marcasDeProveedor;
$("cmbMarcaM").onchange = proveedoresDeMarca;

// ---------------- TABS ----------------
$("tabs").addEventListener("click", async e => {
  const b = e.target.closest("button[data-tab]");
  if (!b || b.disabled) return;
  document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("act", x === b));
  estado.tab = b.dataset.tab;
  estado.seleccionado = false; estado.importado = false;

  const esLiqui = estado.tab === "tabLiquidación" || estado.tab === "tabRebaja";
  document.querySelectorAll(".selPanel").forEach(p => p.classList.add("oculto"));
  $(esLiqui ? "selLiqui" : estado.tab === "tabMarca" ? "selMarca" : "selProveedor").classList.remove("oculto");
  $("filtros").classList.toggle("oculto", esLiqui);
  $("filtrosLiqui").classList.toggle("oculto", !esLiqui);
  $("chkNoInfBox").classList.toggle("oculto", esLiqui);
  $("lblSeleccion").textContent = esLiqui ? (estado.tab === "tabLiquidación" ? "LIQUIDACIÓN" : "REBAJA") : "SIN SELECCION";
  $("btnImportar").disabled = !esLiqui;   // en Liqui/Rebaja se importa directo, como la Desktop
  if (esLiqui) {
    estado.seleccionado = true;
    await post("/api/seleccionar", { tab: estado.tab, proveedor: "", marca: "" });
  }
  limpiarGrilla();
  const est = await api("/api/estado");
  avisoReglas(est);
});

$("rgbLiqui").onchange = async () => {
  const v = $("rgbLiqui").value;
  $("liquiValorBox").classList.toggle("oculto", v === "0");
  if (v === "1") { $("liquiValorLbl").textContent = "Empresa"; llenar($("cmbLiqui"), await api("/api/empresas"), "Empresa"); }
  if (v === "2") { $("liquiValorLbl").textContent = "Sucursal"; llenar($("cmbLiqui"), await api("/api/sucursales"), "nomSucursal"); }
};

// ---------------- SELECCIÓN ----------------
async function seleccionar(prov, marca, etiqueta) {
  await post("/api/seleccionar", { tab: estado.tab, proveedor: prov, marca });
  $("lblSeleccion").textContent = etiqueta;
  estado.seleccionado = true;
  $("btnImportar").disabled = false;
}
$("btnSeleccionarP").onclick = () => {
  const p = $("cmbProveedoresP").value, m = $("cmbMarcaP").value;
  seleccionar(p, m, m ? `Proveedor: ${p} - Marca: ${m}` : `Proveedor: ${p} - Marca: SIN MARCA`);
};
$("btnSeleccionarM").onclick = () => {
  const p = $("cmbProveedoresM").value, m = $("cmbMarcaM").value;
  seleccionar(p, m, `Proveedor: ${p} - Marca: ${m}`);
};

// ---------------- IMPORTAR ----------------
$("btnImportar").onclick = async () => {
  const f = $("fArchivo").files[0];
  if (!f) { $("mImportar").textContent = "Seleccioná un archivo .xlsx"; $("mImportar").className = "msg err"; return; }
  $("mImportar").textContent = "Importando y validando... (puede demorar)"; $("mImportar").className = "msg";
  $("btnImportar").disabled = true;
  try {
    const fd = new FormData();
    fd.append("archivo", f);
    fd.append("noInformados", $("swtNoInformados").checked);
    fd.append("liquiModo", $("rgbLiqui").value);
    fd.append("liquiValor", $("cmbLiqui").value || "");
    const d = await api("/api/importar", { method: "POST", body: fd });
    estado.importado = true;
    actualizarContadores(d.contadores);
    $("mImportar").className = "msg " + (d.errores.length ? "err" : "ok");
    $("mImportar").textContent = d.errores.length ? ("Importado con avisos: " + d.errores.slice(0, 5).join(" | ")) : "Importado y validado.";
    estado.filtro = (estado.tab === "tabLiquidación" || estado.tab === "tabRebaja") ? 0 : 5;
    await cargarGrilla();
    habilitarAcciones(d.contadores);
  } catch (e) {
    $("mImportar").textContent = e.message; $("mImportar").className = "msg err";
  } finally { $("btnImportar").disabled = false; }
};

function habilitarAcciones(c) {
  const esLiqui = estado.tab === "tabLiquidación" || estado.tab === "tabRebaja";
  if (esLiqui) {
    $("btnExportar").disabled = !(c.okLiqui > 0);
    $("btnEnviarFail").disabled = !(c.errorLiqui > 0);
    $("btnNoInformados").disabled = true;
    $("btnLiquiLista").disabled = true;
    $("btnEnviarTodo").disabled = true;
    $("btnMasivo").disabled = true;
  } else {
    $("btnExportar").disabled = !estado.importado;
    $("btnEnviarFail").disabled = !estado.importado;
    $("btnEnviarTodo").disabled = !estado.importado;
    $("btnNoInformados").disabled = !(c.noInformado > 0);
    $("btnLiquiLista").disabled = !estado.importado || estado.tab === "tabMultimarca";
    $("btnMasivo").disabled = !(estado.filtro === 1 || estado.filtro === 3);
  }
}

// ---------------- CONTADORES / FILTROS ----------------
function actualizarContadores(c) {
  $("cOk").textContent = c.ok; $("cFail").textContent = c.fail;
  $("cNotFound").textContent = c.notFound; $("cNoInf").textContent = c.noInformado;
  $("cSinCambio").textContent = c.sinCambios; $("cTotal").textContent = c.total;
  $("cOkL").textContent = c.okLiqui; $("cErrL").textContent = c.errorLiqui;
}

for (const cont of ["filtros", "filtrosLiqui"]) {
  $(cont).addEventListener("click", async e => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    document.querySelectorAll("#" + cont + " button").forEach(x => x.classList.toggle("act", x === b));
    estado.filtro = parseInt(b.dataset.f, 10);
    await cargarGrilla();
    $("btnMasivo").disabled = !(estado.filtro === 1 || estado.filtro === 3) || (cont === "filtrosLiqui");
  });
}

// ---------------- GRILLA ----------------
function limpiarGrilla() {
  $("grilla").querySelector("thead").innerHTML = "";
  $("grilla").querySelector("tbody").innerHTML = "";
  $("mAccion").textContent = "";
  actualizarContadores({ ok: 0, fail: 0, notFound: 0, noInformado: 0, sinCambios: 0, total: 0, okLiqui: 0, errorLiqui: 0 });
}

// Columnas visibles del GridView de la Desktop (frmMain.Designer.vb), en su
// mismo orden (VisibleIndex 0..13). Regla1..7, MARCA, Usuario, Fecha, OBS y
// $ CONF# existen en los datos pero NO se muestran, igual que en la Desktop.
const COLUMNAS_GRILLA = [
  { f: "Seccion", c: "Sección" },
  { f: "CODIGO", c: "Código" },
  { f: "DESCRIPCION", c: "Descripción" },
  { f: "Nombre", c: "Nombre" },
  { f: "CostoAnt", c: "Costo Ant." },
  { f: "Costo EV", c: "Costo Nvo." },
  { f: "IncCosto", c: "% Incremento Costo" },
  { f: "PVPAnt", c: "PVP Ant." },
  { f: "$ PUBL#", c: "PVP Nvo." },
  { f: "IncPVP", c: "% Incremento PVP" },
  { f: "Margen", c: "Margen" },
  { f: "PerTarifa", c: "Periodo" },
  { f: "EstadoPVP", c: "Estado PVP" },
  { f: "Estado", c: "Estado" }
];

async function cargarGrilla() {
  if (!estado.importado) return;
  const d = await api("/api/grilla?filtro=" + estado.filtro);
  actualizarContadores(d.contadores);

  const thead = $("grilla").querySelector("thead");
  const tbody = $("grilla").querySelector("tbody");
  const esLiqui = estado.tab === "tabLiquidación" || estado.tab === "tabRebaja";
  const editable = !esLiqui && (estado.filtro === 1 || estado.filtro === 3);

  // La grilla Liqui de la Desktop muestra todas las columnas; la principal, solo las 14 definidas
  const cols = esLiqui
    ? d.columnas.map(c => ({ f: c, c: c }))
    : COLUMNAS_GRILLA;

  thead.innerHTML = "<tr>" + (editable ? "<th></th>" : "") + cols.map(c => `<th>${c.c || "&nbsp;"}</th>`).join("") + "</tr>";
  tbody.innerHTML = "";

  for (const fila of d.filas) {
    const tr = document.createElement("tr");
    const est = fila["Estado"] ?? fila["ESTADO"] ?? "";
    tr.className = est === "OK" ? "estOK" : est === "No Informado" ? "estNI" : est && est !== "Sin Cambio" ? "estERR" : "";
    let tds = "";
    if (editable) {
      tds += `<td><button class="b" style="padding:2px 8px;font-size:11px" data-editar="${fila["CODIGO"] ?? ""}">Editar</button></td>`;
    }
    for (const c of cols) tds += `<td>${fila[c.f] ?? ""}</td>`;
    tr.innerHTML = tds;
    tbody.appendChild(tr);
  }
}

$("grilla").addEventListener("click", async e => {
  const b = e.target.closest("button[data-editar]");
  if (!b) return;
  const codigo = b.dataset.editar;
  const costo = prompt(`Código ${codigo} — nuevo Costo EV:`);
  if (costo === null) return;
  const pvp = prompt(`Código ${codigo} — nuevo $ PUBL#:`);
  if (pvp === null) return;
  try {
    const d = await post("/api/editar", {
      codigo,
      costo: costo === "" ? null : parseFloat(costo.replace(",", ".")),
      pvp: pvp === "" ? null : parseFloat(pvp.replace(",", "."))
    });
    actualizarContadores(d.contadores);
    await cargarGrilla();
    habilitarAcciones(d.contadores);
  } catch (err) { $("mAccion").textContent = err.message; $("mAccion").className = "msg err"; }
});

$("btnMasivo").onclick = async () => {
  const costo = prompt("Ingrese valor del Costo Nuevo:");
  if (costo === null || costo === "") { alert("Operación Anulada..!"); return; }
  const pvp = prompt("Ingrese valor del PVP Nuevo:");
  if (pvp === null || pvp === "") { alert("Operación Anulada..!"); return; }
  try {
    const d = await post("/api/masivo", {
      costo: parseFloat(costo.replace(",", ".")),
      pvp: parseFloat(pvp.replace(",", ".")),
      filtro: estado.filtro
    });
    actualizarContadores(d.contadores);
    await cargarGrilla();
    habilitarAcciones(d.contadores);
  } catch (err) { $("mAccion").textContent = err.message; $("mAccion").className = "msg err"; }
};

// ---------------- ACCIONES ----------------
async function accion(url, etiqueta) {
  $("mAccion").textContent = etiqueta + "..."; $("mAccion").className = "msg";
  try {
    const d = await post(url, {});
    $("mAccion").className = "msg ok";
    $("mAccion").textContent = d.mensaje || (d.archivos ? "Generado: " + d.archivos.join(" · ") : d.archivo ? "Generado: " + d.archivo : "Listo.");
  } catch (e) { $("mAccion").textContent = e.message; $("mAccion").className = "msg err"; }
}
$("btnExportar").onclick = () => accion("/api/exportar", "Exportando CSV");
$("btnNoInformados").onclick = () => accion("/api/no-informados", "Exportando No Informados");
$("btnLiquiLista").onclick = () => accion("/api/liqui-lista", "Exportando LIQUIs");
$("btnEnviarFail").onclick = () => accion("/api/enviar-fail", "Enviando errores");
$("btnEnviarTodo").onclick = () => accion("/api/enviar-todo", "Enviando TODO");
$("btnCancel").onclick = async () => { await post("/api/cancelar", {}); estado.importado = false; estado.seleccionado = false; $("lblSeleccion").textContent = "SIN SELECCION"; limpiarGrilla(); };

// arranque: si hay cookie válida entra directo
iniciar().catch(() => mostrarLogin());
