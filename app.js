
const App = (() => {
  // ---------- Config ----------
  const SIMPLE_PASSWORD = "MPA";

  function passwordGate() {
    if (!SIMPLE_PASSWORD) return;
    try {
      const ok = localStorage.getItem("gate-ok");
      if (ok === "1") return;
      const input = prompt("Senha:");
      if (input === SIMPLE_PASSWORD) {
        localStorage.setItem("gate-ok", "1");
        return;
      }
      document.body.innerHTML = '<div style="padding:24px;font-family:system-ui">Acesso negado.</div>';
      throw new Error("Acesso negado");
    } catch (e) {
      throw e;
    }
  }

  // ---------- Helpers ----------
  function isDemoStatus(s) {
    if (!s) return false;
    return /\(d\)\s*$/i.test((s||"").toString().trim());
  }
  function cleanStatus(s) {
    return (s||"").toString().replace(/\(d\)\s*$/i, "").trim();
  }
  function parsePtBrFlex(s) {
    if (!s) return "";
    const t = (s||"").toString().trim();
    // dd/mm/yy or dd/mm/yyyy
    const m = t.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{2})(\d{2})?$/);
    if (m) {
      const dd = m[1], mm = m[2];
      let yy = m[3];
      let yyyy = m[4] ? `${m[3]}${m[4]}` : (parseInt(yy,10) >= 70 ? `19${yy}` : `20${yy}`);
      return `${yyyy}-${mm}-${dd}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0,10);
    const m2 = t.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m2) {
      const dd = m2[1], mm = m2[2], yyyy = m2[3];
      return `${yyyy}-${mm}-${dd}`;
    }
    return "";
  }

  // ---------- Data loading ----------
  const CSV_PATH = "./data/solicitacoes.csv";
  const XLSX_PATH = "./data/solicitacoes.xlsx";

  async function loadData() {
    const bust = `?v=${Date.now()}`;
    try {
      const r = await fetch(XLSX_PATH + bust, { cache: "no-store" });
      if (r.ok) {
        const ab = await r.arrayBuffer();
        const wb = XLSX.read(ab, { type: "array" });
        const first = wb.SheetNames[0];
        const sheet = wb.Sheets[first];
        let rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        rows = rows.map(unifyRowKeys).map(normalize);
        return rows;
      }
    } catch(e) {}

    // CSV fallback
    return new Promise((resolve, reject) => {
      Papa.parse(CSV_PATH + bust, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data.map(unifyRowKeys).map(normalize)),
        error: (err) => reject(err)
      });
    });
  }

  function unifyRowKeys(row) {
    const r = { ...row };
    const map = {};
    const normalizeKey = (s) => (s||"").toString().trim()
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/\s+/g,"")
      .replace(/[:;/\\|]+/g,"");
    for (const k of Object.keys(r)) {
      map[normalizeKey(k)] = k;
    }
    function pick() {
      for (let i=0;i<arguments.length;i++) {
        const key = arguments[i];
        const nk = normalizeKey(key);
        if (map[nk] != null) {
          return r[map[nk]];
        }
      }
      return "";
    }

    // Mapear conforme os cabeçalhos comuns da planilha
    const unified = {
      status: pick("status","situacao","situacaoatual","a"),
      transporte: pick("transporte","frete","modal","tipo","b"),
      chassi_lista: pick("chassi","chassis","chassi_lista","g"),
      prazo: pick("previsao","previsão","prazo","h","data prevista","prev","dataentrega"),
      cliente: pick("nota","cliente","j","razao social","nome do cliente","destinatario"),
      solicitante: pick("solicitante","quemsolicitou","k"),
      responsavel: pick("responsavel","responsável","resp"),
      origem: pick("esta","estaem","está","está em","origem","de","l"),
      destino: pick("vai","vaipara","vai para","destino","para","m"),
      maps_url: pick("maps_url","maps","linkmaps","mapa","googlemaps","o","p"),
      form_url: pick("form_url","forms","form","link","url","o","p"),
      tipo_simplificado: pick("tipo_simplificado","tiposimp","tipobase","tipo"),
      filial: pick("filial","loja","unidade"),
      id_externo: pick("id_externo","id"),
      actions: pick("actions","acao","acoes")
    };

    if (!unified.cliente) unified.cliente = pick("nota");
    return unified;
  }

  function normalize(row) {
    const r = { ...row };
    const rawS = (r.status || "").toString().trim();
    r.statusNorm = cleanStatus(rawS).toUpperCase();
    r.isDemo = isDemoStatus(rawS);
    r.tipo_simplificado = (r.tipo_simplificado || "MAQ").toUpperCase();

    const pISO = parsePtBrFlex(r.prazo);
    r.prazoISO = pISO;
    r.prazoLabel = pISO ? dayjs(pISO).locale('pt-br').format("DD/MM/YYYY") : "—";
    r.cliente = r.cliente || "";
    return r;
  }

  function bestLink(x) {
    const candidates = [
      x.maps_url, x.form_url, x.linkmaps, x.link, x.url
    ].filter(v => typeof v === "string" && /^https?:\/\//i.test(v));

    if (candidates.length) {
      const mapsFirst = candidates.find(u => /maps\.google|goo\.gl\/maps|waze\.com/i.test(u));
      return mapsFirst || candidates[0];
    }
    for (const k in x) {
      const v = x[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
    return "";
  }

  // ---------- Painel ----------
  async function renderPainel() {
    const data = await loadData();
    const statsEl = document.getElementById("stats");
    const kanbanEl = document.getElementById("kanban");

    const filtered = data;

    const counts = {
      "RECEBIDO": filtered.filter(x => x.statusNorm === "RECEBIDO").length,
      "PROGRAMADO": filtered.filter(x => x.statusNorm === "PROGRAMADO").length,
      "EM ROTA": filtered.filter(x => x.statusNorm === "EM ROTA").length,
      "CONCLUIDO": filtered.filter(x => x.statusNorm === "CONCLUIDO").length,
    };

    const statCfg = [
      ["RECEBIDO", "badge slate"],
      ["PROGRAMADO", "badge amber"],
      ["EM ROTA", "badge blue"],
      ["CONCLUIDO", "badge green"],
    ];

    statsEl.innerHTML = statCfg.map(([label, klass]) => `
      <div class="card stat">
        <h3>${label}</h3>
        <div class="num">${counts[label] || 0}</div>
      </div>
    `).join("");

    const groups = {
      "RECEBIDO": filtered.filter(x => x.statusNorm === "RECEBIDO" && !x.isDemo),
      "PROGRAMADO": filtered.filter(x => x.statusNorm === "PROGRAMADO" && !x.isDemo),
      "EM ROTA": filtered.filter(x => x.statusNorm === "EM ROTA" && !x.isDemo),
    };

    kanbanEl.innerHTML = ["RECEBIDO","PROGRAMADO","EM ROTA"].map(label => {
      const items = groups[label];
      const list = items.map(x => cardItem(x)).join("");
      return `
        <div class="col">
          <div class="head">
            <div><span class="${statCfg.find(s=>s[0]===label)[1]}">${label}</span></div>
            <div class="count">${items.length}</div>
          </div>
          <div class="list">${list || '<div class="small muted">Nada aqui.</div>'}</div>
        </div>
      `;
    }).join("");
  }

  function cardItem(x) {
    const rota = `<span>${x.origem || "—"}</span> <span class="small">→</span> <span>${x.destino || "—"}</span>`;
    const link = bestLink(x);
    return `
      <div class="item">
        <div class="row"><strong>${x.filial || "—"}</strong><span class="small">•</span><span>${x.cliente || "—"}</span></div>
        ${x.chassi_lista ? `<div class="mono">${x.chassi_lista}</div>` : ""}
        <div class="row">${rota}</div>
        <div class="row small"><span>Previsão:</span><strong>${x.prazoLabel}</strong></div>
        <div class="row">${link ? `<a class="small" href="${link}" target="_blank" rel="noopener">Abrir</a>` : '<span class="small muted">Sem link</span>'}</div>
      </div>
    `;
  }

  // ---------- Calendário ----------
  async function renderCalendario() { showSemanal(); }

  async function showSemanal() {
    const data = await loadData();
    const el = document.getElementById("calendar");
    const monday = dayjs().startOf('week').add(1,'day');
    const days = Array.from({length:6}, (_,i)=> monday.add(i,'day'));
    const pend = data.filter(x => x.prazoISO && x.statusNorm !== "CONCLUIDO");

    el.innerHTML = days.map(d => {
      const list = pend.filter(x => dayjs(x.prazoISO).isSame(d,'day'));
      const items = list.map(x => {
        const chassi = x.chassi_lista || "—";
        const cliente = x.cliente || "—";
        return `<div class="item"><div class="mono">${chassi}</div><div class="small">${cliente}</div></div>`;
      }).join("");
      return `
        <div class="card">
          <div class="row" style="justify-content: space-between; margin-bottom: 8px">
            <div>
              <div class="small muted">${d.locale('pt-br').format('dddd')}</div>
              <div style="font-weight:700; font-size:20px">${d.format('DD/MM')}</div>
            </div>
            <div class="badge slate">${list.length} item(ns)</div>
          </div>
          <div>${items || '<div class="small muted">Nada</div>'}</div>
        </div>
      `;
    }).join("");

    const tabs = document.querySelectorAll("#tabs-cal .tab");
    if (tabs.length) { tabs[0].classList.add("active"); tabs[1].classList.remove("active"); }
  }

  async function showMensal() {
    const data = await loadData();
    const el = document.getElementById("calendar");
    const start = dayjs().startOf('month');
    const end = dayjs().endOf('month');
    const list = data.filter(x => x.prazoISO && x.statusNorm === "CONCLUIDO" && dayjs(x.prazoISO).isBetween(start, end, 'day', '[]'));
    const byDay = {};
    list.forEach(x => {
      const k = dayjs(x.prazoISO).format("YYYY-MM-DD");
      byDay[k] = byDay[k] || [];
      byDay[k].push(x);
    });
    const numDays = end.date();
    el.innerHTML = Array.from({length:numDays}, (_,i)=>{
      const d = start.date(i+1);
      const k = d.format("YYYY-MM-DD");
      const arr = byDay[k] || [];
      const items = arr.map(x => `<div class="mono">${x.chassi_lista || "—"}</div>`).join("");
      return `
        <div class="card">
          <div class="row" style="justify-content: space-between; margin-bottom: 8px">
            <div>
              <div class="small muted">${d.locale('pt-br').format('ddd')}</div>
              <div style="font-weight:700; font-size:20px">${d.format('DD')}</div>
            </div>
            <div class="badge slate">${arr.length}</div>
          </div>
          <div>${items || '<div class="small muted">—</div>'}</div>
        </div>
      `;
    }).join("");

    const tabs = document.querySelectorAll("#tabs-cal .tab");
    if (tabs.length) { tabs[0].classList.remove("active"); tabs[1].classList.add("active"); }
  }

  // ---------- Solicitações Registradas ----------
  async function renderRegistradas() {
    const data = await loadData();
    const table = document.getElementById("reg-table");

    if (!document.getElementById("reg-toolbar")) {
      const wrap = table.parentElement;
      const tb = document.createElement("div");
      tb.className = "toolbar";
      tb.id = "reg-toolbar";
      tb.innerHTML = `
        <div class="field"><label>Chassi</label><input id="reg-chassi" placeholder="Buscar chassi"/></div>
        <div class="field"><label>Cliente</label><input id="reg-cliente" placeholder="Buscar cliente"/></div>
        <div class="field"><label>Mês</label><input id="reg-mes" type="month"/></div>
        <div class="field"><label>Status</label>
          <select id="reg-status">
            <option value="">Todos</option>
            <option>RECEBIDO</option>
            <option>PROGRAMADO</option>
            <option>EM ROTA</option>
          </select>
        </div>
      `;
      wrap.parentElement.insertBefore(tb, wrap);
      tb.addEventListener("input", ()=> renderRegistradas());
      tb.addEventListener("change", ()=> renderRegistradas());
    }

    const chassiQ = (document.getElementById("reg-chassi")?.value || "").toLowerCase();
    const clienteQ = (document.getElementById("reg-cliente")?.value || "").toLowerCase();
    const mesQ = document.getElementById("reg-mes")?.value || "";
    const statusQ = (document.getElementById("reg-status")?.value || "").toUpperCase();

    const list = data
      .filter(x => !x.isDemo)
      .filter(x => x.statusNorm !== "CONCLUIDO")
      .filter(x => !statusQ || x.statusNorm === statusQ)
      .filter(x => !chassiQ || (x.chassi_lista || "").toLowerCase().includes(chassiQ))
      .filter(x => !clienteQ || (x.cliente || "").toLowerCase().includes(clienteQ))
      .filter(x => !mesQ || (x.prazoISO && x.prazoISO.slice(0,7) === mesQ));

    const rows = list.map(x => {
      const link = bestLink(x);
      return `<tr>
        <td>${x.prazoLabel}</td>
        <td>${x.solicitante || "—"}</td>
        <td>${x.cliente || "—"}</td>
        <td><div class="mono">${x.chassi_lista || "—"}</div></td>
        <td>${x.origem || "—"}</td>
        <td>${x.destino || "—"}</td>
        <td>${x.transporte || "—"}</td>
        <td>${x.statusNorm || "—"}</td>
        <td style="text-align:center">${link ? `<a href="${link}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td>
      </tr>`;
    }).join("");

    table.innerHTML = `
      <thead>
        <tr>
          <th>PREVISÃO</th><th>SOLICITANTE</th><th>CLIENTE/NOTA</th><th>CHASSI</th><th>ESTÁ EM</th><th>VAI PARA</th><th>TRANSPORTADO POR</th><th>STATUS</th><th>LOC/th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">Nenhuma solicitação encontrada.</td></tr>`}</tbody>
    `;
  }

  // ---------- Concluídos ----------
  async function renderConcluidas() {
    const data = await loadData();
    const table = document.getElementById("conc-table");

    if (!document.getElementById("conc-toolbar")) {
      const wrap = table.parentElement;
      const tb = document.createElement("div");
      tb.className = "toolbar";
      tb.id = "conc-toolbar";
      tb.innerHTML = `
        <div class="field"><label>Chassi</label><input id="conc-chassi" placeholder="Buscar chassi"/></div>
        <div class="field"><label>Cliente</label><input id="conc-cliente" placeholder="Buscar cliente"/></div>
        <div class="field"><label>Mês</label><input id="conc-mes" type="month"/></div>
      `;
      wrap.parentElement.insertBefore(tb, wrap);
      tb.addEventListener("input", ()=> renderConcluidas());
      tb.addEventListener("change", ()=> renderConcluidas());
    }

    const chassiQ = (document.getElementById("conc-chassi")?.value || "").toLowerCase();
    const clienteQ = (document.getElementById("conc-cliente")?.value || "").toLowerCase();
    const mesQ = document.getElementById("conc-mes")?.value || "";

    const list = data
      .filter(x => !x.isDemo)
      .filter(x => x.statusNorm === "CONCLUIDO")
      .filter(x => !chassiQ || (x.chassi_lista || "").toLowerCase().includes(chassiQ))
      .filter(x => !clienteQ || (x.cliente || "").toLowerCase().includes(clienteQ))
      .filter(x => !mesQ || (x.prazoISO && x.prazoISO.slice(0,7) === mesQ))
      .sort((a,b) => (b.prazoISO||"") < (a.prazoISO||"") ? -1 : 1);

    const rows = list.map(x => {
      const link = bestLink(x);
      return `<tr>
        <td>${x.prazoLabel}</td>
        <td>${x.solicitante || "—"}</td>
        <td>${x.cliente || "—"}</td>
        <td><div class="mono">${x.chassi_lista || "—"}</div></td>
        <td>${x.origem || "—"}</td>
        <td>${x.destino || "—"}</td>
        <td>${x.transporte || "—"}</td>
        <td>${x.statusNorm || "—"}</td>
        <td style="text-align:center">${link ? `<a href="${link}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td>
      </tr>`;
    }).join("");

    table.innerHTML = `
      <thead>
        <tr>
          <th>PREVISÃO</th><th>SOLICITANTE</th><th>CLIENTE/NOTA</th><th>CHASSI</th><th>ESTÁ EM</th><th>VAI PARA</th><th>TRANSPORTADO POR</th><th>STATUS</th><th>LOC/th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">Nada concluído encontrado.</td></tr>`}</tbody>
    `;
  }

  // ---------- Demonstrações ----------
  async function renderDemo() {
    const data = await loadData();
    const table = document.getElementById("demo-table");

    if (!document.getElementById("demo-toolbar")) {
      const wrap = table.parentElement;
      const tb = document.createElement("div");
      tb.className = "toolbar";
      tb.id = "demo-toolbar";
      tb.innerHTML = `
        <div class="field"><label>Chassi</label><input id="demo-chassi" placeholder="Buscar chassi"/></div>
        <div class="field"><label>Cliente</label><input id="demo-cliente" placeholder="Buscar cliente"/></div>
        <div class="field"><label>Mês</label><input id="demo-mes" type="month"/></div>
      `;
      wrap.parentElement.insertBefore(tb, wrap);
      tb.addEventListener("input", ()=> renderDemo());
      tb.addEventListener("change", ()=> renderDemo());
    }

    const chassiQ = (document.getElementById("demo-chassi")?.value || "").toLowerCase();
    const clienteQ = (document.getElementById("demo-cliente")?.value || "").toLowerCase();
    const mesQ = document.getElementById("demo-mes")?.value || "";

    const list = data
      .filter(x => x.isDemo)
      .filter(x => !chassiQ || (x.chassi_lista || "").toLowerCase().includes(chassiQ))
      .filter(x => !clienteQ || (x.cliente || "").toLowerCase().includes(clienteQ))
      .filter(x => !mesQ || (x.prazoISO && x.prazoISO.slice(0,7) === mesQ));

    const rows = list.map(x => {
      const link = bestLink(x);
      return `<tr>
        <td>${x.prazoLabel}</td>
        <td>${x.solicitante || "—"}</td>
        <td>${x.cliente || "—"}</td>
        <td><div class="mono">${x.chassi_lista || "—"}</div></td>
        <td>${x.origem || "—"}</td>
        <td>${x.destino || "—"}</td>
        <td>${x.transporte || "—"}</td>
        <td>${x.statusNorm || "—"} (D)</td>
        <td style="text-align:center">${link ? `<a href="${link}" target="_blank" rel="noopener">Abrir</a>` : "—"}</td>
      </tr>`;
    }).join("");

    table.innerHTML = `
      <thead>
        <tr>
          <th>PREVISÃO</th><th>SOLICITANTE</th><th>CLIENTE/NOTA</th><th>CHASSI</th><th>ESTÁ EM</th><th>VAI PARA</th><th>TRANSPORTADO POR</th><th>STATUS</th><th>LOC/th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">Nenhuma demonstração.</td></tr>`}</tbody>
    `;
  }

  return { gate: passwordGate, renderPainel, renderCalendario, showSemanal, showMensal, renderRegistradas, renderConcluidas, renderDemo };
})();
