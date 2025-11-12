
const App = (() => {
  const CSV_PATH = "./data/solicitacoes.csv";

  const STATUS_MAP = {
    "REGISTRADO": "Registrado",
    "PROGRAMADO": "Programado",
    "EM ROTA": "Em rota",
    "CONCLUIDO": "Concluído",
    "CONCLUÍDO": "Concluído",
  };

  function titleCase(s) {
    return (s || "").toString().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function normalize(row) {
    const r = { ...row };
    // Normalize status to the 4 buckets
    const rawStatus = (r.status || "").toString().trim().toUpperCase();
    r.statusNorm = STATUS_MAP[rawStatus] || titleCase(r.status || "Registrado");

    // Tipo simplificado: MAQ/PECA; default MAQ if not present
    r.tipo_simplificado = (r.tipo_simplificado || "MAQ").toUpperCase();

    // Dates
    r.prazo = (r.prazo || "").toString().slice(0, 10); // YYYY-MM-DD

    return r;
  }

  function loadCSV() {
    return new Promise((resolve, reject) => {
      Papa.parse(CSV_PATH, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data.map(normalize)),
        error: (err) => reject(err)
      });
    });
  }

  // ---------- Painel ----------

  async function renderPainel() {
    const data = await loadCSV();
    const statsEl = document.getElementById("stats");
    const kanbanEl = document.getElementById("kanban");

    const filtered = data; // apply top-level filters here if needed

    const counts = {
      "Registrado": filtered.filter(x => x.statusNorm === "Registrado").length,
      "Programado": filtered.filter(x => x.statusNorm === "Programado").length,
      "Em rota": filtered.filter(x => x.statusNorm === "Em rota").length,
      "Concluído": filtered.filter(x => x.statusNorm === "Concluído").length,
    };

    const statCfg = [
      ["Registrado", "badge slate"],
      ["Programado", "badge amber"],
      ["Em rota", "badge blue"],
      ["Concluído", "badge green"],
    ];

    // Stats
    statsEl.innerHTML = statCfg.map(([label, klass]) => `
      <div class="card stat">
        <h3>${label}</h3>
        <div class="num">${counts[label] || 0}</div>
      </div>
    `).join("");

    // Kanban columns
    const groups = {
      "Registrado": filtered.filter(x => x.statusNorm === "Registrado"),
      "Programado": filtered.filter(x => x.statusNorm === "Programado"),
      "Em rota": filtered.filter(x => x.statusNorm === "Em rota"),
      "Concluído": filtered.filter(x => x.statusNorm === "Concluído"),
    };

    kanbanEl.innerHTML = ["Registrado","Programado","Em rota","Concluído"].map(label => {
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
    const prazo = x.prazo ? dayjs(x.prazo).locale('pt-br').format("DD/MM/YYYY") : "—";
    const rota = `<span>${x.origem || "—"}</span> <span class="small">→</span> <span>${x.destino || "—"}</span>`;
    const formLink = x.form_url ? `<a class="small" href="${x.form_url}" target="_blank" rel="noopener">Abrir</a>` : '<span class="small muted">Sem link</span>';

    return `
      <div class="item">
        <div class="row"><strong>${x.filial || "—"}</strong><span class="small">•</span><span>${x.cliente || "—"}</span></div>
        ${x.chassi_lista ? `<div class="mono">${x.chassi_lista}</div>` : ""}
        <div class="row">${rota}</div>
        <div class="row small"><span>Prazo:</span><strong>${prazo}</strong></div>
        <div class="row">${formLink}</div>
      </div>
    `;
  }

  // ---------- Calendário ----------

  async function renderCalendario() {
    const data = await loadCSV();
    const el = document.getElementById("calendar");
    const today = dayjs().startOf('week').add(1, 'day'); // Monday
    const days = Array.from({length: 7}, (_,i) => today.add(i, 'day'));

    // Only pending (not concluded) with a prazo
    const pend = data.filter(x => x.statusNorm !== "Concluído" && x.prazo);

    const cols = days.map(d => {
      const list = pend.filter(x => dayjs(x.prazo).isSame(d, 'day'));
      const items = list.map(cardItem).join("");

      return `
        <div class="card">
          <div class="row" style="justify-content: space-between; margin-bottom: 8px">
            <div>
              <div class="small muted">${d.locale('pt-br').format('dddd')}</div>
              <div style="font-weight:700; font-size:20px">${d.format('DD')}</div>
            </div>
            <div class="badge slate">${list.length} item(ns)</div>
          </div>
          <div>${items || '<div class="small muted">Nada</div>'}</div>
        </div>
      `;
    }).join("");

    el.innerHTML = cols;
  }

  // ---------- Máquinas ----------

  async function renderMaquinas(q="") {
    const data = await loadCSV();
    const table = document.getElementById("maq-table");
    const qn = (q || "").toLowerCase();

    const list = data
      .filter(x => x.tipo_simplificado === "MAQ" && x.statusNorm !== "Concluído")
      .filter(x => !q || [x.chassi_lista, x.cliente, x.destino].some(v => (v||"").toLowerCase().includes(qn)));

    const rows = list.map(x => {
      const prazo = x.prazo ? dayjs(x.prazo).locale('pt-br').format("DD/MM/YYYY") : "—";
      const rota = `${x.origem || "—"} → ${x.destino || "—"}`;
      const link = x.form_url ? `<a href="${x.form_url}" target="_blank" rel="noopener">Abrir</a>` : '—';
      return `<tr>
        <td>${x.filial || "—"}</td>
        <td>${x.cliente || "—"}</td>
        <td><div class="mono">${x.chassi_lista || "—"}</div></td>
        <td>${rota}</td>
        <td>${prazo}</td>
        <td>${x.responsavel || "—"}</td>
        <td>${x.statusNorm}</td>
        <td style="text-align:center">${link}</td>
      </tr>`;
    }).join("");

    table.innerHTML = `
      <thead>
        <tr>
          <th>Filial</th><th>Cliente</th><th>Chassis</th><th>Rota</th><th>Prazo</th><th>Responsável</th><th>Status</th><th class="center">Ação</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="8" class="muted">Nenhuma máquina encontrada.</td></tr>`}</tbody>
    `;
  }

  // ---------- Concluídas ----------

  async function renderConcluidas(q="") {
    const data = await loadCSV();
    const table = document.getElementById("conc-table");
    const qn = (q || "").toLowerCase();

    const list = data
      .filter(x => x.statusNorm === "Concluído")
      .filter(x => !q || [x.chassi_lista, x.cliente, x.destino, x.filial].some(v => (v||"").toLowerCase().includes(qn)));

    const rows = list.map(x => {
      const prazo = x.prazo ? dayjs(x.prazo).locale('pt-br').format("DD/MM/YYYY") : "—";
      const rota = `${x.origem || "—"} → ${x.destino || "—"}`;
      const link = x.form_url ? `<a href="${x.form_url}" target="_blank" rel="noopener">Abrir</a>` : '—';
      return `<tr>
        <td>${(x.tipo_simplificado || '').toUpperCase()}</td>
        <td>${x.filial || "—"}</td>
        <td>${x.cliente || "—"}</td>
        <td><div class="mono">${x.chassi_lista || "—"}</div></td>
        <td>${rota}</td>
        <td>${prazo}</td>
        <td>${x.responsavel || "—"}</td>
        <td>${x.statusNorm}</td>
        <td style="text-align:center">${link}</td>
      </tr>`;
    }).join("");

    table.innerHTML = `
      <thead>
        <tr>
          <th>Tipo</th><th>Filial</th><th>Cliente</th><th>Chassis</th><th>Rota</th><th>Prazo</th><th>Responsável</th><th>Status</th><th class="center">Ação</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="9" class="muted">Nada concluído encontrado.</td></tr>`}</tbody>
    `;
  }

  return { renderPainel, renderCalendario, renderMaquinas, renderConcluidas };
})();
