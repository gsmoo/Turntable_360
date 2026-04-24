import './style.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="layout">
    <section class="hero-card">
      <p class="eyebrow">Visualizador local</p>
      <h1>Tu hoja de Google Sheets con look inspirado en +Móvil.</h1>
      <p class="hero-copy">
        Sube un archivo exportado desde Google Sheets en formato CSV y lo mostramos al instante,
        adaptado a m&oacute;vil y con una tabla c&oacute;moda para navegar.
      </p>

      <div class="upload-panel">
        <label class="upload-button" for="sheet-file">
          <span>Seleccionar archivo</span>
          <input id="sheet-file" type="file" accept=".csv,text/csv,.txt,.tsv,text/tab-separated-values" />
        </label>
        <p class="upload-help">
          Recomendado: <strong>Archivo &gt; Descargar &gt; Valores separados por comas (.csv)</strong> en Google Sheets.
        </p>
      </div>

      <dl class="stats" aria-live="polite">
        <div class="stat">
          <dt>Archivo</dt>
          <dd data-file-name>Sin cargar</dd>
        </div>
        <div class="stat">
          <dt>Filas</dt>
          <dd data-row-count>0</dd>
        </div>
        <div class="stat">
          <dt>Columnas</dt>
          <dd data-column-count>0</dd>
        </div>
      </dl>
    </section>

    <section class="table-shell">
      <div class="table-topbar">
        <div>
          <p class="table-kicker">Vista previa</p>
          <h2>Tabla cargada</h2>
        </div>
        <button class="sample-button" type="button">Cargar ejemplo</button>
      </div>

      <div class="feedback" data-feedback>
        La tabla aparecer&aacute; aqu&iacute; cuando subas un CSV.
      </div>

      <div class="table-wrap" data-table-wrap hidden>
        <table class="sheet-table" data-sheet-table></table>
      </div>
    </section>
  </main>
`;

const fileInput = app.querySelector('#sheet-file');
const sampleButton = app.querySelector('.sample-button');
const feedback = app.querySelector('[data-feedback]');
const tableWrap = app.querySelector('[data-table-wrap]');
const table = app.querySelector('[data-sheet-table]');
const fileNameValue = app.querySelector('[data-file-name]');
const rowCountValue = app.querySelector('[data-row-count]');
const columnCountValue = app.querySelector('[data-column-count]');

const sampleCsv = `Producto,Categoria,Precio,Stock,Canal
Tarifa 50 GB,Movil,24.90,Disponible,Web
Fibra 600 Mb,Fibra,29.90,Disponible,Tienda
Combo Casa + Movil,Convergente,39.90,Oferta,Call center
Roaming Europa,Extra,4.99,Disponible,App`;

fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files ?? [];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const rows = parseDelimitedText(text);
    renderTable(rows, file.name);
  } catch (error) {
    showError('No hemos podido leer ese archivo. Prueba con un CSV exportado desde Google Sheets.');
    console.error(error);
  }
});

sampleButton.addEventListener('click', () => {
  const rows = parseDelimitedText(sampleCsv);
  renderTable(rows, 'ejemplo-plus-movil.csv');
});

function parseDelimitedText(text) {
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!normalizedText) {
    throw new Error('Archivo vacio');
  }

  const firstLine = normalizedText.split('\n', 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const rows = [];
  let currentCell = '';
  let currentRow = [];
  let insideQuotes = false;

  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index];
    const nextCharacter = normalizedText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (character === delimiter && !insideQuotes) {
      currentRow.push(cleanCell(currentCell));
      currentCell = '';
      continue;
    }

    if (character === '\n' && !insideQuotes) {
      currentRow.push(cleanCell(currentCell));
      rows.push(currentRow);
      currentCell = '';
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  currentRow.push(cleanCell(currentCell));
  rows.push(currentRow);

  return rows.filter((row) => row.some((cell) => cell !== ''));
}

function detectDelimiter(line) {
  const candidates = [',', ';', '\t'];
  let selected = ',';
  let highestScore = -1;

  candidates.forEach((candidate) => {
    const score = line.split(candidate).length;

    if (score > highestScore) {
      highestScore = score;
      selected = candidate;
    }
  });

  return selected;
}

function cleanCell(value) {
  return value.trim();
}

function renderTable(rows, fileName) {
  if (!rows.length || rows.every((row) => row.length === 0)) {
    showError('El archivo no contiene datos visibles.');
    return;
  }

  const [headerRow, ...bodyRows] = rows;
  const columnCount = Math.max(...rows.map((row) => row.length));

  feedback.hidden = true;
  tableWrap.hidden = false;

  fileNameValue.textContent = fileName;
  rowCountValue.textContent = String(bodyRows.length);
  columnCountValue.textContent = String(columnCount);

  table.innerHTML = '';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  normalizeRow(headerRow, columnCount).forEach((cellValue) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = cellValue || 'Columna';
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');

  bodyRows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');

    normalizeRow(row, columnCount).forEach((cellValue, columnIndex) => {
      const td = document.createElement('td');
      td.dataset.label = headerRow[columnIndex] || `Columna ${columnIndex + 1}`;
      td.textContent = cellValue || '—';

      if (columnIndex === 0) {
        td.classList.add('primary-cell');
      }

      tr.appendChild(td);
    });

    if (rowIndex % 2 === 1) {
      tr.classList.add('is-striped');
    }

    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
}

function normalizeRow(row, columnCount) {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? '');
}

function showError(message) {
  feedback.hidden = false;
  feedback.textContent = message;
  tableWrap.hidden = true;
  table.innerHTML = '';
  fileNameValue.textContent = 'Sin cargar';
  rowCountValue.textContent = '0';
  columnCountValue.textContent = '0';
}
