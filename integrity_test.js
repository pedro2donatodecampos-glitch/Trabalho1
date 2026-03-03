const mysql = require('mysql2/promise');
const http = require('http');

const DB_CONFIG = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'restaurante_db'
};

const BASE_URL = 'http://localhost:3000';

function requestJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(path, BASE_URL);

    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const results = [];
function pass(name, details = '') {
  results.push({ ok: true, name, details });
}
function fail(name, details = '') {
  results.push({ ok: false, name, details });
}

async function run() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    pass('DB connection', 'Conectado ao MySQL');
  } catch (err) {
    fail('DB connection', err.message);
    printAndExit();
    return;
  }

  try {
    const [tablesRows] = await conn.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = ?`,
      [DB_CONFIG.database]
    );
    const existingTables = new Set(tablesRows.map((r) => r.table_name));

    const expectedTables = [
      'usuarios',
      'produtos',
      'categorias',
      'subcategorias',
      'mesas',
      'pagamentos',
      'compras',
      'insumos',
      'perdas_estoque',
      'fluxo_caixa',
      'fornecedores',
      'reservas',
      'movimentacoes_estoque',
      'caixa',
      'avaliacoes',
      'despesas',
      'audit_log',
      'alertas',
      'cardapio_config',
      'metas',
      'pedidos_balcao',
      'pedidos_delivery'
    ];

    const missing = expectedTables.filter((t) => !existingTables.has(t));
    if (missing.length) {
      fail('Expected tables', `Faltando: ${missing.join(', ')}`);
    } else {
      pass('Expected tables', `${expectedTables.length} tabelas encontradas`);
    }

    const [fkRows] = await conn.query(
      `SELECT
          kcu.table_name,
          kcu.column_name,
          kcu.referenced_table_name,
          kcu.referenced_column_name,
          kcu.constraint_name
       FROM information_schema.key_column_usage kcu
       WHERE kcu.table_schema = ?
         AND kcu.referenced_table_name IS NOT NULL`,
      [DB_CONFIG.database]
    );

    if (fkRows.length === 0) {
      pass('FK integrity', 'Sem FKs declaradas para validar');
    } else {
      let fkFailures = 0;
      for (const fk of fkRows) {
        const sql = `SELECT COUNT(*) AS c
          FROM \`${fk.table_name}\` t
          LEFT JOIN \`${fk.referenced_table_name}\` r
            ON t.\`${fk.column_name}\` = r.\`${fk.referenced_column_name}\`
          WHERE t.\`${fk.column_name}\` IS NOT NULL
            AND r.\`${fk.referenced_column_name}\` IS NULL`;
        const [rows] = await conn.query(sql);
        const count = Number(rows[0]?.c || 0);
        if (count > 0) {
          fkFailures++;
          fail(
            `FK ${fk.constraint_name}`,
            `${fk.table_name}.${fk.column_name} -> ${fk.referenced_table_name}.${fk.referenced_column_name}: ${count} órfãos`
          );
        }
      }
      if (fkFailures === 0) {
        pass('FK integrity', `${fkRows.length} relacionamentos sem órfãos`);
      }
    }

    const [dupMesas] = await conn.query(
      `SELECT numero_mesa, COUNT(*) c
       FROM mesas
       GROUP BY numero_mesa
       HAVING COUNT(*) > 1`
    );
    if (dupMesas.length > 0) {
      fail('Mesas unique check', `Duplicadas: ${dupMesas.map((d) => d.numero_mesa).join(', ')}`);
    } else {
      pass('Mesas unique check', 'Sem duplicidade em numero_mesa');
    }

    const [negEstoque] = await conn.query(
      `SELECT COUNT(*) c FROM insumos WHERE COALESCE(estoque_atual,0) < 0`
    );
    if (Number(negEstoque[0].c) > 0) {
      fail('Estoque check', `${negEstoque[0].c} insumo(s) com estoque negativo`);
    } else {
      pass('Estoque check', 'Sem estoque negativo');
    }
  } catch (err) {
    fail('DB integrity checks', err.message);
  }

  try {
    const endpoints = [
      '/api/mesas',
      '/api/fornecedores',
      '/api/reservas',
      '/api/estoque/movimentacoes',
      '/api/caixa/status',
      '/api/avaliacoes',
      '/api/despesas',
      '/api/auditoria',
      '/api/alertas',
      '/api/cardapio',
      '/api/metas',
      '/api/balcao',
      '/api/delivery',
      '/api/atendimento/resumo',
      '/api/atendimento/fila?limite=10',
      '/api/relatorio-gerencial'
    ];

    for (const ep of endpoints) {
      const response = await requestJson('GET', ep);
      if (response.status >= 200 && response.status < 300) {
        pass(`API ${ep}`, `HTTP ${response.status}`);
      } else {
        fail(`API ${ep}`, `HTTP ${response.status}`);
      }
    }

    const relatorio = await requestJson('GET', '/api/relatorio-gerencial');
    const requiredKeys = ['vendas', 'compras', 'despesas_mes', 'mesas', 'balcao_hoje', 'delivery_hoje'];
    if (relatorio.status === 200 && relatorio.data && requiredKeys.every((k) => k in relatorio.data)) {
      pass('Relatório payload', 'Campos essenciais presentes');
    } else {
      fail('Relatório payload', `Campos ausentes: ${requiredKeys.filter((k) => !(k in (relatorio.data || {}))).join(', ')}`);
    }

    const atendimentoResumo = await requestJson('GET', '/api/atendimento/resumo');
    const atendimentoResumoKeys = ['balcao_abertos', 'delivery_abertos', 'total_abertos', 'faturamento_hoje'];
    if (atendimentoResumo.status === 200 && atendimentoResumo.data && atendimentoResumoKeys.every((k) => k in atendimentoResumo.data)) {
      pass('Atendimento resumo payload', 'Campos essenciais presentes');
    } else {
      fail('Atendimento resumo payload', `Campos ausentes: ${atendimentoResumoKeys.filter((k) => !(k in (atendimentoResumo.data || {}))).join(', ')}`);
    }

    const atendimentoFila = await requestJson('GET', '/api/atendimento/fila?limite=10');
    if (atendimentoFila.status === 200 && Array.isArray(atendimentoFila.data)) {
      pass('Atendimento fila payload', `Lista recebida com ${atendimentoFila.data.length} item(ns)`);
    } else {
      fail('Atendimento fila payload', `Status ${atendimentoFila.status}`);
    }

    const balcaoCreate = await requestJson('POST', '/api/balcao', {
      cliente_nome: 'Teste Integridade',
      itens_json: JSON.stringify([{ nome: 'Item Teste' }]),
      valor_total: 9.9,
      forma_pagamento: 'pix',
      status: 'aberto',
      usuario: 'integrity_test'
    });

    if (balcaoCreate.status === 200 && balcaoCreate.data?.id) {
      const bid = balcaoCreate.data.id;
      const balcaoStatus = await requestJson('PUT', `/api/balcao/${bid}/status`, {
        status: 'finalizado',
        usuario: 'integrity_test'
      });
      const balcaoDelete = await requestJson('DELETE', `/api/balcao/${bid}`);

      if (balcaoStatus.status === 200 && balcaoDelete.status === 200) {
        pass('Balcão write flow', `create/update/delete id=${bid}`);
      } else {
        fail('Balcão write flow', `status=${balcaoStatus.status}, delete=${balcaoDelete.status}`);
      }
    } else {
      fail('Balcão write flow', `create status=${balcaoCreate.status}`);
    }

    const deliveryCreate = await requestJson('POST', '/api/delivery', {
      cliente_nome: 'Teste Delivery',
      telefone: '11999999999',
      endereco: 'Rua Teste, 10',
      bairro: 'Centro',
      itens_json: JSON.stringify([{ nome: 'Pizza Teste' }]),
      valor_total: 29.9,
      taxa_entrega: 5,
      forma_pagamento: 'dinheiro',
      status: 'recebido',
      usuario: 'integrity_test'
    });

    if (deliveryCreate.status === 200 && deliveryCreate.data?.id) {
      const did = deliveryCreate.data.id;
      const deliveryStatus = await requestJson('PUT', `/api/delivery/${did}/status`, {
        status: 'entregue',
        usuario: 'integrity_test'
      });
      const deliveryDelete = await requestJson('DELETE', `/api/delivery/${did}`);

      if (deliveryStatus.status === 200 && deliveryDelete.status === 200) {
        pass('Delivery write flow', `create/update/delete id=${did}`);
      } else {
        fail('Delivery write flow', `status=${deliveryStatus.status}, delete=${deliveryDelete.status}`);
      }
    } else {
      fail('Delivery write flow', `create status=${deliveryCreate.status}`);
    }
  } catch (err) {
    fail('API integrity checks', err.message);
  }

  if (conn) await conn.end();
  printAndExit();
}

function printAndExit() {
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;

  console.log('\n=== RELATÓRIO DE INTEGRIDADE ===');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${r.details ? ` | ${r.details}` : ''}`);
  }
  console.log('-------------------------------');
  console.log(`TOTAL: ${results.length} | PASS: ${ok} | FAIL: ${bad}`);

  process.exit(bad > 0 ? 1 : 0);
}

run();
