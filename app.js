async function carregarDados() {
    try {
        const resposta = await fetch('http://localhost:3000/api/lucratividade');
        const dados = await resposta.json();

        const corpoTabela = document.querySelector('#tabela-lucro tbody');
        corpoTabela.innerHTML = '';

        dados.forEach(item => {
            const linha = `
                <tr>
                    <td style="font-weight: 500;">${item.prato}</td>
                    <td>R$ ${Number(item.preco_venda).toFixed(2)}</td>
                    <td class="valor-custo">R$ ${Number(item.custo_total).toFixed(2)}</td>
                    <td>
                        <span class="margem-badge">${item.margem_percentual}%</span>
                    </td>
                </tr>
            `;
            corpoTabela.innerHTML += linha;
        });
    } catch (erro) {
        console.error('Erro ao buscar dados:', erro);
    }
}

async function carregarValidade() {
    const corpoTabela = document.querySelector('#tabela-validade tbody');
    if (!corpoTabela) {
        return;
    }

    try {
        const resposta = await fetch('http://localhost:3000/api/validade');
        const dados = await resposta.json();

        corpoTabela.innerHTML = dados.map(item => `
            <tr>
                <td>${item.insumo}</td>
                <td>${item.codigo_lote}</td>
                <td class="valor-custo">${item.dias_para_vencer} dias</td>
            </tr>
        `).join('');
    } catch (erro) {
        console.error('Erro ao buscar validade:', erro);
    }
}

async function carregarMesas() {
    const mapaMesas = document.getElementById('mapa-mesas');
    if (!mapaMesas) {
        return;
    }

    try {
        const resposta = await fetch('http://localhost:3000/api/mesas');
        const dados = await resposta.json();

        mapaMesas.innerHTML = dados.map(mesa => `
            <div class="mesa-card ${mesa.status}">
                Mesa ${mesa.numero_mesa}<br>
                <small>${String(mesa.status).toUpperCase()}</small>
            </div>
        `).join('');
    } catch (erro) {
        console.error('Erro ao buscar mesas:', erro);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const botaoAtualizar = document.getElementById('atualizar-btn');
    if (botaoAtualizar) {
        botaoAtualizar.addEventListener('click', carregarDados);
    }

    carregarDados();
    carregarValidade();
    carregarMesas();
});

window.atualizarDashboard = carregarDados;
window.carregarValidade = carregarValidade;
window.carregarMesas = carregarMesas;