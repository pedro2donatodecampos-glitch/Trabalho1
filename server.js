const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'restaurante_db'
});

db.connect(err => {
    if (err) {
        console.error('Erro ao conectar:', err);
        return;
    }
    console.log('Conectado ao MySQL!');
});

function obterDiasPeriodo(periodo) {
    const valor = String(periodo || '7').toLowerCase();
    if (valor === '1' || valor === 'hoje') return 1;
    if (valor === '30') return 30;
    return 7;
}

function obterColunasTabela(nomeTabela) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT COLUMN_NAME
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = ?
            ORDER BY ORDINAL_POSITION
        `;

        db.query(sql, [nomeTabela], (err, rows) => {
            if (err) return reject(err);
            resolve((rows || []).map(row => row.COLUMN_NAME));
        });
    });
}

function escolherColuna(colunas, candidatas) {
    return candidatas.find(coluna => colunas.includes(coluna)) || null;
}

function obterFonteCozinhaSql(alias = 'cozinha_base') {
    return `
        (
            SELECT
                numero_mesa,
                prato,
                COALESCE(minutos_espera, 0) as minutos_espera,
                'pedido' as origem
            FROM v_pedidos_atrasados

            UNION ALL

            SELECT
                lm.numero_mesa,
                lm.item_nome as prato,
                TIMESTAMPDIFF(MINUTE, lm.criado_em, NOW()) as minutos_espera,
                'lancamento_mesa' as origem
            FROM lancamentos_mesa lm
        ) ${alias}
    `;
}

app.get('/api/lucratividade', (req, res) => {
    const sql = 'SELECT * FROM v_lucratividade_produtos';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/dashboard', (req, res) => {
    const sql = 'SELECT * FROM v_lucratividade_produtos';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/novo-pedido', (req, res) => {
    const { id_produto, quantidade } = req.body;
    console.log(`Pedido recebido: Produto ${id_produto}, Qtd: ${quantidade}`);
    res.send('Pedido registrado com sucesso!');
});

app.get('/api/validade', (req, res) => {
    const query = 'SELECT * FROM v_alerta_validade';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/mesas', (req, res) => {
    const query = 'SELECT * FROM mesas';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/login', (req, res) => {
    const { login, senha } = req.body;
    const sql = 'SELECT * FROM usuarios WHERE login = ? AND senha = ?';

    db.query(sql, [login, senha], (err, results) => {
        if (err) return res.status(500).json(err);
        if (results.length > 0) {
            res.json({ success: true, user: results[0].login, nivel: results[0].nivel });
        } else {
            res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });
        }
    });
});

app.get('/api/vendas-hoje', (req, res) => {
    const sql = `
        SELECT
            COALESCE(SUM(valor_pago), 0) as total,
            COALESCE(AVG(valor_pago), 0) as ticket_medio
        FROM pagamentos
        WHERE DATE(data_pagamento) = CURDATE()
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0]);
    });
});

app.get('/api/resumo-geral', (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM produtos) as total_produtos,
            (SELECT COUNT(*) FROM mesas WHERE status = 'ocupada') as mesas_ocupadas,
            (SELECT COUNT(*) FROM usuarios) as total_usuarios
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || { total_produtos: 0, mesas_ocupadas: 0, total_usuarios: 0 });
    });
});

app.get('/api/dashboard/detalhes', (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM mesas WHERE LOWER(COALESCE(status, '')) = 'ocupada') as mesas_ocupadas,
            (SELECT COUNT(*) FROM mesas WHERE LOWER(COALESCE(status, '')) = 'livre') as mesas_livres,
            (SELECT COUNT(*) FROM ${obterFonteCozinhaSql('cozinha_base')}) as pedidos_atrasados,
            (SELECT COUNT(*) FROM usuarios) as total_usuarios,
            (SELECT COUNT(*) FROM usuarios WHERE LOWER(COALESCE(nivel, '')) = 'admin') as usuarios_admin,
            (SELECT COUNT(*) FROM usuarios WHERE LOWER(COALESCE(nivel, '')) = 'operador') as usuarios_operador
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || {
            mesas_ocupadas: 0,
            mesas_livres: 0,
            pedidos_atrasados: 0,
            total_usuarios: 0,
            usuarios_admin: 0,
            usuarios_operador: 0
        });
    });
});

app.get('/api/cozinha/resumo', (req, res) => {
    const minEspera = Math.min(Math.max(Number(req.query.min_espera || 0), 0), 120);
    const mesa = Number(req.query.mesa || 0);
    const possuiMesa = Number.isInteger(mesa) && mesa > 0;
    const prato = String(req.query.prato || '').trim().toLowerCase();
    const somenteCriticos = String(req.query.somente_criticos || '0') === '1';

    const where = ['COALESCE(minutos_espera, 0) >= ?'];
    const params = [minEspera];

    if (somenteCriticos) {
        where.push('COALESCE(minutos_espera, 0) >= 15');
    }
    if (possuiMesa) {
        where.push('numero_mesa = ?');
        params.push(mesa);
    }
    if (prato) {
        where.push('LOWER(COALESCE(prato, "")) LIKE ?');
        params.push(`%${prato}%`);
    }

    const sql = `
        SELECT
            COUNT(*) as total_pedidos_atrasados,
            COALESCE(AVG(minutos_espera), 0) as media_minutos_espera,
            COALESCE(MAX(minutos_espera), 0) as maior_espera,
            COALESCE(SUM(CASE WHEN minutos_espera >= 15 THEN 1 ELSE 0 END), 0) as pedidos_criticos
        FROM ${obterFonteCozinhaSql('cozinha_base')}
        WHERE ${where.join(' AND ')}
    `;

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || {
            total_pedidos_atrasados: 0,
            media_minutos_espera: 0,
            maior_espera: 0,
            pedidos_criticos: 0
        });
    });
});

app.get('/api/produtos/resumo', (req, res) => {
    const sql = `
        SELECT
            SUM(CASE WHEN COALESCE(ativo, 1) = 1 THEN 1 ELSE 0 END) as produtos_ativos,
            SUM(CASE WHEN COALESCE(ativo, 1) = 0 THEN 1 ELSE 0 END) as produtos_inativos,
            COALESCE(SUM(COALESCE(estoque_atual, 0)), 0) as estoque_total,
            SUM(CASE WHEN COALESCE(eh_pesado, 0) = 1 THEN 1 ELSE 0 END) as produtos_por_peso
        FROM produtos
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || {
            produtos_ativos: 0,
            produtos_inativos: 0,
            estoque_total: 0,
            produtos_por_peso: 0
        });
    });
});

app.get('/api/operacoes/resumo', (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM log_estornos WHERE DATE(data_hora) = CURDATE()) as estornos_hoje,
            (SELECT COUNT(*) FROM log_cancelamentos WHERE DATE(data_hora) = CURDATE()) as cancelamentos_hoje,
            (SELECT COUNT(*) FROM log_estornos) as estornos_total,
            (SELECT COUNT(*) FROM log_cancelamentos) as cancelamentos_total
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || {
            estornos_hoje: 0,
            cancelamentos_hoje: 0,
            estornos_total: 0,
            cancelamentos_total: 0
        });
    });
});

app.get('/api/operacoes/historico', (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limite || 20), 5), 100);
    const tipo = String(req.query.tipo || 'todos').trim().toLowerCase();
    const periodo = obterDiasPeriodo(req.query.periodo || '7');
    const usuarioId = Number(req.query.usuario_id || 0);
    const idComanda = Number(req.query.id_comanda || 0);
    const motivo = String(req.query.motivo || '').trim().toLowerCase();

    const where = [`t.data_hora >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)`];
    const params = [];

    if (['estorno', 'cancelamento'].includes(tipo)) {
        where.push('t.tipo = ?');
        params.push(tipo);
    }
    if (usuarioId > 0) {
        where.push('t.usuario_id = ?');
        params.push(usuarioId);
    }
    if (idComanda > 0) {
        where.push('t.id_comanda = ?');
        params.push(idComanda);
    }
    if (motivo) {
        where.push('LOWER(COALESCE(t.motivo, "")) LIKE ?');
        params.push(`%${motivo}%`);
    }

    const sql = `
        SELECT
            t.tipo,
            t.id_comanda,
            t.item,
            t.quantidade,
            t.motivo,
            t.usuario_id,
            t.data_hora,
            u.login as usuario_login
        FROM (
            SELECT
                'estorno' as tipo,
                id_comanda,
                produto_nome as item,
                COALESCE(quantidade, 0) as quantidade,
                motivo,
                usuario_id,
                data_hora
            FROM log_estornos
            UNION ALL
            SELECT
                'cancelamento' as tipo,
                id_comanda,
                item_nome as item,
                0 as quantidade,
                motivo,
                usuario_id,
                data_hora
            FROM log_cancelamentos
        ) t
        LEFT JOIN usuarios u ON u.id_usuario = t.usuario_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.data_hora DESC
        LIMIT ?
    `;

    params.push(limite);
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/operacoes/analitico', (req, res) => {
    const periodo = obterDiasPeriodo(req.query.periodo || '7');

    const sqlResumo = `
        SELECT
            COUNT(*) as total_operacoes,
            SUM(CASE WHEN tipo = 'estorno' THEN 1 ELSE 0 END) as total_estornos,
            SUM(CASE WHEN tipo = 'cancelamento' THEN 1 ELSE 0 END) as total_cancelamentos,
            COUNT(DISTINCT usuario_id) as usuarios_ativos,
            COUNT(DISTINCT id_comanda) as comandas_afetadas
        FROM (
            SELECT 'estorno' as tipo, usuario_id, id_comanda, data_hora FROM log_estornos
            UNION ALL
            SELECT 'cancelamento' as tipo, usuario_id, id_comanda, data_hora FROM log_cancelamentos
        ) t
        WHERE t.data_hora >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)
    `;

    const sqlMotivos = `
        SELECT
            motivo,
            COUNT(*) as total
        FROM (
            SELECT motivo, data_hora FROM log_estornos
            UNION ALL
            SELECT motivo, data_hora FROM log_cancelamentos
        ) t
        WHERE t.data_hora >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)
        GROUP BY motivo
        ORDER BY total DESC
        LIMIT 7
    `;

    const sqlUsuarios = `
        SELECT
            t.usuario_id,
            COALESCE(u.login, CONCAT('Usuário ', t.usuario_id)) as login,
            SUM(CASE WHEN t.tipo = 'estorno' THEN 1 ELSE 0 END) as estornos,
            SUM(CASE WHEN t.tipo = 'cancelamento' THEN 1 ELSE 0 END) as cancelamentos,
            COUNT(*) as total
        FROM (
            SELECT 'estorno' as tipo, usuario_id, data_hora FROM log_estornos
            UNION ALL
            SELECT 'cancelamento' as tipo, usuario_id, data_hora FROM log_cancelamentos
        ) t
        LEFT JOIN usuarios u ON u.id_usuario = t.usuario_id
        WHERE t.data_hora >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)
        GROUP BY t.usuario_id, u.login
        ORDER BY total DESC
        LIMIT 10
    `;

    db.query(sqlResumo, (errResumo, resumoRows) => {
        if (errResumo) return res.status(500).json(errResumo);

        db.query(sqlMotivos, (errMotivos, motivosRows) => {
            if (errMotivos) return res.status(500).json(errMotivos);

            db.query(sqlUsuarios, (errUsuarios, usuariosRows) => {
                if (errUsuarios) return res.status(500).json(errUsuarios);

                res.json({
                    resumo: resumoRows[0] || {
                        total_operacoes: 0,
                        total_estornos: 0,
                        total_cancelamentos: 0,
                        usuarios_ativos: 0,
                        comandas_afetadas: 0
                    },
                    top_motivos: motivosRows || [],
                    operacoes_por_usuario: usuariosRows || []
                });
            });
        });
    });
});

app.get('/api/usuarios/resumo', (req, res) => {
    const sql = `
        SELECT
            COUNT(*) as total_usuarios,
            SUM(CASE WHEN LOWER(COALESCE(nivel, '')) = 'admin' THEN 1 ELSE 0 END) as admins,
            SUM(CASE WHEN LOWER(COALESCE(nivel, '')) = 'operador' THEN 1 ELSE 0 END) as operadores
        FROM usuarios
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || { total_usuarios: 0, admins: 0, operadores: 0 });
    });
});

app.get('/api/usuarios/lista', (req, res) => {
    const sql = `
        SELECT id_usuario, login, nivel
        FROM usuarios
        ORDER BY login
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/sistema/atividade-recente', (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limite || 20), 5), 100);
    const tipo = String(req.query.tipo || 'todos').trim().toLowerCase();
    const tiposPermitidos = ['pagamento', 'compra', 'estorno', 'cancelamento'];
    const usarFiltroTipo = tiposPermitidos.includes(tipo);
    const sql = `
        SELECT tipo, referencia, descricao, valor, data_hora
        FROM (
            SELECT
                'pagamento' as tipo,
                CONCAT('Comanda ', id_comanda) as referencia,
                CONCAT('Pagamento via ', COALESCE(metodo, '-')) as descricao,
                COALESCE(valor_pago, 0) as valor,
                data_pagamento as data_hora
            FROM pagamentos

            UNION ALL

            SELECT
                'compra' as tipo,
                CONCAT('NF ', COALESCE(numero_nota_fiscal, '-')) as referencia,
                'Registro de compra' as descricao,
                COALESCE(valor_total_nota, 0) as valor,
                data_compra as data_hora
            FROM compras

            UNION ALL

            SELECT
                'estorno' as tipo,
                CONCAT('Comanda ', id_comanda) as referencia,
                CONCAT('Estorno: ', COALESCE(produto_nome, '-')) as descricao,
                0 as valor,
                data_hora
            FROM log_estornos

            UNION ALL

            SELECT
                'cancelamento' as tipo,
                CONCAT('Comanda ', id_comanda) as referencia,
                CONCAT('Cancelamento: ', COALESCE(item_nome, '-')) as descricao,
                0 as valor,
                data_hora
            FROM log_cancelamentos
        ) t
        ${usarFiltroTipo ? 'WHERE tipo = ?' : ''}
        ORDER BY data_hora DESC
        LIMIT ?
    `;

    const params = usarFiltroTipo ? [tipo, limite] : [limite];
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/financeiro/mix-metodos', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo);
    const condicaoData = dias === 1
        ? 'DATE(data_pagamento) = CURDATE()'
        : `data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;

    const sql = `
        SELECT
            CASE
                WHEN LOWER(TRIM(COALESCE(metodo, ''))) IN ('debito', 'débito', 'cartao debito', 'cartão débito', 'cartao de debito', 'cartão de débito') THEN 'Cartão Débito'
                WHEN LOWER(TRIM(COALESCE(metodo, ''))) IN ('credito', 'crédito', 'cartao credito', 'cartão crédito', 'cartao de credito', 'cartão de crédito') THEN 'Cartão Crédito'
                WHEN LOWER(TRIM(COALESCE(metodo, ''))) = 'pix' THEN 'PIX'
                ELSE 'Outros'
            END as forma,
            COALESCE(SUM(valor_pago), 0) as total
        FROM pagamentos
        WHERE ${condicaoData}
        GROUP BY forma
        ORDER BY total DESC
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        const totalGeral = results.reduce((acc, row) => acc + Number(row.total || 0), 0);
        const dados = results.map(row => ({
            forma: row.forma,
            total: Number(row.total || 0),
            percentual: totalGeral > 0 ? (Number(row.total || 0) / totalGeral) * 100 : 0
        }));
        res.json(dados);
    });
});

app.get('/api/financeiro/indicadores-avancados', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo || '7');
    const condPagamentos = dias === 1
        ? 'DATE(data_pagamento) = CURDATE()'
        : `data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;
    const condCompras = dias === 1
        ? 'DATE(data_compra) = CURDATE()'
        : `data_compra >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;
    const condPerdas = dias === 1
        ? 'DATE(data_registro) = CURDATE()'
        : `data_registro >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;
    const condFluxo = dias === 1
        ? 'DATE(data_movimento) = CURDATE()'
        : `data_movimento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;

    const sql = `
        SELECT
            (SELECT COALESCE(SUM(valor_pago), 0) FROM pagamentos WHERE ${condPagamentos}) as vendas,
            (SELECT COALESCE(SUM(valor_total_nota), 0) FROM compras WHERE ${condCompras}) as compras,
            (SELECT COALESCE(SUM(valor_prejuizo_estimado), 0) FROM perdas_estoque WHERE ${condPerdas}) as perdas_valor,
            (SELECT COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) FROM fluxo_caixa WHERE ${condFluxo}) as despesas_fluxo,
            (SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END), 0) FROM fluxo_caixa WHERE ${condFluxo}) as entradas_fluxo,
            (SELECT COUNT(*) FROM pagamentos WHERE ${condPagamentos}) as transacoes,
            (SELECT COALESCE(AVG(valor_pago), 0) FROM pagamentos WHERE ${condPagamentos}) as ticket_medio
    `;

    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json(err);
        const r = rows[0] || {};

        const vendas = Number(r.vendas || 0);
        const compras = Number(r.compras || 0);
        const perdasValor = Number(r.perdas_valor || 0);
        const despesasFluxo = Number(r.despesas_fluxo || 0);
        const custoTotal = compras + perdasValor + despesasFluxo;
        const lucroLiquido = vendas - custoTotal;
        const margemLiquida = vendas > 0 ? (lucroLiquido / vendas) * 100 : 0;
        const pontoEquilibrio = custoTotal;

        res.json({
            periodo_dias: dias,
            vendas,
            compras,
            perdas_valor: perdasValor,
            despesas_fluxo: despesasFluxo,
            entradas_fluxo: Number(r.entradas_fluxo || 0),
            transacoes: Number(r.transacoes || 0),
            ticket_medio: Number(r.ticket_medio || 0),
            custo_total: custoTotal,
            lucro_liquido: lucroLiquido,
            margem_liquida_percentual: margemLiquida,
            ponto_equilibrio: pontoEquilibrio
        });
    });
});

app.get('/api/financeiro/fluxo-diario', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo || '30');

    const sql = `
        SELECT
            base.data_ref,
            COALESCE(v.vendas, 0) as vendas,
            COALESCE(c.compras, 0) as compras,
            COALESCE(p.perdas, 0) as perdas,
            COALESCE(f.entradas_caixa, 0) as entradas_caixa,
            COALESCE(f.saidas_caixa, 0) as saidas_caixa
        FROM (
            SELECT DATE(data_pagamento) as data_ref
            FROM pagamentos
            WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            UNION
            SELECT DATE(data_compra) as data_ref
            FROM compras
            WHERE data_compra >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            UNION
            SELECT DATE(data_registro) as data_ref
            FROM perdas_estoque
            WHERE data_registro >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            UNION
            SELECT DATE(data_movimento) as data_ref
            FROM fluxo_caixa
            WHERE data_movimento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
        ) base
        LEFT JOIN (
            SELECT DATE(data_pagamento) as data_ref, SUM(valor_pago) as vendas
            FROM pagamentos
            WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            GROUP BY DATE(data_pagamento)
        ) v ON v.data_ref = base.data_ref
        LEFT JOIN (
            SELECT DATE(data_compra) as data_ref, SUM(valor_total_nota) as compras
            FROM compras
            WHERE data_compra >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            GROUP BY DATE(data_compra)
        ) c ON c.data_ref = base.data_ref
        LEFT JOIN (
            SELECT DATE(data_registro) as data_ref, SUM(COALESCE(valor_prejuizo_estimado, 0)) as perdas
            FROM perdas_estoque
            WHERE data_registro >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            GROUP BY DATE(data_registro)
        ) p ON p.data_ref = base.data_ref
        LEFT JOIN (
            SELECT
                DATE(data_movimento) as data_ref,
                SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END) as entradas_caixa,
                SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END) as saidas_caixa
            FROM fluxo_caixa
            WHERE data_movimento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            GROUP BY DATE(data_movimento)
        ) f ON f.data_ref = base.data_ref
        ORDER BY base.data_ref DESC
        LIMIT 90
    `;

    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json(err);
        const dados = (rows || []).map(row => {
            const vendas = Number(row.vendas || 0);
            const custos = Number(row.compras || 0) + Number(row.perdas || 0) + Number(row.saidas_caixa || 0);
            return {
                ...row,
                resultado_dia: vendas - custos
            };
        });
        res.json(dados);
    });
});

app.get('/api/financeiro/projecao', (req, res) => {
    const periodo = obterDiasPeriodo(req.query.periodo || '30');
    const horizonte = Math.min(Math.max(Number(req.query.horizonte || 30), 7), 180);

    const sql = `
        SELECT
            (SELECT COALESCE(SUM(valor_pago), 0) FROM pagamentos WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)) as vendas,
            (SELECT COALESCE(SUM(valor_total_nota), 0) FROM compras WHERE data_compra >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)) as compras,
            (SELECT COALESCE(SUM(valor_prejuizo_estimado), 0) FROM perdas_estoque WHERE data_registro >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)) as perdas,
            (SELECT COALESCE(SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END), 0) FROM fluxo_caixa WHERE data_movimento >= DATE_SUB(CURDATE(), INTERVAL ${periodo} DAY)) as saidas
    `;

    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json(err);
        const r = rows[0] || {};
        const vendasPeriodo = Number(r.vendas || 0);
        const custosPeriodo = Number(r.compras || 0) + Number(r.perdas || 0) + Number(r.saidas || 0);
        const lucroPeriodo = vendasPeriodo - custosPeriodo;

        const mediaDiariaVendas = vendasPeriodo / periodo;
        const mediaDiariaCustos = custosPeriodo / periodo;
        const mediaDiariaLucro = lucroPeriodo / periodo;

        res.json({
            periodo_base_dias: periodo,
            horizonte_dias: horizonte,
            media_diaria_vendas: mediaDiariaVendas,
            media_diaria_custos: mediaDiariaCustos,
            media_diaria_lucro: mediaDiariaLucro,
            projecao_vendas: mediaDiariaVendas * horizonte,
            projecao_custos: mediaDiariaCustos * horizonte,
            projecao_lucro: mediaDiariaLucro * horizonte
        });
    });
});

app.get('/api/produtos/estoque-baixo', (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limite || 10), 1), 50);
    const corte = Number(req.query.corte || 5);
    const corteSeguro = Number.isNaN(corte) ? 5 : corte;

    const sql = `
        SELECT
            p.id_produto,
            p.nome,
            COALESCE(p.estoque_atual, 0) as estoque_atual,
            c.nome as categoria
        FROM produtos p
        JOIN categorias c ON c.id_categoria = p.id_categoria
        WHERE COALESCE(p.ativo, 1) = 1
          AND COALESCE(p.estoque_atual, 0) <= ?
        ORDER BY COALESCE(p.estoque_atual, 0) ASC, p.nome ASC
        LIMIT ?
    `;

    db.query(sql, [corteSeguro, limite], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/insumos', async (req, res) => {
    try {
        const colunas = await obterColunasTabela('insumos');
        if (!colunas.length) {
            return res.status(404).json({ success: false, message: 'Tabela de insumos não encontrada.' });
        }

        const idCol = escolherColuna(colunas, ['id_insumo', 'id']);
        const nomeCol = escolherColuna(colunas, ['nome_insumo', 'nome', 'descricao', 'insumo']);
        const unidadeCol = escolherColuna(colunas, ['unidade', 'unidade_medida', 'un_medida']);
        const estoqueCol = escolherColuna(colunas, ['estoque_atual', 'estoque', 'quantidade_estoque', 'qtd_estoque']);
        const ativoCol = escolherColuna(colunas, ['ativo', 'status_ativo']);

        if (!idCol || !nomeCol) {
            return res.status(400).json({ success: false, message: 'Estrutura de insumos incompatível para listagem.' });
        }

        const campos = [
            `${idCol} as id_insumo`,
            `${nomeCol} as nome_insumo`,
            unidadeCol ? `${unidadeCol} as unidade` : `'' as unidade`,
            estoqueCol ? `COALESCE(${estoqueCol}, 0) as estoque_atual` : `0 as estoque_atual`
        ];

        const sql = `
            SELECT ${campos.join(', ')}
            FROM insumos
            ${ativoCol ? `WHERE COALESCE(${ativoCol}, 1) = 1` : ''}
            ORDER BY ${nomeCol} ASC
            LIMIT 300
        `;

        db.query(sql, (err, rows) => {
            if (err) return res.status(500).json(err);
            res.json(rows || []);
        });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.post('/api/insumos', async (req, res) => {
    try {
        const nomeInsumo = String(req.body.nome_insumo || req.body.nome || '').trim();
        const unidade = String(req.body.unidade || '').trim();
        const estoqueInicial = Number(req.body.estoque_inicial ?? 0);

        if (!nomeInsumo) {
            return res.status(400).json({ success: false, message: 'Informe o nome do produto de compra.' });
        }

        if (Number.isNaN(estoqueInicial) || estoqueInicial < 0) {
            return res.status(400).json({ success: false, message: 'Estoque inicial inválido.' });
        }

        const colunas = await obterColunasTabela('insumos');
        if (!colunas.length) {
            return res.status(404).json({ success: false, message: 'Tabela de insumos não encontrada.' });
        }

        const nomeCol = escolherColuna(colunas, ['nome_insumo', 'nome', 'descricao', 'insumo']);
        const unidadeCol = escolherColuna(colunas, ['unidade', 'unidade_medida', 'un_medida']);
        const estoqueCol = escolherColuna(colunas, ['estoque_atual', 'estoque', 'quantidade_estoque', 'qtd_estoque']);
        const ativoCol = escolherColuna(colunas, ['ativo', 'status_ativo']);

        if (!nomeCol) {
            return res.status(400).json({ success: false, message: 'Estrutura de insumos incompatível para cadastro.' });
        }

        const campos = [nomeCol];
        const valores = [nomeInsumo];

        if (unidadeCol) {
            campos.push(unidadeCol);
            valores.push(unidade || 'UN');
        }
        if (estoqueCol) {
            campos.push(estoqueCol);
            valores.push(estoqueInicial);
        }
        if (ativoCol) {
            campos.push(ativoCol);
            valores.push(1);
        }

        const placeholders = campos.map(() => '?').join(', ');
        const sql = `INSERT INTO insumos (${campos.join(', ')}) VALUES (${placeholders})`;

        db.query(sql, valores, (err, result) => {
            if (err) return res.status(500).json(err);
            res.status(201).json({
                success: true,
                id: result.insertId,
                message: 'Produto de compra cadastrado com sucesso!'
            });
        });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.put('/api/insumos/:id', async (req, res) => {
    try {
        const idInsumo = Number(req.params.id);
        const nomeInsumo = String(req.body.nome_insumo || req.body.nome || '').trim();
        const unidade = String(req.body.unidade || '').trim();
        const estoqueAtual = Number(req.body.estoque_atual ?? 0);

        if (!idInsumo) {
            return res.status(400).json({ success: false, message: 'ID do insumo inválido.' });
        }
        if (!nomeInsumo) {
            return res.status(400).json({ success: false, message: 'Informe o nome do produto de compra.' });
        }
        if (Number.isNaN(estoqueAtual) || estoqueAtual < 0) {
            return res.status(400).json({ success: false, message: 'Estoque inválido.' });
        }

        const colunas = await obterColunasTabela('insumos');
        const idCol = escolherColuna(colunas, ['id_insumo', 'id']);
        const nomeCol = escolherColuna(colunas, ['nome_insumo', 'nome', 'descricao', 'insumo']);
        const unidadeCol = escolherColuna(colunas, ['unidade', 'unidade_medida', 'un_medida']);
        const estoqueCol = escolherColuna(colunas, ['estoque_atual', 'estoque', 'quantidade_estoque', 'qtd_estoque']);

        if (!idCol || !nomeCol) {
            return res.status(400).json({ success: false, message: 'Estrutura de insumos incompatível para edição.' });
        }

        const sets = [`${nomeCol} = ?`];
        const valores = [nomeInsumo];

        if (unidadeCol) {
            sets.push(`${unidadeCol} = ?`);
            valores.push(unidade || 'UN');
        }
        if (estoqueCol) {
            sets.push(`${estoqueCol} = ?`);
            valores.push(estoqueAtual);
        }

        const sql = `UPDATE insumos SET ${sets.join(', ')} WHERE ${idCol} = ?`;
        valores.push(idInsumo);

        db.query(sql, valores, (err, result) => {
            if (err) return res.status(500).json(err);
            if (!result.affectedRows) {
                return res.status(404).json({ success: false, message: 'Insumo não encontrado.' });
            }
            res.json({ success: true, message: 'Produto de compra atualizado com sucesso!' });
        });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.delete('/api/insumos/:id', async (req, res) => {
    try {
        const idInsumo = Number(req.params.id);
        if (!idInsumo) {
            return res.status(400).json({ success: false, message: 'ID do insumo inválido.' });
        }

        const colunas = await obterColunasTabela('insumos');
        const idCol = escolherColuna(colunas, ['id_insumo', 'id']);
        const ativoCol = escolherColuna(colunas, ['ativo', 'status_ativo']);

        if (!idCol) {
            return res.status(400).json({ success: false, message: 'Estrutura de insumos incompatível para exclusão.' });
        }

        if (ativoCol) {
            const sql = `UPDATE insumos SET ${ativoCol} = 0 WHERE ${idCol} = ?`;
            db.query(sql, [idInsumo], (err, result) => {
                if (err) return res.status(500).json(err);
                if (!result.affectedRows) {
                    return res.status(404).json({ success: false, message: 'Insumo não encontrado.' });
                }
                res.json({ success: true, message: 'Produto de compra excluído com sucesso.' });
            });
            return;
        }

        const sql = `DELETE FROM insumos WHERE ${idCol} = ?`;
        db.query(sql, [idInsumo], (err, result) => {
            if (err) return res.status(500).json(err);
            if (!result.affectedRows) {
                return res.status(404).json({ success: false, message: 'Insumo não encontrado.' });
            }
            res.json({ success: true, message: 'Produto de compra excluído com sucesso.' });
        });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.get('/api/usuarios/atividade-operacoes', (req, res) => {
    const nivel = String(req.query.nivel || 'todos').trim().toLowerCase();
    const nivelPermitido = ['admin', 'operador'].includes(nivel);
    const limite = Math.min(Math.max(Number(req.query.limite || 100), 1), 300);

    const sql = `
        SELECT
            u.id_usuario,
            u.login,
            u.nivel,
            COALESCE(e.qtd_estornos, 0) as estornos,
            COALESCE(c.qtd_cancelamentos, 0) as cancelamentos,
            (COALESCE(e.qtd_estornos, 0) + COALESCE(c.qtd_cancelamentos, 0)) as total_operacoes
        FROM usuarios u
        LEFT JOIN (
            SELECT usuario_id, COUNT(*) as qtd_estornos
            FROM log_estornos
            GROUP BY usuario_id
        ) e ON e.usuario_id = u.id_usuario
        LEFT JOIN (
            SELECT usuario_id, COUNT(*) as qtd_cancelamentos
            FROM log_cancelamentos
            GROUP BY usuario_id
        ) c ON c.usuario_id = u.id_usuario
        ${nivelPermitido ? 'WHERE LOWER(COALESCE(u.nivel, "")) = ?' : ''}
        ORDER BY total_operacoes DESC, u.login ASC
        LIMIT ?
    `;

    const params = nivelPermitido ? [nivel, limite] : [limite];
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/relatorios/compras', async (req, res) => {
    try {
        const dias = obterDiasPeriodo(req.query.periodo);
        const fornecedorFiltro = String(req.query.fornecedor || '').trim().toLowerCase();
        const nfFiltro = String(req.query.nf || '').trim().toLowerCase();
        const status = String(req.query.status || 'ativos').trim().toLowerCase();

        const colunas = await obterColunasTabela('compras');
        const idCol = escolherColuna(colunas, ['id_compra', 'id']);
        const dataCol = escolherColuna(colunas, ['data_compra', 'data', 'data_registro']);
        const notaCol = escolherColuna(colunas, ['numero_nota_fiscal', 'nota_fiscal', 'nf']);
        const valorCol = escolherColuna(colunas, ['valor_total_nota', 'valor_total', 'valor']);
        const fornecedorCol = escolherColuna(colunas, ['fornecedor', 'nome_fornecedor']);
        const observacaoCol = escolherColuna(colunas, ['observacao', 'descricao', 'detalhes']);
        const ativoCol = escolherColuna(colunas, ['ativo', 'status_ativo']);

        if (!idCol || !dataCol || !notaCol || !valorCol) {
            return res.status(400).json({ success: false, message: 'Estrutura de compras incompatível para relatório.' });
        }

        const where = [];
        const params = [];

        if (dias === 1) {
            where.push(`DATE(${dataCol}) = CURDATE()`);
        } else {
            where.push(`${dataCol} >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`);
        }

        if (ativoCol) {
            if (status === 'ativos') where.push(`COALESCE(${ativoCol}, 1) = 1`);
            if (status === 'excluidas') where.push(`COALESCE(${ativoCol}, 1) = 0`);
        }

        if (fornecedorFiltro && fornecedorCol) {
            where.push(`LOWER(COALESCE(${fornecedorCol}, '')) LIKE ?`);
            params.push(`%${fornecedorFiltro}%`);
        }

        if (nfFiltro) {
            where.push(`LOWER(COALESCE(${notaCol}, '')) LIKE ?`);
            params.push(`%${nfFiltro}%`);
        }

        const sql = `
            SELECT
                ${idCol} as id_compra,
                ${dataCol} as data_compra,
                ${notaCol} as numero_nota_fiscal,
                COALESCE(${valorCol}, 0) as valor_total_nota,
                ${fornecedorCol ? `${fornecedorCol}` : `''`} as fornecedor,
                ${observacaoCol ? `${observacaoCol}` : `''`} as observacao,
                ${ativoCol ? `COALESCE(${ativoCol}, 1)` : `1`} as ativo
            FROM compras
            WHERE ${where.join(' AND ')}
            ORDER BY ${dataCol} DESC
            LIMIT 120
        `;

        db.query(sql, params, (err, results) => {
            if (err) return res.status(500).json(err);
            res.json(results || []);
        });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.post('/api/compras', async (req, res) => {
    try {
        const numeroNotaFiscal = String(req.body.numero_nota_fiscal || '').trim();
        const fornecedor = String(req.body.fornecedor || '').trim();
        const observacao = String(req.body.observacao || '').trim();
        const insumoNome = String(req.body.insumo_nome || '').trim();
        const valorTotal = Number(req.body.valor_total_nota || 0);
        const dataCompra = String(req.body.data_compra || '').trim();

        if (!numeroNotaFiscal) {
            return res.status(400).json({ success: false, message: 'Informe o número da nota fiscal.' });
        }
        if (Number.isNaN(valorTotal) || valorTotal <= 0) {
            return res.status(400).json({ success: false, message: 'Valor total da compra inválido.' });
        }

        const colunas = await obterColunasTabela('compras');
        if (!colunas.length) {
            return res.status(404).json({ success: false, message: 'Tabela de compras não encontrada.' });
        }

        const colNota = escolherColuna(colunas, ['numero_nota_fiscal', 'nota_fiscal', 'nf']);
        const colValor = escolherColuna(colunas, ['valor_total_nota', 'valor_total', 'valor']);
        const colData = escolherColuna(colunas, ['data_compra', 'data', 'data_registro']);
        const colFornecedor = escolherColuna(colunas, ['fornecedor', 'nome_fornecedor']);
        const colObservacao = escolherColuna(colunas, ['observacao', 'descricao', 'detalhes']);

        if (!colNota || !colValor) {
            return res.status(400).json({ success: false, message: 'Estrutura de compras incompatível para cadastro.' });
        }

        const campos = [colNota, colValor];
        const valores = [numeroNotaFiscal, valorTotal];

        if (colData) {
            campos.push(colData);
            valores.push(dataCompra || new Date().toISOString().slice(0, 10));
        }
        if (colFornecedor) {
            campos.push(colFornecedor);
            valores.push(fornecedor || 'Fornecedor não informado');
        }
        if (colObservacao) {
            const textoObservacao = [observacao, insumoNome ? `Insumo: ${insumoNome}` : ''].filter(Boolean).join(' | ');
            campos.push(colObservacao);
            valores.push(textoObservacao || null);
        }

        const placeholders = campos.map(() => '?').join(', ');
        const sql = `INSERT INTO compras (${campos.join(', ')}) VALUES (${placeholders})`;

        db.query(sql, valores, (err, result) => {
            if (err) return res.status(500).json(err);
            res.status(201).json({
                success: true,
                id_compra: result.insertId,
                message: 'Compra lançada com sucesso!'
            });
        });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.put('/api/compras/:id', async (req, res) => {
    try {
        const idCompra = Number(req.params.id);
        const numeroNotaFiscal = String(req.body.numero_nota_fiscal || '').trim();
        const fornecedor = String(req.body.fornecedor || '').trim();
        const observacao = String(req.body.observacao || '').trim();
        const insumoNome = String(req.body.insumo_nome || '').trim();
        const motivoAuditoria = String(req.body.motivo_auditoria || 'Edição de compra').trim();
        const valorTotal = Number(req.body.valor_total_nota || 0);
        const dataCompra = String(req.body.data_compra || '').trim();

        if (!idCompra) {
            return res.status(400).json({ success: false, message: 'ID da compra inválido.' });
        }
        if (!numeroNotaFiscal) {
            return res.status(400).json({ success: false, message: 'Informe o número da nota fiscal.' });
        }
        if (Number.isNaN(valorTotal) || valorTotal <= 0) {
            return res.status(400).json({ success: false, message: 'Valor total da compra inválido.' });
        }

        const colunas = await obterColunasTabela('compras');
        const idCol = escolherColuna(colunas, ['id_compra', 'id']);
        const colNota = escolherColuna(colunas, ['numero_nota_fiscal', 'nota_fiscal', 'nf']);
        const colValor = escolherColuna(colunas, ['valor_total_nota', 'valor_total', 'valor']);
        const colData = escolherColuna(colunas, ['data_compra', 'data', 'data_registro']);
        const colFornecedor = escolherColuna(colunas, ['fornecedor', 'nome_fornecedor']);
        const colObservacao = escolherColuna(colunas, ['observacao', 'descricao', 'detalhes']);

        if (!idCol || !colNota || !colValor) {
            return res.status(400).json({ success: false, message: 'Estrutura de compras incompatível para edição.' });
        }

        const auditoria = `[AUDITORIA ${new Date().toISOString()}] EDITADO: ${motivoAuditoria}`;
        const observacaoBase = [observacao, insumoNome ? `Insumo: ${insumoNome}` : ''].filter(Boolean).join(' | ');

        const sets = [`${colNota} = ?`, `${colValor} = ?`];
        const valores = [numeroNotaFiscal, valorTotal];

        if (colData) {
            sets.push(`${colData} = ?`);
            valores.push(dataCompra || new Date().toISOString().slice(0, 10));
        }
        if (colFornecedor) {
            sets.push(`${colFornecedor} = ?`);
            valores.push(fornecedor || 'Fornecedor não informado');
        }
        if (colObservacao) {
            sets.push(`${colObservacao} = ?`);
            valores.push([observacaoBase, auditoria].filter(Boolean).join(' | '));
        }

        const sql = `UPDATE compras SET ${sets.join(', ')} WHERE ${idCol} = ?`;
        valores.push(idCompra);

        db.query(sql, valores, (err, result) => {
            if (err) return res.status(500).json(err);
            if (!result.affectedRows) {
                return res.status(404).json({ success: false, message: 'Compra não encontrada.' });
            }
            res.json({ success: true, message: 'Compra atualizada com auditoria.' });
        });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.delete('/api/compras/:id', async (req, res) => {
    try {
        const idCompra = Number(req.params.id);
        const motivo = String(req.body?.motivo || 'Exclusão via painel financeiro').trim();

        if (!idCompra) {
            return res.status(400).json({ success: false, message: 'ID da compra inválido.' });
        }

        const colunas = await obterColunasTabela('compras');
        const idCol = escolherColuna(colunas, ['id_compra', 'id']);
        const colAtivo = escolherColuna(colunas, ['ativo', 'status_ativo']);
        const colObservacao = escolherColuna(colunas, ['observacao', 'descricao', 'detalhes']);
        const colValor = escolherColuna(colunas, ['valor_total_nota', 'valor_total', 'valor']);

        if (!idCol) {
            return res.status(400).json({ success: false, message: 'Estrutura de compras incompatível para exclusão.' });
        }

        const auditoria = `[AUDITORIA ${new Date().toISOString()}] EXCLUIDO: ${motivo}`;

        if (colAtivo) {
            const sets = [`${colAtivo} = 0`];
            const valores = [];
            if (colObservacao) {
                sets.push(`${colObservacao} = ?`);
                valores.push(auditoria);
            }

            const sql = `UPDATE compras SET ${sets.join(', ')} WHERE ${idCol} = ?`;
            valores.push(idCompra);

            db.query(sql, valores, (err, result) => {
                if (err) return res.status(500).json(err);
                if (!result.affectedRows) {
                    return res.status(404).json({ success: false, message: 'Compra não encontrada.' });
                }
                res.json({ success: true, message: 'Compra excluída (lógica) com auditoria.' });
            });
            return;
        }

        if (colValor) {
            const sets = [`${colValor} = 0`];
            const valores = [];
            if (colObservacao) {
                sets.push(`${colObservacao} = ?`);
                valores.push(auditoria);
            }

            const sql = `UPDATE compras SET ${sets.join(', ')} WHERE ${idCol} = ?`;
            valores.push(idCompra);

            db.query(sql, valores, (err, result) => {
                if (err) return res.status(500).json(err);
                if (!result.affectedRows) {
                    return res.status(404).json({ success: false, message: 'Compra não encontrada.' });
                }
                res.json({ success: true, message: 'Compra marcada como excluída com auditoria.' });
            });
            return;
        }

        return res.status(400).json({ success: false, message: 'Não foi possível excluir sem coluna de controle (ativo/valor).' });
    } catch (erro) {
        res.status(500).json(erro);
    }
});

app.get('/api/relatorios/perdas', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo);
    const sql = dias === 1
        ? `
            SELECT
                id_perda,
                id_insumo,
                COALESCE(quantidade, 0) as quantidade,
                motivo,
                data_registro
            FROM perdas_estoque
            WHERE DATE(data_registro) = CURDATE()
            ORDER BY data_registro DESC
            LIMIT 50
        `
        : `
            SELECT
                id_perda,
                id_insumo,
                COALESCE(quantidade, 0) as quantidade,
                motivo,
                data_registro
            FROM perdas_estoque
            WHERE data_registro >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ORDER BY data_registro DESC
            LIMIT 50
        `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/relatorios/vendas', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo);
    const sql = dias === 1
        ? `
            SELECT
                id_pagamento,
                id_comanda,
                metodo,
                COALESCE(valor_pago, 0) as valor_pago,
                data_pagamento
            FROM pagamentos
            WHERE DATE(data_pagamento) = CURDATE()
            ORDER BY data_pagamento DESC
            LIMIT 80
        `
        : `
            SELECT
                id_pagamento,
                id_comanda,
                metodo,
                COALESCE(valor_pago, 0) as valor_pago,
                data_pagamento
            FROM pagamentos
            WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ORDER BY data_pagamento DESC
            LIMIT 80
        `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/relatorios/recebimentos', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo);
    const condicaoData = dias === 1
        ? 'DATE(data_pagamento) = CURDATE()'
        : `data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;

    const sql = `
        SELECT
            SUM(CASE
                WHEN LOWER(TRIM(COALESCE(metodo, ''))) IN ('debito', 'débito', 'cartao debito', 'cartão débito', 'cartao de debito', 'cartão de débito')
                THEN valor_pago ELSE 0 END
            ) as debito,
            SUM(CASE
                WHEN LOWER(TRIM(COALESCE(metodo, ''))) IN ('credito', 'crédito', 'cartao credito', 'cartão crédito', 'cartao de credito', 'cartão de crédito')
                THEN valor_pago ELSE 0 END
            ) as credito,
            SUM(CASE
                WHEN LOWER(TRIM(COALESCE(metodo, ''))) = 'pix'
                THEN valor_pago ELSE 0 END
            ) as pix,
            SUM(CASE
                WHEN LOWER(TRIM(COALESCE(metodo, ''))) NOT IN (
                    'debito', 'débito', 'cartao debito', 'cartão débito', 'cartao de debito', 'cartão de débito',
                    'credito', 'crédito', 'cartao credito', 'cartão crédito', 'cartao de credito', 'cartão de crédito',
                    'pix'
                )
                THEN valor_pago ELSE 0 END
            ) as outros
        FROM pagamentos
        WHERE ${condicaoData}
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        const r = results[0] || {};
        const linhas = [
            { forma: 'Cartão Débito', total: Number(r.debito || 0) },
            { forma: 'Cartão Crédito', total: Number(r.credito || 0) },
            { forma: 'PIX', total: Number(r.pix || 0) },
            { forma: 'Outros', total: Number(r.outros || 0) }
        ];
        res.json(linhas);
    });
});

app.get('/api/cozinha', (req, res) => {
    const minEspera = Math.min(Math.max(Number(req.query.min_espera || 0), 0), 120);
    const limite = Math.min(Math.max(Number(req.query.limite || 30), 5), 120);
    const mesa = Number(req.query.mesa || 0);
    const possuiMesa = Number.isInteger(mesa) && mesa > 0;
    const prato = String(req.query.prato || '').trim().toLowerCase();
    const somenteCriticos = String(req.query.somente_criticos || '0') === '1';

    const where = ['COALESCE(minutos_espera, 0) >= ?'];
    const params = [minEspera];

    if (somenteCriticos) {
        where.push('COALESCE(minutos_espera, 0) >= 15');
    }
    if (possuiMesa) {
        where.push('numero_mesa = ?');
        params.push(mesa);
    }
    if (prato) {
        where.push('LOWER(COALESCE(prato, "")) LIKE ?');
        params.push(`%${prato}%`);
    }

    const sql = `
        SELECT numero_mesa, prato, minutos_espera, origem
        FROM ${obterFonteCozinhaSql('cozinha_base')}
        WHERE ${where.join(' AND ')}
        ORDER BY minutos_espera DESC
        LIMIT ?
    `;

    params.push(limite);
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/fechamento-caixa', (req, res) => {
    const sql = `
        SELECT
            SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END) as total_entradas,
            SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END) as total_saidas
        FROM fluxo_caixa
        WHERE DATE(data_movimento) = CURDATE()
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        const saldo = (results[0].total_entradas || 0) - (results[0].total_saidas || 0);
        res.json({ ...results[0], saldo });
    });
});

app.get('/api/vendas-grafico', (req, res) => {
    const sql = `
        SELECT DATE(data_pagamento) as data, SUM(valor_pago) as total
        FROM pagamentos
        WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY DATE(data_pagamento)
        ORDER BY data ASC
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/fechar-conta/:id_mesa', (req, res) => {
    const { id_mesa } = req.params;
    const sql = `
        SELECT
            p.nome,
            ic.quantidade,
            ic.preco_unitario_no_momento,
            (ic.quantidade * ic.preco_unitario_no_momento) as subtotal
        FROM itens_comanda ic
        JOIN produtos p ON ic.id_produto = p.id_produto
        JOIN comandas c ON ic.id_comanda = c.id_comanda
        WHERE c.id_mesa = ? AND c.status = 'aberta'
    `;

    db.query(sql, [id_mesa], (err, results) => {
        if (err) return res.status(500).json(err);

        const totalConsumo = results.reduce((acc, item) => acc + parseFloat(item.subtotal || 0), 0);
        const taxaServico = totalConsumo * 0.10;
        const totalGeral = totalConsumo + taxaServico;

        res.json({
            itens: results,
            consumo: totalConsumo.toFixed(2),
            taxa: taxaServico.toFixed(2),
            total: totalGeral.toFixed(2)
        });
    });
});

app.get('/api/cozinha/pendentes', (req, res) => {
    const minEspera = Math.min(Math.max(Number(req.query.min_espera || 0), 0), 120);
    const limite = Math.min(Math.max(Number(req.query.limite || 20), 5), 120);
    const mesa = Number(req.query.mesa || 0);
    const possuiMesa = Number.isInteger(mesa) && mesa > 0;
    const prato = String(req.query.prato || '').trim().toLowerCase();
    const somenteCriticos = String(req.query.somente_criticos || '0') === '1';
    const ordem = String(req.query.ordem || 'maior_espera').toLowerCase();

    const ordemSql = {
        maior_espera: 'COALESCE(minutos_espera, 0) DESC, numero_mesa ASC',
        menor_espera: 'COALESCE(minutos_espera, 0) ASC, numero_mesa ASC',
        mesa: 'numero_mesa ASC, COALESCE(minutos_espera, 0) DESC'
    }[ordem] || 'COALESCE(minutos_espera, 0) DESC, numero_mesa ASC';

    const where = ['COALESCE(minutos_espera, 0) >= ?'];
    const params = [minEspera];

    if (somenteCriticos) {
        where.push('COALESCE(minutos_espera, 0) >= 15');
    }
    if (possuiMesa) {
        where.push('numero_mesa = ?');
        params.push(mesa);
    }
    if (prato) {
        where.push('LOWER(COALESCE(prato, "")) LIKE ?');
        params.push(`%${prato}%`);
    }

    const sql = `
        SELECT numero_mesa, prato, minutos_espera, origem
        FROM ${obterFonteCozinhaSql('cozinha_base')}
        WHERE ${where.join(' AND ')}
        ORDER BY ${ordemSql}
        LIMIT ?
    `;

    params.push(limite);
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/cozinha/tempo-mesas', (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limite || 10), 5), 30);
    const minEspera = Math.min(Math.max(Number(req.query.min_espera || 0), 0), 120);
    const mesa = Number(req.query.mesa || 0);
    const possuiMesa = Number.isInteger(mesa) && mesa > 0;
    const prato = String(req.query.prato || '').trim().toLowerCase();
    const somenteCriticos = String(req.query.somente_criticos || '0') === '1';

    const where = ['COALESCE(minutos_espera, 0) >= ?'];
    const params = [minEspera];

    if (somenteCriticos) {
        where.push('COALESCE(minutos_espera, 0) >= 15');
    }
    if (possuiMesa) {
        where.push('numero_mesa = ?');
        params.push(mesa);
    }
    if (prato) {
        where.push('LOWER(COALESCE(prato, "")) LIKE ?');
        params.push(`%${prato}%`);
    }

    const sql = `
        SELECT
            numero_mesa,
            COUNT(*) as pedidos,
            COALESCE(AVG(minutos_espera), 0) as media_espera,
            COALESCE(MAX(minutos_espera), 0) as maior_espera
        FROM ${obterFonteCozinhaSql('cozinha_base')}
        WHERE ${where.join(' AND ')}
        GROUP BY numero_mesa
        ORDER BY maior_espera DESC, media_espera DESC
        LIMIT ?
    `;

    params.push(limite);
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/financeiro/fechamento', (req, res) => {
    const sql = `
        SELECT
            (SELECT SUM(valor_pago) FROM pagamentos WHERE DATE(data_pagamento) = CURDATE()) as entradas,
            (SELECT SUM(valor_prejuizo_estimado) FROM perdas_estoque WHERE DATE(data_registro) = CURDATE()) as perdas
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        const r = results[0] || {};
        const saldo_liquido = (r.entradas || 0) - (r.perdas || 0);
        res.json({ ...r, saldo_liquido });
    });
});

app.post('/api/alterar-senha', (req, res) => {
    const { login, senhaAtual, novaSenha } = req.body;
    const sqlVerifica = 'SELECT * FROM usuarios WHERE login = ? AND senha = ?';

    db.query(sqlVerifica, [login, senhaAtual], (err, results) => {
        if (err) return res.status(500).json(err);

        if (results.length > 0) {
            const sqlUpdate = 'UPDATE usuarios SET senha = ? WHERE login = ?';
            db.query(sqlUpdate, [novaSenha, login], updateErr => {
                if (updateErr) return res.status(500).json(updateErr);
                res.json({ success: true, message: 'Senha alterada com sucesso!' });
            });
        } else {
            res.status(401).json({ success: false, message: 'Senha atual incorreta.' });
        }
    });
});

app.get('/api/comissoes', (req, res) => {
    const sql = 'SELECT * FROM v_comissoes_diarias';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/estornar-item', (req, res) => {
    const { id_comanda, produto_nome, quantidade, motivo, usuario_id } = req.body;
    const sql = 'INSERT INTO log_estornos (id_comanda, produto_nome, quantidade, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)';

    db.query(sql, [id_comanda, produto_nome, quantidade, motivo, usuario_id], err => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: 'Estorno registrado na auditoria!' });
    });
});

app.post('/api/cancelar-item', (req, res) => {
    const { id_comanda, item_nome, motivo, usuario_id } = req.body;
    const sql = 'INSERT INTO log_cancelamentos (id_comanda, item_nome, motivo, usuario_id) VALUES (?, ?, ?, ?)';

    db.query(sql, [id_comanda, item_nome, motivo, usuario_id], err => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: 'Cancelamento registrado para auditoria.' });
    });
});

app.post('/api/cadastrar-usuario', (req, res) => {
    const { login, senha, nivel } = req.body;
    const sqlCheck = 'SELECT * FROM usuarios WHERE login = ?';

    db.query(sqlCheck, [login], (err, results) => {
        if (err) return res.status(500).json(err);
        if (results.length > 0) {
            return res.status(400).json({ success: false, message: 'Este usuário já existe!' });
        }

        const sqlInsert = 'INSERT INTO usuarios (login, senha, nivel) VALUES (?, ?, ?)';
        db.query(sqlInsert, [login, senha, nivel || 'operador'], insertErr => {
            if (insertErr) return res.status(500).json(insertErr);
            res.json({ success: true, message: 'Usuário cadastrado com sucesso!' });
        });
    });
});

app.put('/api/usuarios/:id', (req, res) => {
    const idUsuario = Number(req.params.id);
    const login = String(req.body.login || '').trim();
    const nivel = String(req.body.nivel || 'operador').trim().toLowerCase();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';

    if (!idUsuario) {
        return res.status(400).json({ success: false, message: 'ID do usuário inválido.' });
    }
    if (!login) {
        return res.status(400).json({ success: false, message: 'Login é obrigatório.' });
    }
    if (!['admin', 'operador'].includes(nivel)) {
        return res.status(400).json({ success: false, message: 'Nível inválido. Use admin ou operador.' });
    }

    db.query('SELECT id_usuario FROM usuarios WHERE id_usuario = ?', [idUsuario], (errUser, userRows) => {
        if (errUser) return res.status(500).json(errUser);
        if (!userRows || userRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
        }

        db.query('SELECT id_usuario FROM usuarios WHERE login = ? AND id_usuario <> ?', [login, idUsuario], (errDup, dupRows) => {
            if (errDup) return res.status(500).json(errDup);
            if (dupRows && dupRows.length > 0) {
                return res.status(400).json({ success: false, message: 'Já existe outro usuário com esse login.' });
            }

            const atualizarComSenha = String(senha || '').trim().length > 0;
            const sql = atualizarComSenha
                ? 'UPDATE usuarios SET login = ?, nivel = ?, senha = ? WHERE id_usuario = ?'
                : 'UPDATE usuarios SET login = ?, nivel = ? WHERE id_usuario = ?';
            const params = atualizarComSenha
                ? [login, nivel, senha, idUsuario]
                : [login, nivel, idUsuario];

            db.query(sql, params, (errUpdate, result) => {
                if (errUpdate) return res.status(500).json(errUpdate);
                if (!result.affectedRows) {
                    return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
                }
                res.json({ success: true, message: 'Usuário atualizado com sucesso!' });
            });
        });
    });
});

app.delete('/api/usuarios/:id', (req, res) => {
    const idUsuario = Number(req.params.id);
    if (!idUsuario) {
        return res.status(400).json({ success: false, message: 'ID do usuário inválido.' });
    }

    db.query('SELECT id_usuario, login FROM usuarios WHERE id_usuario = ?', [idUsuario], (errUser, userRows) => {
        if (errUser) return res.status(500).json(errUser);
        if (!userRows || userRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
        }

        db.query('SELECT COUNT(*) as total FROM usuarios', (errCount, countRows) => {
            if (errCount) return res.status(500).json(errCount);

            const totalUsuarios = Number(countRows?.[0]?.total || 0);
            if (totalUsuarios <= 1) {
                return res.status(400).json({ success: false, message: 'Não é permitido excluir o último usuário do sistema.' });
            }

            db.query('DELETE FROM usuarios WHERE id_usuario = ?', [idUsuario], (errDelete, deleteResult) => {
                if (errDelete) {
                    if (errDelete.code === 'ER_ROW_IS_REFERENCED_2') {
                        return res.status(409).json({ success: false, message: 'Não foi possível excluir: usuário possui vínculos operacionais.' });
                    }
                    return res.status(500).json(errDelete);
                }

                if (!deleteResult.affectedRows) {
                    return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
                }

                res.json({ success: true, message: `Usuário ${userRows[0].login} excluído com sucesso!` });
            });
        });
    });
});

app.get('/api/financeiro/comissoes', (req, res) => {
    const sql = 'SELECT * FROM v_comissoes_garcons';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/pedidos/estornar', (req, res) => {
    const { id_comanda, item_nome, quantidade, motivo } = req.body;
    const sqlLog = 'INSERT INTO log_estornos (id_comanda, item_nome, quantidade, motivo) VALUES (?, ?, ?, ?)';

    db.query(sqlLog, [id_comanda, item_nome, quantidade, motivo], err => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: 'Estorno registrado com sucesso!' });
    });
});

app.get('/api/vendas/fechar-mesa/:id_mesa', (req, res) => {
    const { id_mesa } = req.params;
    const sql = `
        SELECT p.nome, ic.quantidade, ic.preco_unitario_no_momento as preco,
               (ic.quantidade * ic.preco_unitario_no_momento) as subtotal
        FROM itens_comanda ic
        JOIN produtos p ON ic.id_produto = p.id_produto
        JOIN comandas c ON ic.id_comanda = c.id_comanda
        WHERE c.id_mesa = ? AND c.status = 'aberta'
    `;

    db.query(sql, [id_mesa], (err, results) => {
        if (err) return res.status(500).json(err);

        const consumoTotal = results.reduce((acc, item) => acc + parseFloat(item.subtotal || 0), 0);
        const taxaServico = consumoTotal * 0.10;

        res.json({
            itens: results,
            consumo: consumoTotal.toFixed(2),
            taxa: taxaServico.toFixed(2),
            totalGeral: (consumoTotal + taxaServico).toFixed(2)
        });
    });
});

app.get('/api/comandas/:id/itens', (req, res) => {
    const idComanda = Number(req.params.id);
    if (!idComanda) {
        return res.status(400).json({ success: false, message: 'Comanda inválida.' });
    }

    const sql = `
        SELECT
            COALESCE(p.nome, CONCAT('Produto ', ic.id_produto)) as item,
            COALESCE(ic.quantidade, 0) as quantidade
        FROM itens_comanda ic
        LEFT JOIN produtos p ON p.id_produto = ic.id_produto
        WHERE ic.id_comanda = ?
        ORDER BY item ASC
    `;

    db.query(sql, [idComanda], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results || []);
    });
});

app.get('/api/produtos', (req, res) => {
    const busca = String(req.query.busca || '').trim().toLowerCase();
    const idCategoria = Number(req.query.id_categoria || 0);

    const where = ['COALESCE(p.ativo, 1) = 1'];
    const params = [];

    if (busca) {
        where.push('(LOWER(COALESCE(p.nome, "")) LIKE ? OR LOWER(COALESCE(c.nome, "")) LIKE ? OR LOWER(COALESCE(s.nome_subcategoria, "")) LIKE ?)');
        params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
    }

    if (idCategoria > 0) {
        where.push('p.id_categoria = ?');
        params.push(idCategoria);
    }

    const sql = `
        SELECT
            p.*,
            c.nome as categoria_nome,
            s.nome_subcategoria
        FROM produtos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        LEFT JOIN subcategorias s ON p.id_subcategoria = s.id_subcategoria
        WHERE ${where.join(' AND ')}
        ORDER BY c.nome, p.nome
    `;

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/categorias', (req, res) => {
    const sql = 'SELECT id_categoria, nome FROM categorias ORDER BY nome';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/subcategorias', (req, res) => {
    const idCategoria = Number(req.query.id_categoria);

    if (idCategoria) {
        const sql = `
            SELECT id_subcategoria, id_categoria, nome_subcategoria
            FROM subcategorias
            WHERE id_categoria = ?
            ORDER BY nome_subcategoria
        `;

        db.query(sql, [idCategoria], (err, results) => {
            if (err) return res.status(500).json(err);
            res.json(results);
        });
        return;
    }

    const sql = `
        SELECT id_subcategoria, id_categoria, nome_subcategoria
        FROM subcategorias
        ORDER BY nome_subcategoria
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/produtos', (req, res) => {
    const { id_categoria, nome, preco_venda, estoque_atual, id_setor, id_subcategoria, eh_pesado, ativo } = req.body;

    if (!id_categoria || !nome || !preco_venda) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios: categoria, nome e preço.' });
    }

    const precoNumerico = Number(preco_venda);
    if (Number.isNaN(precoNumerico) || precoNumerico <= 0) {
        return res.status(400).json({ success: false, message: 'Preço de venda inválido.' });
    }

    const estoqueNumerico = Number(estoque_atual ?? 0);
    if (Number.isNaN(estoqueNumerico) || estoqueNumerico < 0) {
        return res.status(400).json({ success: false, message: 'Estoque inválido.' });
    }

    const idSetorNumerico = id_setor ? Number(id_setor) : null;
    const idSubcategoriaNumerico = id_subcategoria ? Number(id_subcategoria) : null;
    const ehPesadoNumerico = eh_pesado ? 1 : 0;
    const ativoNumerico = ativo === 0 ? 0 : 1;

    if ((id_setor && Number.isNaN(idSetorNumerico)) || (id_subcategoria && Number.isNaN(idSubcategoriaNumerico))) {
        return res.status(400).json({ success: false, message: 'Setor ou subcategoria inválidos.' });
    }

    const sql = `
        INSERT INTO produtos
            (id_categoria, nome, preco_venda, estoque_atual, id_setor, id_subcategoria, eh_pesado, ativo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [id_categoria, nome.trim(), precoNumerico, estoqueNumerico, idSetorNumerico, idSubcategoriaNumerico, ehPesadoNumerico, ativoNumerico],
        (err, result) => {
        if (err) return res.status(500).json(err);
        res.status(201).json({ success: true, id: result.insertId, message: 'Produto lançado com sucesso!' });
    });
});

app.put('/api/produtos/:id', (req, res) => {
    const idProduto = Number(req.params.id);
    const { id_categoria, nome, preco_venda, estoque_atual, id_setor, id_subcategoria, eh_pesado, ativo } = req.body;

    if (!idProduto || !id_categoria || !nome || !preco_venda) {
        return res.status(400).json({ success: false, message: 'Campos obrigatórios: categoria, nome e preço.' });
    }

    const precoNumerico = Number(preco_venda);
    if (Number.isNaN(precoNumerico) || precoNumerico <= 0) {
        return res.status(400).json({ success: false, message: 'Preço de venda inválido.' });
    }

    const estoqueNumerico = Number(estoque_atual ?? 0);
    if (Number.isNaN(estoqueNumerico) || estoqueNumerico < 0) {
        return res.status(400).json({ success: false, message: 'Estoque inválido.' });
    }

    const idSetorNumerico = id_setor ? Number(id_setor) : null;
    const idSubcategoriaNumerico = id_subcategoria ? Number(id_subcategoria) : null;
    const ehPesadoNumerico = eh_pesado ? 1 : 0;
    const ativoNumerico = ativo === 0 ? 0 : 1;

    if ((id_setor && Number.isNaN(idSetorNumerico)) || (id_subcategoria && Number.isNaN(idSubcategoriaNumerico))) {
        return res.status(400).json({ success: false, message: 'Setor ou subcategoria inválidos.' });
    }

    const sql = `
        UPDATE produtos
        SET id_categoria = ?,
            nome = ?,
            preco_venda = ?,
            estoque_atual = ?,
            id_setor = ?,
            id_subcategoria = ?,
            eh_pesado = ?,
            ativo = ?
        WHERE id_produto = ?
    `;

    db.query(
        sql,
        [id_categoria, nome.trim(), precoNumerico, estoqueNumerico, idSetorNumerico, idSubcategoriaNumerico, ehPesadoNumerico, ativoNumerico, idProduto],
        (err, result) => {
        if (err) return res.status(500).json(err);
        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Produto não encontrado.' });
        }
        res.json({ success: true, message: 'Produto atualizado com sucesso!' });
    });
});

app.get('/api/relatorios/resumo', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo);
    const condicaoCompras = dias === 1
        ? 'DATE(data_compra) = CURDATE()'
        : `data_compra >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;
    const condicaoPerdas = dias === 1
        ? 'DATE(data_registro) = CURDATE()'
        : `data_registro >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;
    const condicaoPagamentos = dias === 1
        ? 'DATE(data_pagamento) = CURDATE()'
        : `data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)`;

    const sql = `
        SELECT
            (SELECT COALESCE(SUM(valor_total_nota), 0) FROM compras WHERE ${condicaoCompras}) as total_compras,
            (SELECT COALESCE(SUM(quantidade), 0) FROM perdas_estoque WHERE ${condicaoPerdas}) as total_perdas_qtd,
            (SELECT COALESCE(SUM(valor_pago), 0) FROM pagamentos WHERE ${condicaoPagamentos}) as total_vendas,
            (SELECT COUNT(*) FROM pagamentos WHERE ${condicaoPagamentos}) as qtd_transacoes,
            (SELECT COALESCE(AVG(valor_pago), 0) FROM pagamentos WHERE ${condicaoPagamentos}) as ticket_medio,
            (
                (SELECT COALESCE(SUM(valor_pago), 0) FROM pagamentos WHERE ${condicaoPagamentos}) -
                (SELECT COALESCE(SUM(valor_total_nota), 0) FROM compras WHERE ${condicaoCompras})
            ) as saldo_operacional,
            COALESCE((
                (
                    (SELECT COALESCE(SUM(valor_pago), 0) FROM pagamentos WHERE ${condicaoPagamentos}) -
                    (SELECT COALESCE(SUM(valor_total_nota), 0) FROM compras WHERE ${condicaoCompras})
                ) /
                NULLIF((SELECT COALESCE(SUM(valor_pago), 0) FROM pagamentos WHERE ${condicaoPagamentos}), 0)
            ) * 100, 0) as margem_operacional_percentual
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results[0] || {
            total_compras: 0,
            total_perdas_qtd: 0,
            total_vendas: 0,
            qtd_transacoes: 0,
            ticket_medio: 0,
            saldo_operacional: 0,
            margem_operacional_percentual: 0
        });
    });
});

app.get('/api/dashboard/comparativo-periodos', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo || '7');
    const sql = `
        SELECT
            COALESCE((
                SELECT SUM(valor_pago)
                FROM pagamentos
                WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ), 0) as vendas_periodo_atual,
            COALESCE((
                SELECT SUM(valor_pago)
                FROM pagamentos
                WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias * 2} DAY)
                  AND data_pagamento < DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ), 0) as vendas_periodo_anterior,
            COALESCE((
                SELECT SUM(valor_total_nota)
                FROM compras
                WHERE data_compra >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ), 0) as compras_periodo_atual,
            COALESCE((
                SELECT SUM(valor_total_nota)
                FROM compras
                WHERE data_compra >= DATE_SUB(CURDATE(), INTERVAL ${dias * 2} DAY)
                  AND data_compra < DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ), 0) as compras_periodo_anterior,
            COALESCE((
                SELECT COUNT(*)
                FROM pagamentos
                WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ), 0) as transacoes_periodo_atual,
            COALESCE((
                SELECT COUNT(*)
                FROM pagamentos
                WHERE data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias * 2} DAY)
                  AND data_pagamento < DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
            ), 0) as transacoes_periodo_anterior
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);

        const r = results[0] || {};
        const vendasAtual = Number(r.vendas_periodo_atual || 0);
        const vendasAnterior = Number(r.vendas_periodo_anterior || 0);
        const comprasAtual = Number(r.compras_periodo_atual || 0);
        const comprasAnterior = Number(r.compras_periodo_anterior || 0);

        const variacaoVendas = vendasAnterior > 0 ? ((vendasAtual - vendasAnterior) / vendasAnterior) * 100 : (vendasAtual > 0 ? 100 : 0);
        const variacaoCompras = comprasAnterior > 0 ? ((comprasAtual - comprasAnterior) / comprasAnterior) * 100 : (comprasAtual > 0 ? 100 : 0);

        res.json({
            periodo_dias: dias,
            vendas_periodo_atual: vendasAtual,
            vendas_periodo_anterior: vendasAnterior,
            compras_periodo_atual: comprasAtual,
            compras_periodo_anterior: comprasAnterior,
            transacoes_periodo_atual: Number(r.transacoes_periodo_atual || 0),
            transacoes_periodo_anterior: Number(r.transacoes_periodo_anterior || 0),
            variacao_vendas_percentual: variacaoVendas,
            variacao_compras_percentual: variacaoCompras
        });
    });
});

app.get('/api/produtos/ranking-vendas', (req, res) => {
    const dias = obterDiasPeriodo(req.query.periodo || '7');
    const limite = Math.min(Math.max(Number(req.query.limite || 10), 3), 30);

    const sql = `
        SELECT
            p.id_produto,
            p.nome,
            c.nome as categoria,
            COALESCE(SUM(ic.quantidade), 0) as quantidade_vendida,
            COALESCE(SUM(ic.quantidade * ic.preco_unitario_no_momento), 0) as faturamento_estimado
        FROM itens_comanda ic
        JOIN produtos p ON p.id_produto = ic.id_produto
        JOIN categorias c ON c.id_categoria = p.id_categoria
        JOIN pagamentos pg ON pg.id_comanda = ic.id_comanda
        WHERE pg.data_pagamento >= DATE_SUB(CURDATE(), INTERVAL ${dias} DAY)
        GROUP BY p.id_produto, p.nome, c.nome
        ORDER BY quantidade_vendida DESC, faturamento_estimado DESC
        LIMIT ?
    `;

    db.query(sql, [limite], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/operacoes/saude', (req, res) => {
    const sql = `
        SELECT
            COALESCE((SELECT COUNT(*) FROM log_estornos WHERE DATE(data_hora) = CURDATE()), 0) as estornos_hoje,
            COALESCE((SELECT COUNT(*) FROM log_cancelamentos WHERE DATE(data_hora) = CURDATE()), 0) as cancelamentos_hoje,
            COALESCE((SELECT COUNT(*) FROM pagamentos WHERE DATE(data_pagamento) = CURDATE()), 0) as pagamentos_hoje,
            COALESCE((
                SELECT COUNT(*)
                FROM v_pedidos_atrasados
                WHERE COALESCE(minutos_espera, 0) >= 15
            ), 0) as pedidos_criticos
    `;

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        const r = results[0] || {};
        const totalFalhas = Number(r.estornos_hoje || 0) + Number(r.cancelamentos_hoje || 0);
        const pagamentos = Number(r.pagamentos_hoje || 0);
        const taxaFalhas = pagamentos > 0 ? (totalFalhas / pagamentos) * 100 : 0;

        res.json({
            estornos_hoje: Number(r.estornos_hoje || 0),
            cancelamentos_hoje: Number(r.cancelamentos_hoje || 0),
            pagamentos_hoje: pagamentos,
            pedidos_criticos: Number(r.pedidos_criticos || 0),
            taxa_falhas_percentual: taxaFalhas
        });
    });
});

app.delete('/api/produtos/:id', (req, res) => {
    const idProduto = Number(req.params.id);
    if (!idProduto) {
        return res.status(400).json({ success: false, message: 'ID do produto inválido.' });
    }

    const sql = 'UPDATE produtos SET ativo = 0 WHERE id_produto = ?';

    db.query(sql, [idProduto], (err, result) => {
        if (err) return res.status(500).json(err);
        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Produto não encontrado.' });
        }
        res.json({ success: true, message: 'Produto removido com sucesso!' });
    });
});

/* ===== CRUD CATEGORIAS ===== */
app.post('/api/categorias', (req, res) => {
    const { nome } = req.body;
    if (!nome || !nome.trim()) {
        return res.status(400).json({ success: false, message: 'Nome da categoria é obrigatório.' });
    }
    db.query('SELECT id_categoria FROM categorias WHERE nome = ?', [nome.trim()], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao verificar duplicidade.' });
        if (rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Categoria já existe.' });
        }
        db.query('INSERT INTO categorias (nome) VALUES (?)', [nome.trim()], (err2, result) => {
            if (err2) return res.status(500).json({ success: false, message: 'Erro ao criar categoria.' });
            res.json({ success: true, message: 'Categoria criada!', id: result.insertId });
        });
    });
});

app.put('/api/categorias/:id', (req, res) => {
    const id = Number(req.params.id);
    const { nome } = req.body;
    if (!id || !nome || !nome.trim()) {
        return res.status(400).json({ success: false, message: 'ID e nome são obrigatórios.' });
    }
    db.query('UPDATE categorias SET nome = ? WHERE id_categoria = ?', [nome.trim(), id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao atualizar categoria.' });
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Categoria não encontrada.' });
        res.json({ success: true, message: 'Categoria atualizada!' });
    });
});

app.delete('/api/categorias/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID inválido.' });
    db.query('DELETE FROM categorias WHERE id_categoria = ?', [id], (err, result) => {
        if (err) {
            if (err.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(409).json({ success: false, message: 'Categoria em uso por produtos. Não pode ser removida.' });
            }
            return res.status(500).json({ success: false, message: 'Erro ao remover categoria.' });
        }
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Categoria não encontrada.' });
        res.json({ success: true, message: 'Categoria removida!' });
    });
});

/* ===== CRUD SUBCATEGORIAS ===== */
app.post('/api/subcategorias', (req, res) => {
    const { nome, id_categoria } = req.body;
    if (!nome || !nome.trim()) {
        return res.status(400).json({ success: false, message: 'Nome da subcategoria é obrigatório.' });
    }
    const params = id_categoria ? [nome.trim(), Number(id_categoria)] : [nome.trim(), null];
    db.query('INSERT INTO subcategorias (nome, id_categoria) VALUES (?, ?)', params, (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao criar subcategoria.' });
        res.json({ success: true, message: 'Subcategoria criada!', id: result.insertId });
    });
});

app.put('/api/subcategorias/:id', (req, res) => {
    const id = Number(req.params.id);
    const { nome, id_categoria } = req.body;
    if (!id || !nome || !nome.trim()) {
        return res.status(400).json({ success: false, message: 'ID e nome são obrigatórios.' });
    }
    db.query('UPDATE subcategorias SET nome = ?, id_categoria = ? WHERE id_subcategoria = ?',
        [nome.trim(), id_categoria ? Number(id_categoria) : null, id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'Erro ao atualizar subcategoria.' });
            if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Subcategoria não encontrada.' });
            res.json({ success: true, message: 'Subcategoria atualizada!' });
        });
});

app.delete('/api/subcategorias/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID inválido.' });
    db.query('DELETE FROM subcategorias WHERE id_subcategoria = ?', [id], (err, result) => {
        if (err) {
            if (err.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(409).json({ success: false, message: 'Subcategoria em uso. Não pode ser removida.' });
            }
            return res.status(500).json({ success: false, message: 'Erro ao remover subcategoria.' });
        }
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Subcategoria não encontrada.' });
        res.json({ success: true, message: 'Subcategoria removida!' });
    });
});

/* ===== REGISTRO DE PERDAS ===== */
app.post('/api/perdas', async (req, res) => {
    try {
        const { id_insumo, quantidade, motivo } = req.body;
        if (!id_insumo || !quantidade || !motivo) {
            return res.status(400).json({ success: false, message: 'Insumo, quantidade e motivo são obrigatórios.' });
        }

        const colunas = await obterColunasTabela('perdas_estoque');

        const colInsumo = escolherColuna(colunas, ['id_insumo', 'id_produto', 'insumo_id', 'produto_id'], 'id_insumo');
        const colQtd = escolherColuna(colunas, ['quantidade', 'qtd', 'qtde'], 'quantidade');
        const colMotivo = escolherColuna(colunas, ['motivo', 'observacao', 'obs', 'descricao'], 'motivo');

        const colunasData = colunas.filter(c => c.includes('data') || c.includes('created') || c.includes('criado'));
        const colData = colunasData.length > 0 ? colunasData[0] : null;

        let sql, params;
        if (colData) {
            sql = `INSERT INTO perdas_estoque (${colInsumo}, ${colQtd}, ${colMotivo}, ${colData}) VALUES (?, ?, ?, NOW())`;
            params = [Number(id_insumo), Number(quantidade), motivo.trim()];
        } else {
            sql = `INSERT INTO perdas_estoque (${colInsumo}, ${colQtd}, ${colMotivo}) VALUES (?, ?, ?)`;
            params = [Number(id_insumo), Number(quantidade), motivo.trim()];
        }

        db.query(sql, params, (err, result) => {
            if (err) return res.status(500).json({ success: false, message: 'Erro ao registrar perda: ' + err.message });
            res.json({ success: true, message: 'Perda registrada com sucesso!', id: result.insertId });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Erro interno: ' + e.message });
    }
});

/* ===== GESTAO DE MESAS ===== */

// Auto-ensure capacidade column exists
db.query(`
    SELECT COLUMN_NAME FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'mesas' AND COLUMN_NAME = 'capacidade'
`, (err, rows) => {
    if (!err && rows.length === 0) {
        db.query(`ALTER TABLE mesas ADD COLUMN capacidade INT DEFAULT 4`, (e2) => {
            if (!e2) console.log('Coluna capacidade adicionada à tabela mesas.');
        });
    }
});

// Seed / garantir 25 mesas
app.post('/api/mesas/seed', (req, res) => {
    const totalDesejado = 25;
    db.query('SELECT MAX(numero_mesa) as maxNum, COUNT(*) as total FROM mesas', (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao consultar mesas.' });
        const maxNum = Number(rows[0].maxNum || 0);
        const total = Number(rows[0].total || 0);
        if (total >= totalDesejado) {
            return res.json({ success: true, message: `Já existem ${total} mesas cadastradas.`, total });
        }
        const faltam = totalDesejado - total;
        const values = [];
        for (let i = 1; i <= faltam; i++) {
            const num = maxNum + i;
            const cap = num <= 4 ? 2 : num <= 12 ? 4 : num <= 20 ? 6 : 8;
            values.push(`(${num}, 'livre', ${cap})`);
        }
        db.query(`INSERT INTO mesas (numero_mesa, status, capacidade) VALUES ${values.join(',')}`, (e2) => {
            if (e2) return res.status(500).json({ success: false, message: 'Erro ao criar mesas: ' + e2.message });
            res.json({ success: true, message: `${faltam} mesas criadas. Total: ${totalDesejado}.`, total: totalDesejado });
        });
    });
});

// Criar mesa individual
app.post('/api/mesas', (req, res) => {
    const { numero_mesa, capacidade } = req.body;
    const num = Number(numero_mesa);
    const cap = Number(capacidade || 4);
    if (!num || num < 1) {
        return res.status(400).json({ success: false, message: 'Número da mesa inválido.' });
    }
    db.query('SELECT COUNT(*) as c FROM mesas WHERE numero_mesa = ?', [num], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao verificar mesa: ' + err.message });
        if (rows[0].c > 0) return res.status(409).json({ success: false, message: `Mesa ${num} já existe.` });
        db.query('INSERT INTO mesas (numero_mesa, status, capacidade) VALUES (?, ?, ?)', [num, 'livre', cap], (e2, result) => {
            if (e2) return res.status(500).json({ success: false, message: 'Erro ao criar mesa: ' + e2.message });
            res.json({ success: true, message: `Mesa ${num} criada com sucesso!`, id: result.insertId });
        });
    });
});

// Atualizar mesa (status + capacidade)
app.put('/api/mesas/:numero', (req, res) => {
    const numero = Number(req.params.numero);
    const { status, capacidade } = req.body;
    if (!numero) {
        return res.status(400).json({ success: false, message: 'Número da mesa é obrigatório.' });
    }

    const sets = [];
    const params = [];
    if (status) {
        if (!['livre', 'ocupada', 'reservada'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status deve ser "livre", "ocupada" ou "reservada".' });
        }
        sets.push('status = ?');
        params.push(status);
    }
    if (capacidade !== undefined && capacidade !== null) {
        sets.push('capacidade = ?');
        params.push(Number(capacidade));
    }
    if (sets.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum campo para atualizar.' });
    }
    params.push(numero);
    db.query(`UPDATE mesas SET ${sets.join(', ')} WHERE numero_mesa = ?`, params, (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao atualizar mesa.' });
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Mesa não encontrada.' });
        res.json({ success: true, message: `Mesa ${numero} atualizada com sucesso.` });
    });
});

// Excluir mesa
app.delete('/api/mesas/:numero', (req, res) => {
    const numero = Number(req.params.numero);
    if (!numero) {
        return res.status(400).json({ success: false, message: 'Número da mesa é obrigatório.' });
    }
    db.query('DELETE FROM mesas WHERE numero_mesa = ?', [numero], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao excluir mesa: ' + err.message });
        if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Mesa não encontrada.' });
        res.json({ success: true, message: `Mesa ${numero} excluída com sucesso.` });
    });
});

// Resumo de mesas
app.get('/api/mesas/resumo', (req, res) => {
    db.query(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'livre' THEN 1 ELSE 0 END) as livres,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'ocupada' THEN 1 ELSE 0 END) as ocupadas,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'reservada' THEN 1 ELSE 0 END) as reservadas,
            COALESCE(SUM(capacidade), 0) as capacidade_total
        FROM mesas
    `, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao consultar resumo.' });
        res.json(rows[0] || { total: 0, livres: 0, ocupadas: 0, reservadas: 0, capacidade_total: 0 });
    });
});

// Lançamentos por mesa (consumo rápido)
app.get('/api/mesas/lancamentos', (req, res) => {
    const numeroMesa = Number(req.query.numero_mesa || 0);
    const limite = Math.min(Math.max(Number(req.query.limite || 60), 10), 200);

    const where = [];
    const params = [];
    if (numeroMesa > 0) {
        where.push('lm.numero_mesa = ?');
        params.push(numeroMesa);
    }

    const sql = `
        SELECT
            lm.id_lancamento,
            lm.numero_mesa,
            lm.id_produto,
            lm.item_nome,
            lm.quantidade,
            lm.valor_unitario,
            lm.subtotal,
            lm.observacao,
            lm.usuario,
            lm.criado_em,
            p.nome as produto_nome
        FROM lancamentos_mesa lm
        LEFT JOIN produtos p ON p.id_produto = lm.id_produto
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY lm.criado_em DESC, lm.id_lancamento DESC
        LIMIT ?
    `;

    params.push(limite);
    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao consultar lançamentos de mesa.' });
        res.json(rows || []);
    });
});

app.post('/api/mesas/lancamentos', (req, res) => {
    const numeroMesa = Number(req.body.numero_mesa || 0);
    const idProduto = Number(req.body.id_produto || 0) || null;
    const quantidade = Number(req.body.quantidade || 0);
    const valorUnitario = Number(req.body.valor_unitario || 0);
    const observacao = String(req.body.observacao || '').trim();
    const usuario = String(req.body.usuario || 'sistema').trim() || 'sistema';
    const itemNomeDigitado = String(req.body.item_nome || '').trim();

    if (!numeroMesa || numeroMesa < 1) {
        return res.status(400).json({ success: false, message: 'Número da mesa inválido.' });
    }
    if (!quantidade || quantidade <= 0) {
        return res.status(400).json({ success: false, message: 'Quantidade deve ser maior que zero.' });
    }
    if (!valorUnitario || valorUnitario <= 0) {
        return res.status(400).json({ success: false, message: 'Valor unitário deve ser maior que zero.' });
    }

    db.query('SELECT numero_mesa FROM mesas WHERE numero_mesa = ? LIMIT 1', [numeroMesa], (mesaErr, mesaRows) => {
        if (mesaErr) return res.status(500).json({ success: false, message: 'Erro ao validar mesa.' });
        if (!mesaRows || !mesaRows.length) {
            return res.status(404).json({ success: false, message: `Mesa ${numeroMesa} não encontrada.` });
        }

        const inserirLancamento = (nomeFinal, idProdutoFinal) => {
            if (!nomeFinal) {
                return res.status(400).json({ success: false, message: 'Informe o item do lançamento.' });
            }

            const subtotal = Number((quantidade * valorUnitario).toFixed(2));
            const sqlInsert = `
                INSERT INTO lancamentos_mesa
                (numero_mesa, id_produto, item_nome, quantidade, valor_unitario, subtotal, observacao, usuario)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.query(
                sqlInsert,
                [numeroMesa, idProdutoFinal, nomeFinal, quantidade, valorUnitario, subtotal, observacao, usuario],
                (insertErr, result) => {
                    if (insertErr) return res.status(500).json({ success: false, message: 'Erro ao salvar lançamento da mesa.' });

                    db.query("UPDATE mesas SET status = 'ocupada' WHERE numero_mesa = ? AND status <> 'ocupada'", [numeroMesa]);

                    res.json({
                        success: true,
                        message: `Lançamento registrado na Mesa ${numeroMesa}.`,
                        id_lancamento: result.insertId,
                        subtotal
                    });
                }
            );
        };

        if (idProduto) {
            db.query('SELECT nome FROM produtos WHERE id_produto = ? LIMIT 1', [idProduto], (prodErr, prodRows) => {
                if (prodErr) return res.status(500).json({ success: false, message: 'Erro ao validar produto.' });
                if (!prodRows || !prodRows.length) {
                    return res.status(404).json({ success: false, message: 'Produto informado não encontrado.' });
                }
                inserirLancamento(String(prodRows[0].nome || '').trim(), idProduto);
            });
            return;
        }

        inserirLancamento(itemNomeDigitado, null);
    });
});

/* ===== BUSCA GLOBAL ===== */
app.get('/api/busca-global', (req, res) => {
    const termo = (req.query.termo || '').trim();
    if (!termo || termo.length < 2) {
        return res.status(400).json({ success: false, message: 'Termo de busca deve ter pelo menos 2 caracteres.' });
    }
    const like = `%${termo}%`;

    const queries = {
        produtos: `SELECT id_produto AS id, nome, 'produto' AS tipo FROM produtos WHERE nome LIKE ? AND ativo = 1 LIMIT 10`,
        insumos: `SELECT id_insumo AS id, nome, 'insumo' AS tipo FROM insumos WHERE nome LIKE ? AND ativo = 1 LIMIT 10`,
        usuarios: `SELECT id_usuario AS id, login AS nome, 'usuario' AS tipo FROM usuarios WHERE login LIKE ? LIMIT 10`
    };

    const resultados = [];
    let pending = Object.keys(queries).length;

    Object.entries(queries).forEach(([tipo, sql]) => {
        db.query(sql, [like], (err, rows) => {
            if (!err && rows) {
                resultados.push(...rows);
            }
            pending--;
            if (pending === 0) {
                res.json(resultados);
            }
        });
    });
});

// Liberar todas as mesas (bulk)
app.post('/api/mesas/liberar-todas', (req, res) => {
    db.query("UPDATE mesas SET status = 'livre'", (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'Erro ao liberar mesas.' });
        res.json({ success: true, message: `${result.affectedRows} mesas liberadas.`, total: result.affectedRows });
    });
});

// Dashboard estatísticas avançadas de mesas
app.get('/api/mesas/estatisticas', (req, res) => {
    const sql = `
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'livre' THEN 1 ELSE 0 END) as livres,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'ocupada' THEN 1 ELSE 0 END) as ocupadas,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'reservada' THEN 1 ELSE 0 END) as reservadas,
            COALESCE(SUM(capacidade), 0) as capacidade_total,
            COALESCE(AVG(capacidade), 0) as media_capacidade,
            COALESCE(MIN(capacidade), 0) as menor_capacidade,
            COALESCE(MAX(capacidade), 0) as maior_capacidade
        FROM mesas
    `;
    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json(err);
        const d = rows[0] || {};
        const taxa = Number(d.total) > 0 ? ((Number(d.ocupadas) / Number(d.total)) * 100).toFixed(1) : '0.0';
        res.json({ ...d, taxa_ocupacao: taxa });
    });
});

// Histórico de ocupação (log simplificado) - registra snapshot ao mudar status
app.get('/api/mesas/distribuicao-capacidade', (req, res) => {
    db.query(`
        SELECT capacidade, COUNT(*) as quantidade,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'ocupada' THEN 1 ELSE 0 END) as ocupadas
        FROM mesas
        GROUP BY capacidade
        ORDER BY capacidade
    `, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows || []);
    });
});

/* ========================================
   AUTO-MIGRACAO: NOVAS TABELAS
   ======================================== */

const migracoes = [
    `CREATE TABLE IF NOT EXISTS fornecedores (
        id_fornecedor INT AUTO_INCREMENT PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        cnpj VARCHAR(20),
        telefone VARCHAR(20),
        email VARCHAR(150),
        endereco TEXT,
        contato VARCHAR(100),
        observacao TEXT,
        ativo TINYINT DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reservas (
        id_reserva INT AUTO_INCREMENT PRIMARY KEY,
        numero_mesa INT NOT NULL,
        cliente_nome VARCHAR(150) NOT NULL,
        cliente_telefone VARCHAR(20),
        data_reserva DATE NOT NULL,
        hora_reserva TIME NOT NULL,
        qtd_pessoas INT DEFAULT 1,
        observacao TEXT,
        status ENUM('pendente','confirmada','cancelada','concluida') DEFAULT 'pendente',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
        id_movimentacao INT AUTO_INCREMENT PRIMARY KEY,
        id_insumo INT,
        tipo ENUM('entrada','saida','ajuste') NOT NULL,
        quantidade DECIMAL(10,2) NOT NULL,
        motivo VARCHAR(255),
        usuario VARCHAR(100),
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS caixa (
        id_caixa INT AUTO_INCREMENT PRIMARY KEY,
        tipo ENUM('abertura','fechamento') NOT NULL,
        valor_inicial DECIMAL(10,2) DEFAULT 0,
        valor_final DECIMAL(10,2) DEFAULT 0,
        valor_sangria DECIMAL(10,2) DEFAULT 0,
        valor_suprimento DECIMAL(10,2) DEFAULT 0,
        observacao TEXT,
        usuario VARCHAR(100),
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
        status ENUM('aberto','fechado') DEFAULT 'aberto'
    )`,
    `CREATE TABLE IF NOT EXISTS avaliacoes (
        id_avaliacao INT AUTO_INCREMENT PRIMARY KEY,
        numero_mesa INT,
        cliente_nome VARCHAR(150),
        nota INT NOT NULL CHECK(nota BETWEEN 1 AND 5),
        comentario TEXT,
        categoria ENUM('atendimento','comida','ambiente','tempo_espera','geral') DEFAULT 'geral',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS despesas (
        id_despesa INT AUTO_INCREMENT PRIMARY KEY,
        descricao VARCHAR(255) NOT NULL,
        categoria ENUM('aluguel','energia','agua','internet','salarios','manutencao','limpeza','marketing','outros') DEFAULT 'outros',
        valor DECIMAL(10,2) NOT NULL,
        data_vencimento DATE,
        data_pagamento DATE,
        status ENUM('pendente','pago','atrasado') DEFAULT 'pendente',
        recorrente TINYINT DEFAULT 0,
        observacao TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS audit_log (
        id_log INT AUTO_INCREMENT PRIMARY KEY,
        usuario VARCHAR(100),
        acao VARCHAR(100) NOT NULL,
        tabela_afetada VARCHAR(100),
        registro_id INT,
        detalhes TEXT,
        ip VARCHAR(50),
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS alertas (
        id_alerta INT AUTO_INCREMENT PRIMARY KEY,
        tipo ENUM('estoque_baixo','validade','reserva','caixa','sistema') NOT NULL,
        titulo VARCHAR(200) NOT NULL,
        mensagem TEXT,
        prioridade ENUM('baixa','media','alta','critica') DEFAULT 'media',
        lido TINYINT DEFAULT 0,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS cardapio_config (
        id_config INT AUTO_INCREMENT PRIMARY KEY,
        id_produto INT,
        destaque TINYINT DEFAULT 0,
        descricao_cardapio TEXT,
        imagem_url VARCHAR(500),
        disponivel TINYINT DEFAULT 1,
        ordem_exibicao INT DEFAULT 0,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS metas (
        id_meta INT AUTO_INCREMENT PRIMARY KEY,
        descricao VARCHAR(255) NOT NULL,
        tipo ENUM('vendas','economia','atendimento','avaliacao') DEFAULT 'vendas',
        valor_meta DECIMAL(10,2) NOT NULL,
        valor_atual DECIMAL(10,2) DEFAULT 0,
        data_inicio DATE,
        data_fim DATE,
        status ENUM('ativa','concluida','expirada') DEFAULT 'ativa',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS pedidos_balcao (
        id_pedido_balcao INT AUTO_INCREMENT PRIMARY KEY,
        cliente_nome VARCHAR(150),
        itens_json LONGTEXT,
        valor_total DECIMAL(10,2) NOT NULL DEFAULT 0,
        forma_pagamento VARCHAR(50),
        observacao TEXT,
        status ENUM('aberto','preparando','pronto','finalizado','cancelado') DEFAULT 'aberto',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS pedidos_delivery (
        id_pedido_delivery INT AUTO_INCREMENT PRIMARY KEY,
        cliente_nome VARCHAR(150) NOT NULL,
        telefone VARCHAR(20),
        endereco VARCHAR(255) NOT NULL,
        bairro VARCHAR(120),
        itens_json LONGTEXT,
        valor_total DECIMAL(10,2) NOT NULL DEFAULT 0,
        taxa_entrega DECIMAL(10,2) DEFAULT 0,
        forma_pagamento VARCHAR(50),
        observacao TEXT,
        status ENUM('recebido','preparando','saiu_entrega','entregue','cancelado') DEFAULT 'recebido',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS lancamentos_mesa (
        id_lancamento INT AUTO_INCREMENT PRIMARY KEY,
        numero_mesa INT NOT NULL,
        id_produto INT NULL,
        item_nome VARCHAR(180) NOT NULL,
        quantidade DECIMAL(10,2) NOT NULL DEFAULT 1,
        valor_unitario DECIMAL(10,2) NOT NULL DEFAULT 0,
        subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
        observacao TEXT,
        usuario VARCHAR(100),
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_lanc_mesa_numero (numero_mesa),
        INDEX idx_lanc_mesa_produto (id_produto),
        INDEX idx_lanc_mesa_data (criado_em)
    )`
];

// Dropar tabelas com schema antigo e recriar
const tabelasVerificar = {
    fornecedores: 'nome', reservas: 'cliente_nome', movimentacoes_estoque: 'id_insumo',
    caixa: 'valor_inicial', avaliacoes: 'nota', despesas: 'descricao',
    audit_log: 'acao', alertas: 'tipo', cardapio_config: 'id_produto', metas: 'valor_meta',
    pedidos_balcao: 'valor_total', pedidos_delivery: 'endereco', lancamentos_mesa: 'item_nome'
};
Object.entries(tabelasVerificar).forEach(([tabela, colunaCheck]) => {
    db.query(`SHOW COLUMNS FROM ${tabela} LIKE '${colunaCheck}'`, (err, rows) => {
        if (err || (rows && rows.length === 0)) {
            // Tabela não existe ou falta coluna essencial - dropar e recriar
            db.query(`DROP TABLE IF EXISTS ${tabela}`, () => {
                const sql = migracoes.find(s => s.toLowerCase().includes(tabela));
                if (sql) db.query(sql, (e2) => {
                    if (e2) console.error(`Recriar ${tabela} falhou:`, e2.message);
                    else console.log(`Tabela ${tabela} recriada.`);
                });
            });
        }
    });
});

migracoes.forEach((sql, i) => {
    db.query(sql, (err) => {
        if (err && !err.message.includes('already exists')) console.error(`Migração ${i + 1} falhou:`, err.message);
    });
});

// Função auxiliar para log de auditoria
function registrarAuditoria(usuario, acao, tabela, registroId, detalhes) {
    db.query(
        'INSERT INTO audit_log (usuario, acao, tabela_afetada, registro_id, detalhes) VALUES (?, ?, ?, ?, ?)',
        [usuario || 'sistema', acao, tabela, registroId || null, detalhes || null]
    );
}

// Função para gerar alertas automáticos
function gerarAlertasAutomaticos() {
    // Estoque baixo
    db.query(`SELECT nome, estoque_atual FROM insumos WHERE ativo = 1 AND estoque_atual <= 5`, (err, rows) => {
        if (!err && rows) {
            rows.forEach(i => {
                db.query(`SELECT COUNT(*) as c FROM alertas WHERE tipo='estoque_baixo' AND titulo LIKE ? AND lido=0`,
                    [`%${i.nome}%`], (e2, r2) => {
                    if (!e2 && r2[0].c === 0) {
                        db.query(`INSERT INTO alertas (tipo, titulo, mensagem, prioridade) VALUES (?, ?, ?, ?)`,
                            ['estoque_baixo', `Estoque baixo: ${i.nome}`, `O insumo "${i.nome}" está com estoque em ${i.estoque_atual}.`, i.estoque_atual <= 2 ? 'critica' : 'alta']);
                    }
                });
            });
        }
    });
    // Despesas atrasadas
    db.query(`SELECT descricao, data_vencimento FROM despesas WHERE status='pendente' AND data_vencimento < CURDATE()`, (err, rows) => {
        if (!err && rows) {
            rows.forEach(d => {
                db.query(`UPDATE despesas SET status='atrasado' WHERE descricao=? AND status='pendente' AND data_vencimento < CURDATE()`, [d.descricao]);
                db.query(`INSERT INTO alertas (tipo, titulo, mensagem, prioridade) VALUES (?, ?, ?, ?)`,
                    ['sistema', `Despesa atrasada: ${d.descricao}`, `A despesa "${d.descricao}" venceu em ${d.data_vencimento}.`, 'alta']);
            });
        }
    });
}

// Executar alertas a cada 5 minutos
setInterval(gerarAlertasAutomaticos, 300000);
setTimeout(gerarAlertasAutomaticos, 10000); // Primeira execução 10s após iniciar

// Auto-fix: adicionar coluna ativo se não existir
const autoFixColumns = [
    { table: 'fornecedores', column: 'ativo', sql: 'ALTER TABLE fornecedores ADD COLUMN ativo TINYINT DEFAULT 1' },
    { table: 'insumos', column: 'estoque_atual', sql: 'ALTER TABLE insumos ADD COLUMN estoque_atual DECIMAL(10,2) DEFAULT 0' }
];
autoFixColumns.forEach(fix => {
    db.query(`SHOW COLUMNS FROM ${fix.table} LIKE '${fix.column}'`, (err, rows) => {
        if (!err && rows && rows.length === 0) {
            db.query(fix.sql, (e2) => {
                if (!e2) console.log(`Coluna ${fix.column} adicionada à tabela ${fix.table}`);
            });
        }
    });
});

/* ===== FORNECEDORES ===== */
app.get('/api/fornecedores', (req, res) => {
    const ativo = req.query.ativo !== undefined ? req.query.ativo : '1';
    db.query('SELECT * FROM fornecedores WHERE ativo = ? ORDER BY nome', [ativo], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.post('/api/fornecedores', (req, res) => {
    const { nome, cnpj, telefone, email, endereco, contato, observacao } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ success: false, message: 'Nome é obrigatório.' });
    db.query('INSERT INTO fornecedores (nome, cnpj, telefone, email, endereco, contato, observacao) VALUES (?,?,?,?,?,?,?)',
        [nome.trim(), cnpj || '', telefone || '', email || '', endereco || '', contato || '', observacao || ''],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            registrarAuditoria(req.body.usuario, 'criar', 'fornecedores', result.insertId, `Fornecedor: ${nome}`);
            res.json({ success: true, message: 'Fornecedor cadastrado!', id: result.insertId });
        });
});

app.put('/api/fornecedores/:id', (req, res) => {
    const { nome, cnpj, telefone, email, endereco, contato, observacao } = req.body;
    db.query('UPDATE fornecedores SET nome=?, cnpj=?, telefone=?, email=?, endereco=?, contato=?, observacao=? WHERE id_fornecedor=?',
        [nome, cnpj || '', telefone || '', email || '', endereco || '', contato || '', observacao || '', req.params.id],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            registrarAuditoria(req.body.usuario, 'editar', 'fornecedores', Number(req.params.id), `Fornecedor: ${nome}`);
            res.json({ success: true, message: 'Fornecedor atualizado!' });
        });
});

app.delete('/api/fornecedores/:id', (req, res) => {
    db.query('UPDATE fornecedores SET ativo = 0 WHERE id_fornecedor = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        registrarAuditoria('sistema', 'excluir', 'fornecedores', Number(req.params.id));
        res.json({ success: true, message: 'Fornecedor removido!' });
    });
});

/* ===== RESERVAS ===== */
app.get('/api/reservas', (req, res) => {
    const status = req.query.status || '';
    const data = req.query.data || '';
    let sql = 'SELECT * FROM reservas WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (data) { sql += ' AND data_reserva = ?'; params.push(data); }
    sql += ' ORDER BY data_reserva DESC, hora_reserva ASC';
    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.post('/api/reservas', (req, res) => {
    const { numero_mesa, cliente_nome, cliente_telefone, data_reserva, hora_reserva, qtd_pessoas, observacao } = req.body;
    if (!numero_mesa || !cliente_nome || !data_reserva || !hora_reserva)
        return res.status(400).json({ success: false, message: 'Mesa, cliente, data e hora são obrigatórios.' });
    // Verificar conflito
    db.query(`SELECT COUNT(*) as c FROM reservas WHERE numero_mesa=? AND data_reserva=? AND hora_reserva=? AND status IN ('pendente','confirmada')`,
        [numero_mesa, data_reserva, hora_reserva], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (rows[0].c > 0) return res.status(409).json({ success: false, message: 'Já existe reserva para esta mesa neste horário.' });
            db.query('INSERT INTO reservas (numero_mesa, cliente_nome, cliente_telefone, data_reserva, hora_reserva, qtd_pessoas, observacao) VALUES (?,?,?,?,?,?,?)',
                [numero_mesa, cliente_nome, cliente_telefone || '', data_reserva, hora_reserva, qtd_pessoas || 1, observacao || ''],
                (e2, result) => {
                    if (e2) return res.status(500).json({ success: false, message: e2.message });
                    // Marcar mesa como reservada
                    db.query("UPDATE mesas SET status='reservada' WHERE numero_mesa=? AND status='livre'", [numero_mesa]);
                    registrarAuditoria('sistema', 'criar', 'reservas', result.insertId, `Reserva: ${cliente_nome} - Mesa ${numero_mesa}`);
                    res.json({ success: true, message: 'Reserva criada!', id: result.insertId });
                });
        });
});

app.put('/api/reservas/:id/status', (req, res) => {
    const { status } = req.body;
    if (!['pendente', 'confirmada', 'cancelada', 'concluida'].includes(status))
        return res.status(400).json({ success: false, message: 'Status inválido.' });
    db.query('UPDATE reservas SET status=? WHERE id_reserva=?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (status === 'cancelada') {
            db.query(`SELECT numero_mesa FROM reservas WHERE id_reserva=?`, [req.params.id], (e2, rows) => {
                if (!e2 && rows.length) db.query("UPDATE mesas SET status='livre' WHERE numero_mesa=? AND status='reservada'", [rows[0].numero_mesa]);
            });
        }
        registrarAuditoria('sistema', 'atualizar_status', 'reservas', Number(req.params.id), `Status: ${status}`);
        res.json({ success: true, message: `Reserva ${status}.` });
    });
});

app.delete('/api/reservas/:id', (req, res) => {
    db.query('DELETE FROM reservas WHERE id_reserva=?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: 'Reserva excluída!' });
    });
});

/* ===== MOVIMENTAÇÕES DE ESTOQUE ===== */
app.get('/api/estoque/movimentacoes', (req, res) => {
    const limite = Math.min(Number(req.query.limite || 50), 200);
    db.query(`SELECT m.*, COALESCE(i.nome, CONCAT('ID ', m.id_insumo)) as insumo_nome
        FROM movimentacoes_estoque m LEFT JOIN insumos i ON m.id_insumo = i.id_insumo
        ORDER BY m.criado_em DESC LIMIT ?`, [limite], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.post('/api/estoque/movimentar', (req, res) => {
    const { id_insumo, tipo, quantidade, motivo, usuario } = req.body;
    if (!id_insumo || !tipo || !quantidade)
        return res.status(400).json({ success: false, message: 'Insumo, tipo e quantidade são obrigatórios.' });
    if (!['entrada', 'saida', 'ajuste'].includes(tipo))
        return res.status(400).json({ success: false, message: 'Tipo deve ser entrada, saida ou ajuste.' });
    const qty = Number(quantidade);
    db.query('INSERT INTO movimentacoes_estoque (id_insumo, tipo, quantidade, motivo, usuario) VALUES (?,?,?,?,?)',
        [id_insumo, tipo, qty, motivo || '', usuario || ''], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            // Atualizar estoque do insumo
            let updateSql;
            if (tipo === 'entrada') updateSql = 'UPDATE insumos SET estoque_atual = estoque_atual + ? WHERE id_insumo = ?';
            else if (tipo === 'saida') updateSql = 'UPDATE insumos SET estoque_atual = GREATEST(0, estoque_atual - ?) WHERE id_insumo = ?';
            else updateSql = 'UPDATE insumos SET estoque_atual = ? WHERE id_insumo = ?';
            db.query(updateSql, [qty, id_insumo]);
            registrarAuditoria(usuario, tipo, 'movimentacoes_estoque', result.insertId, `Insumo ${id_insumo}: ${tipo} ${qty}`);
            res.json({ success: true, message: `Movimentação de ${tipo} registrada!`, id: result.insertId });
        });
});

/* ===== CAIXA ===== */
app.get('/api/caixa/status', (req, res) => {
    db.query("SELECT * FROM caixa WHERE status='aberto' ORDER BY data_hora DESC LIMIT 1", (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows.length > 0 ? { aberto: true, caixa: rows[0] } : { aberto: false, caixa: null });
    });
});

app.get('/api/caixa/historico', (req, res) => {
    const limite = Math.min(Number(req.query.limite || 30), 100);
    db.query('SELECT * FROM caixa ORDER BY data_hora DESC LIMIT ?', [limite], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.post('/api/caixa/abrir', (req, res) => {
    const { valor_inicial, usuario, observacao } = req.body;
    // Verificar se já tem caixa aberto
    db.query("SELECT COUNT(*) as c FROM caixa WHERE status='aberto'", (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (rows[0].c > 0) return res.status(409).json({ success: false, message: 'Já existe um caixa aberto.' });
        db.query("INSERT INTO caixa (tipo, valor_inicial, usuario, observacao, status) VALUES ('abertura', ?, ?, ?, 'aberto')",
            [Number(valor_inicial || 0), usuario || '', observacao || ''], (e2, result) => {
                if (e2) return res.status(500).json({ success: false, message: e2.message });
                registrarAuditoria(usuario, 'abrir_caixa', 'caixa', result.insertId, `Valor inicial: R$ ${valor_inicial}`);
                res.json({ success: true, message: 'Caixa aberto!', id: result.insertId });
            });
    });
});

app.post('/api/caixa/fechar', (req, res) => {
    const { valor_final, valor_sangria, valor_suprimento, usuario, observacao } = req.body;
    db.query("SELECT * FROM caixa WHERE status='aberto' ORDER BY data_hora DESC LIMIT 1", (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Nenhum caixa aberto.' });
        const caixa = rows[0];
        db.query("UPDATE caixa SET tipo='fechamento', valor_final=?, valor_sangria=?, valor_suprimento=?, usuario=COALESCE(?,usuario), observacao=COALESCE(?,observacao), status='fechado' WHERE id_caixa=?",
            [Number(valor_final || 0), Number(valor_sangria || 0), Number(valor_suprimento || 0), usuario, observacao, caixa.id_caixa], (e2) => {
                if (e2) return res.status(500).json({ success: false, message: e2.message });
                registrarAuditoria(usuario, 'fechar_caixa', 'caixa', caixa.id_caixa, `Valor final: R$ ${valor_final}`);
                res.json({ success: true, message: 'Caixa fechado!', caixa_id: caixa.id_caixa });
            });
    });
});

/* ===== AVALIAÇÕES ===== */
app.get('/api/avaliacoes', (req, res) => {
    const limite = Math.min(Number(req.query.limite || 50), 200);
    db.query('SELECT * FROM avaliacoes ORDER BY criado_em DESC LIMIT ?', [limite], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.get('/api/avaliacoes/resumo', (req, res) => {
    db.query(`SELECT
        COUNT(*) as total,
        COALESCE(AVG(nota), 0) as media,
        SUM(CASE WHEN nota >= 4 THEN 1 ELSE 0 END) as positivas,
        SUM(CASE WHEN nota <= 2 THEN 1 ELSE 0 END) as negativas,
        SUM(CASE WHEN categoria='atendimento' THEN nota ELSE 0 END) / GREATEST(SUM(CASE WHEN categoria='atendimento' THEN 1 ELSE 0 END),1) as media_atendimento,
        SUM(CASE WHEN categoria='comida' THEN nota ELSE 0 END) / GREATEST(SUM(CASE WHEN categoria='comida' THEN 1 ELSE 0 END),1) as media_comida,
        SUM(CASE WHEN categoria='ambiente' THEN nota ELSE 0 END) / GREATEST(SUM(CASE WHEN categoria='ambiente' THEN 1 ELSE 0 END),1) as media_ambiente
    FROM avaliacoes`, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows[0] || {});
    });
});

app.post('/api/avaliacoes', (req, res) => {
    const { numero_mesa, cliente_nome, nota, comentario, categoria } = req.body;
    if (!nota || nota < 1 || nota > 5) return res.status(400).json({ success: false, message: 'Nota deve ser de 1 a 5.' });
    db.query('INSERT INTO avaliacoes (numero_mesa, cliente_nome, nota, comentario, categoria) VALUES (?,?,?,?,?)',
        [numero_mesa || null, cliente_nome || 'Anônimo', Number(nota), comentario || '', categoria || 'geral'],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Avaliação registrada!', id: result.insertId });
        });
});

app.delete('/api/avaliacoes/:id', (req, res) => {
    db.query('DELETE FROM avaliacoes WHERE id_avaliacao=?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: 'Avaliação excluída!' });
    });
});

/* ===== DESPESAS ===== */
app.get('/api/despesas', (req, res) => {
    const status = req.query.status || '';
    const categoria = req.query.categoria || '';
    let sql = 'SELECT * FROM despesas WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (categoria) { sql += ' AND categoria = ?'; params.push(categoria); }
    sql += ' ORDER BY data_vencimento DESC';
    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.get('/api/despesas/resumo', (req, res) => {
    db.query(`SELECT
        COUNT(*) as total,
        COALESCE(SUM(valor), 0) as valor_total,
        SUM(CASE WHEN status='pago' THEN valor ELSE 0 END) as total_pago,
        SUM(CASE WHEN status='pendente' THEN valor ELSE 0 END) as total_pendente,
        SUM(CASE WHEN status='atrasado' THEN valor ELSE 0 END) as total_atrasado,
        SUM(CASE WHEN status='atrasado' THEN 1 ELSE 0 END) as qtd_atrasadas
    FROM despesas`, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows[0] || {});
    });
});

app.post('/api/despesas', (req, res) => {
    const { descricao, categoria, valor, data_vencimento, data_pagamento, status, recorrente, observacao } = req.body;
    if (!descricao || !valor) return res.status(400).json({ success: false, message: 'Descrição e valor são obrigatórios.' });
    db.query('INSERT INTO despesas (descricao, categoria, valor, data_vencimento, data_pagamento, status, recorrente, observacao) VALUES (?,?,?,?,?,?,?,?)',
        [descricao, categoria || 'outros', Number(valor), data_vencimento || null, data_pagamento || null, status || 'pendente', recorrente ? 1 : 0, observacao || ''],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            registrarAuditoria(req.body.usuario, 'criar', 'despesas', result.insertId, `Despesa: ${descricao} R$ ${valor}`);
            res.json({ success: true, message: 'Despesa cadastrada!', id: result.insertId });
        });
});

app.put('/api/despesas/:id', (req, res) => {
    const { descricao, categoria, valor, data_vencimento, data_pagamento, status, recorrente, observacao } = req.body;
    db.query('UPDATE despesas SET descricao=?, categoria=?, valor=?, data_vencimento=?, data_pagamento=?, status=?, recorrente=?, observacao=? WHERE id_despesa=?',
        [descricao, categoria, Number(valor), data_vencimento || null, data_pagamento || null, status, recorrente ? 1 : 0, observacao || '', req.params.id],
        (err) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Despesa atualizada!' });
        });
});

app.put('/api/despesas/:id/pagar', (req, res) => {
    db.query("UPDATE despesas SET status='pago', data_pagamento=CURDATE() WHERE id_despesa=?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        registrarAuditoria('sistema', 'pagar', 'despesas', Number(req.params.id));
        res.json({ success: true, message: 'Despesa marcada como paga!' });
    });
});

app.delete('/api/despesas/:id', (req, res) => {
    db.query('DELETE FROM despesas WHERE id_despesa=?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: 'Despesa excluída!' });
    });
});

/* ===== LOG DE AUDITORIA ===== */
app.get('/api/auditoria', (req, res) => {
    const limite = Math.min(Number(req.query.limite || 50), 500);
    const tabela = req.query.tabela || '';
    const usuario = req.query.usuario || '';
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];
    if (tabela) { sql += ' AND tabela_afetada = ?'; params.push(tabela); }
    if (usuario) { sql += ' AND usuario LIKE ?'; params.push(`%${usuario}%`); }
    sql += ' ORDER BY criado_em DESC LIMIT ?';
    params.push(limite);
    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

/* ===== ALERTAS ===== */
app.get('/api/alertas', (req, res) => {
    const lido = req.query.lido !== undefined ? req.query.lido : '0';
    db.query('SELECT * FROM alertas WHERE lido = ? ORDER BY criado_em DESC LIMIT 50', [lido], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.get('/api/alertas/contagem', (req, res) => {
    db.query('SELECT COUNT(*) as nao_lidos FROM alertas WHERE lido = 0', (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows[0] || { nao_lidos: 0 });
    });
});

app.put('/api/alertas/:id/ler', (req, res) => {
    db.query('UPDATE alertas SET lido = 1 WHERE id_alerta = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.put('/api/alertas/ler-todos', (req, res) => {
    db.query('UPDATE alertas SET lido = 1 WHERE lido = 0', (err, result) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, message: `${result.affectedRows} alertas marcados como lidos.` });
    });
});

/* ===== CARDÁPIO ===== */
app.get('/api/cardapio', (req, res) => {
    db.query(`SELECT p.*, c.nome as categoria_nome,
        COALESCE(cc.descricao_cardapio, '') as descricao_cardapio,
        COALESCE(cc.destaque, 0) as destaque,
        COALESCE(cc.disponivel, 1) as disponivel,
        COALESCE(cc.ordem_exibicao, 0) as ordem_exibicao,
        COALESCE(cc.imagem_url, '') as imagem_url
        FROM produtos p
        LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
        LEFT JOIN cardapio_config cc ON p.id_produto = cc.id_produto
        WHERE p.ativo = 1
        ORDER BY cc.ordem_exibicao ASC, p.nome ASC`, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.post('/api/cardapio/configurar', (req, res) => {
    const { id_produto, destaque, descricao_cardapio, disponivel, ordem_exibicao, imagem_url } = req.body;
    if (!id_produto) return res.status(400).json({ success: false, message: 'Produto é obrigatório.' });
    db.query('SELECT COUNT(*) as c FROM cardapio_config WHERE id_produto=?', [id_produto], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        const sql = rows[0].c > 0
            ? 'UPDATE cardapio_config SET destaque=?, descricao_cardapio=?, disponivel=?, ordem_exibicao=?, imagem_url=? WHERE id_produto=?'
            : 'INSERT INTO cardapio_config (destaque, descricao_cardapio, disponivel, ordem_exibicao, imagem_url, id_produto) VALUES (?,?,?,?,?,?)';
        db.query(sql, [destaque ? 1 : 0, descricao_cardapio || '', disponivel !== false ? 1 : 0, ordem_exibicao || 0, imagem_url || '', id_produto], (e2) => {
            if (e2) return res.status(500).json({ success: false, message: e2.message });
            res.json({ success: true, message: 'Configuração do cardápio salva!' });
        });
    });
});

/* ===== METAS ===== */
app.get('/api/metas', (req, res) => {
    db.query('SELECT * FROM metas ORDER BY data_fim DESC', (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.post('/api/metas', (req, res) => {
    const { descricao, tipo, valor_meta, data_inicio, data_fim } = req.body;
    if (!descricao || !valor_meta)
        return res.status(400).json({ success: false, message: 'Descrição e valor da meta são obrigatórios.' });
    db.query('INSERT INTO metas (descricao, tipo, valor_meta, data_inicio, data_fim) VALUES (?,?,?,?,?)',
        [descricao, tipo || 'vendas', Number(valor_meta), data_inicio || null, data_fim || null],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Meta criada!', id: result.insertId });
        });
});

app.put('/api/metas/:id', (req, res) => {
    const { valor_atual, status } = req.body;
    const sets = [];
    const params = [];
    if (valor_atual !== undefined) { sets.push('valor_atual=?'); params.push(Number(valor_atual)); }
    if (status) { sets.push('status=?'); params.push(status); }
    if (sets.length === 0) return res.status(400).json({ success: false, message: 'Nada para atualizar.' });
    params.push(req.params.id);
    db.query(`UPDATE metas SET ${sets.join(', ')} WHERE id_meta=?`, params, (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: 'Meta atualizada!' });
    });
});

app.delete('/api/metas/:id', (req, res) => {
    db.query('DELETE FROM metas WHERE id_meta=?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: 'Meta excluída!' });
    });
});

/* ===== BALCÃO ===== */
app.get('/api/balcao', (req, res) => {
    const status = req.query.status || '';
    const limite = Math.min(Number(req.query.limite || 100), 300);
    let sql = 'SELECT * FROM pedidos_balcao WHERE 1=1';
    const params = [];
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }
    sql += ' ORDER BY criado_em DESC LIMIT ?';
    params.push(limite);
    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows || []);
    });
});

app.get('/api/balcao/resumo', (req, res) => {
    db.query(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('aberto','preparando','pronto') THEN 1 ELSE 0 END) as em_andamento,
        SUM(CASE WHEN status='finalizado' THEN 1 ELSE 0 END) as finalizados,
        COALESCE(SUM(CASE WHEN DATE(criado_em)=CURDATE() AND status='finalizado' THEN valor_total ELSE 0 END),0) as faturamento_hoje
    FROM pedidos_balcao`, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows[0] || {});
    });
});

app.post('/api/balcao', (req, res) => {
    const { cliente_nome, itens_json, valor_total, forma_pagamento, observacao, status, usuario } = req.body;
    const valor = Number(valor_total || 0);
    if (valor <= 0) return res.status(400).json({ success: false, message: 'Valor total deve ser maior que zero.' });
    db.query(
        'INSERT INTO pedidos_balcao (cliente_nome, itens_json, valor_total, forma_pagamento, observacao, status) VALUES (?,?,?,?,?,?)',
        [cliente_nome || 'Cliente Balcão', itens_json || '[]', valor, forma_pagamento || 'não informado', observacao || '', status || 'aberto'],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            registrarAuditoria(usuario, 'criar', 'pedidos_balcao', result.insertId, `Pedido balcão R$ ${valor.toFixed(2)}`);
            res.json({ success: true, message: 'Pedido de balcão criado!', id: result.insertId });
        }
    );
});

app.put('/api/balcao/:id/status', (req, res) => {
    const { status, usuario } = req.body;
    const permitidos = ['aberto', 'preparando', 'pronto', 'finalizado', 'cancelado'];
    if (!permitidos.includes(status)) {
        return res.status(400).json({ success: false, message: 'Status inválido para balcão.' });
    }
    db.query('UPDATE pedidos_balcao SET status=? WHERE id_pedido_balcao=?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        registrarAuditoria(usuario, 'atualizar_status', 'pedidos_balcao', Number(req.params.id), `Status: ${status}`);
        res.json({ success: true, message: 'Status do balcão atualizado!' });
    });
});

app.delete('/api/balcao/:id', (req, res) => {
    db.query('DELETE FROM pedidos_balcao WHERE id_pedido_balcao=?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: 'Pedido de balcão excluído!' });
    });
});

/* ===== DELIVERY ===== */
app.get('/api/delivery', (req, res) => {
    const status = req.query.status || '';
    const limite = Math.min(Number(req.query.limite || 100), 300);
    let sql = 'SELECT * FROM pedidos_delivery WHERE 1=1';
    const params = [];
    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }
    sql += ' ORDER BY criado_em DESC LIMIT ?';
    params.push(limite);
    db.query(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows || []);
    });
});

app.get('/api/delivery/resumo', (req, res) => {
    db.query(`SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('recebido','preparando','saiu_entrega') THEN 1 ELSE 0 END) as em_andamento,
        SUM(CASE WHEN status='entregue' THEN 1 ELSE 0 END) as entregues,
        COALESCE(SUM(CASE WHEN DATE(criado_em)=CURDATE() AND status='entregue' THEN valor_total + taxa_entrega ELSE 0 END),0) as faturamento_hoje
    FROM pedidos_delivery`, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows[0] || {});
    });
});

app.post('/api/delivery', (req, res) => {
    const { cliente_nome, telefone, endereco, bairro, itens_json, valor_total, taxa_entrega, forma_pagamento, observacao, status, usuario } = req.body;
    const valor = Number(valor_total || 0);
    if (!cliente_nome || !endereco || valor <= 0) {
        return res.status(400).json({ success: false, message: 'Cliente, endereço e valor total são obrigatórios.' });
    }
    db.query(
        'INSERT INTO pedidos_delivery (cliente_nome, telefone, endereco, bairro, itens_json, valor_total, taxa_entrega, forma_pagamento, observacao, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [cliente_nome, telefone || '', endereco, bairro || '', itens_json || '[]', valor, Number(taxa_entrega || 0), forma_pagamento || 'não informado', observacao || '', status || 'recebido'],
        (err, result) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            registrarAuditoria(usuario, 'criar', 'pedidos_delivery', result.insertId, `Pedido delivery R$ ${valor.toFixed(2)}`);
            res.json({ success: true, message: 'Pedido de delivery criado!', id: result.insertId });
        }
    );
});

app.put('/api/delivery/:id/status', (req, res) => {
    const { status, usuario } = req.body;
    const permitidos = ['recebido', 'preparando', 'saiu_entrega', 'entregue', 'cancelado'];
    if (!permitidos.includes(status)) {
        return res.status(400).json({ success: false, message: 'Status inválido para delivery.' });
    }
    db.query('UPDATE pedidos_delivery SET status=? WHERE id_pedido_delivery=?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        registrarAuditoria(usuario, 'atualizar_status', 'pedidos_delivery', Number(req.params.id), `Status: ${status}`);
        res.json({ success: true, message: 'Status do delivery atualizado!' });
    });
});

app.delete('/api/delivery/:id', (req, res) => {
    db.query('DELETE FROM pedidos_delivery WHERE id_pedido_delivery=?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: 'Pedido de delivery excluído!' });
    });
});

/* ===== CENTRAL DE ATENDIMENTO ===== */
app.get('/api/atendimento/resumo', (req, res) => {
    const queries = {
        balcao_abertos: "SELECT COUNT(*) as total FROM pedidos_balcao WHERE status IN ('aberto','preparando','pronto')",
        delivery_abertos: "SELECT COUNT(*) as total FROM pedidos_delivery WHERE status IN ('recebido','preparando','saiu_entrega')",
        balcao_hoje: "SELECT COALESCE(SUM(valor_total),0) as total FROM pedidos_balcao WHERE DATE(criado_em)=CURDATE() AND status='finalizado'",
        delivery_hoje: "SELECT COALESCE(SUM(valor_total + taxa_entrega),0) as total FROM pedidos_delivery WHERE DATE(criado_em)=CURDATE() AND status='entregue'"
    };
    const resultado = {};
    let pendentes = Object.keys(queries).length;
    Object.entries(queries).forEach(([chave, sql]) => {
        db.query(sql, (err, rows) => {
            resultado[chave] = (!err && rows && rows[0]) ? rows[0].total : 0;
            pendentes--;
            if (pendentes === 0) {
                resultado.total_abertos = Number(resultado.balcao_abertos || 0) + Number(resultado.delivery_abertos || 0);
                resultado.faturamento_hoje = Number(resultado.balcao_hoje || 0) + Number(resultado.delivery_hoje || 0);
                res.json(resultado);
            }
        });
    });
});

app.get('/api/atendimento/fila', (req, res) => {
    const limite = Math.min(Number(req.query.limite || 20), 100);
    const sql = `
        SELECT * FROM (
            SELECT
                'balcao' as origem,
                id_pedido_balcao as id,
                COALESCE(cliente_nome, 'Cliente Balcão') as cliente,
                status,
                valor_total as total,
                criado_em,
                TIMESTAMPDIFF(MINUTE, criado_em, NOW()) as minutos_aberto
            FROM pedidos_balcao
            WHERE status IN ('aberto','preparando','pronto')

            UNION ALL

            SELECT
                'delivery' as origem,
                id_pedido_delivery as id,
                cliente_nome as cliente,
                status,
                (valor_total + COALESCE(taxa_entrega,0)) as total,
                criado_em,
                TIMESTAMPDIFF(MINUTE, criado_em, NOW()) as minutos_aberto
            FROM pedidos_delivery
            WHERE status IN ('recebido','preparando','saiu_entrega')
        ) fila
        ORDER BY minutos_aberto DESC, criado_em ASC
        LIMIT ?
    `;

    db.query(sql, [limite], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows || []);
    });
});

/* ===== RELATÓRIO GERENCIAL CONSOLIDADO ===== */
app.get('/api/relatorio-gerencial', (req, res) => {
    const queries = {
        vendas: "SELECT COALESCE(SUM(valor_pago),0) as total FROM pagamentos WHERE DATE(data_pagamento) = CURDATE()",
        compras: "SELECT COALESCE(SUM(valor_total_nota),0) as total FROM compras WHERE DATE(data_compra) = CURDATE()",
        despesas_mes: "SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE MONTH(data_vencimento) = MONTH(CURDATE()) AND YEAR(data_vencimento) = YEAR(CURDATE())",
        despesas_pagas: "SELECT COALESCE(SUM(valor),0) as total FROM despesas WHERE status='pago' AND MONTH(data_pagamento) = MONTH(CURDATE())",
        avaliacoes: "SELECT COALESCE(AVG(nota),0) as media, COUNT(*) as total FROM avaliacoes",
        mesas: "SELECT COUNT(*) as total, SUM(CASE WHEN status='ocupada' THEN 1 ELSE 0 END) as ocupadas FROM mesas",
        reservas_hoje: "SELECT COUNT(*) as total FROM reservas WHERE data_reserva = CURDATE() AND status IN ('pendente','confirmada')",
        fornecedores: "SELECT COUNT(*) as total FROM fornecedores WHERE ativo=1",
        alertas: "SELECT COUNT(*) as nao_lidos FROM alertas WHERE lido=0",
        produtos: "SELECT COUNT(*) as ativos FROM produtos WHERE ativo=1",
        usuarios: "SELECT COUNT(*) as total FROM usuarios",
        balcao_hoje: "SELECT COUNT(*) as pedidos, COALESCE(SUM(valor_total),0) as total FROM pedidos_balcao WHERE DATE(criado_em)=CURDATE()",
        delivery_hoje: "SELECT COUNT(*) as pedidos, COALESCE(SUM(valor_total + taxa_entrega),0) as total FROM pedidos_delivery WHERE DATE(criado_em)=CURDATE()"
    };
    const resultado = {};
    let pending = Object.keys(queries).length;
    Object.entries(queries).forEach(([chave, sql]) => {
        db.query(sql, (err, rows) => {
            resultado[chave] = !err && rows ? rows[0] : {};
            pending--;
            if (pending === 0) res.json(resultado);
        });
    });
});

app.listen(3000, () => {
    console.log('Backend rodando em http://localhost:3000');
});
