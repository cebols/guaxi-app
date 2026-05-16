import Anthropic from 'npm:@anthropic-ai/sdk@0.27.0'
import { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const client = new Anthropic()

// ── Ferramentas disponíveis para o agente ─────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'listar_produtos',
    description: 'Lista os produtos disponíveis com nome, preço e estoque.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'consultar_pedido',
    description: 'Busca pedidos pelo nome do cliente ou pelo ID do pedido.',
    input_schema: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Nome parcial do cliente' },
        pedido_id: { type: 'string', description: 'ID exato do pedido, ex: PED-001' },
      },
    },
  },
  {
    name: 'criar_pedido',
    description: 'Cria um novo pedido (encomenda) para o cliente.',
    input_schema: {
      type: 'object',
      properties: {
        cliente:      { type: 'string', description: 'Nome do cliente' },
        contato:      { type: 'string', description: 'Telefone do cliente' },
        data_entrega: { type: 'string', description: 'Data de entrega no formato YYYY-MM-DD' },
        itens: {
          type: 'array',
          description: 'Lista de itens do pedido',
          items: {
            type: 'object',
            properties: {
              produto:    { type: 'string' },
              quantidade: { type: 'number' },
              preco_unit: { type: 'number' },
            },
            required: ['produto', 'quantidade', 'preco_unit'],
          },
        },
        obs:   { type: 'string', description: 'Observações do pedido' },
        canal: { type: 'string', description: 'Canal de venda', enum: ['WhatsApp', 'iFood', '99Food', 'Keeta', 'Presencial'] },
      },
      required: ['cliente', 'contato', 'itens'],
    },
  },
]

// ── Execução das ferramentas ──────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  supabase: SupabaseClient,
  callerPhone: string
): Promise<string> {
  if (name === 'listar_produtos') {
    const { data, error } = await supabase
      .from('produtos')
      .select('nome, preco_praticado, preco_direta, estoque_atual, tipo')
      .order('nome')

    if (error) return `Erro ao buscar produtos: ${error.message}`
    if (!data?.length) return 'Nenhum produto cadastrado.'

    const lines = data
      .filter(p => p.tipo !== 'insumo')
      .map(p => {
        const preco = p.preco_praticado ?? p.preco_direta ?? 0
        const estoque = p.estoque_atual != null
          ? ` (estoque: ${p.estoque_atual})`
          : ''
        return `• ${p.nome}: R$ ${Number(preco).toFixed(2)}${estoque}`
      })

    return lines.length ? lines.join('\n') : 'Nenhum produto disponível.'
  }

  if (name === 'consultar_pedido') {
    const { cliente, pedido_id } = input as { cliente?: string; pedido_id?: string }

    let query = supabase
      .from('encomendas')
      .select('id, cliente, contato, data_entrega, status, pgto, valor, obs, encomenda_itens(produto, quantidade, preco_unit)')
      .order('created_at', { ascending: false })
      .limit(5)

    if (pedido_id) {
      query = query.eq('id', pedido_id)
    } else if (cliente) {
      query = query.ilike('cliente', `%${cliente}%`)
    } else {
      // Busca pelo telefone do remetente
      query = query.ilike('contato', `%${callerPhone.slice(-9)}%`)
    }

    const { data, error } = await query
    if (error) return `Erro: ${error.message}`
    if (!data?.length) return 'Nenhum pedido encontrado.'

    return data.map(p => {
      const itens = (p.encomenda_itens as { produto: string; quantidade: number; preco_unit: number }[])
        ?.map(i => `  - ${i.quantidade}x ${i.produto} (R$ ${Number(i.preco_unit).toFixed(2)})`)
        .join('\n') || '  sem itens'
      const entrega = p.data_entrega
        ? new Date(p.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')
        : 'sem data'
      return `*${p.id}* — ${p.cliente}\nEntrega: ${entrega} | Status: ${p.status} | Pgto: ${p.pgto}\nItens:\n${itens}\nTotal: R$ ${Number(p.valor).toFixed(2)}\n${p.obs ? 'Obs: ' + p.obs : ''}`
    }).join('\n\n')
  }

  if (name === 'criar_pedido') {
    const { cliente, contato, data_entrega, itens, obs, canal } = input as {
      cliente: string
      contato: string
      data_entrega?: string
      itens: { produto: string; quantidade: number; preco_unit: number }[]
      obs?: string
      canal?: string
    }

    // Gera ID único
    const { count } = await supabase.from('encomendas').select('*', { count: 'exact', head: true })
    const num = String((count ?? 0) + 1).padStart(3, '0')
    const pedidoId = `PED-${num}`

    const total = itens.reduce((s, i) => s + i.quantidade * i.preco_unit, 0)

    const { error: pedErr } = await supabase.from('encomendas').insert({
      id:           pedidoId,
      cliente,
      contato,
      data_entrega: data_entrega || null,
      status:       'Pendente',
      pgto:         'Aguardando',
      canal:        canal || 'WhatsApp',
      valor:        total,
      obs:          obs || '',
    })

    if (pedErr) return `Erro ao criar pedido: ${pedErr.message}`

    const itenRows = itens.map(i => ({
      encomenda_id: pedidoId,
      produto:      i.produto,
      quantidade:   i.quantidade,
      preco_unit:   i.preco_unit,
    }))

    const { error: itErr } = await supabase.from('encomenda_itens').insert(itenRows)
    if (itErr) return `Pedido criado (${pedidoId}), mas erro nos itens: ${itErr.message}`

    const entrega = data_entrega
      ? new Date(data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')
      : 'a combinar'

    return `Pedido *${pedidoId}* criado com sucesso!\nCliente: ${cliente}\nEntrega: ${entrega}\nTotal: R$ ${total.toFixed(2)}\nAguardando confirmação de pagamento.`
  }

  return `Ferramenta desconhecida: ${name}`
}

// ── Histórico de conversa ─────────────────────────────────────

async function loadHistory(supabase: SupabaseClient, telefone: string): Promise<Anthropic.MessageParam[]> {
  const { data } = await supabase
    .from('agent_conversas')
    .select('role, conteudo')
    .eq('telefone', telefone)
    .order('created_at', { ascending: true })
    .limit(20)

  return (data || []).map(r => ({
    role:    r.role as 'user' | 'assistant',
    content: r.conteudo,
  }))
}

async function saveMessage(supabase: SupabaseClient, telefone: string, role: 'user' | 'assistant', conteudo: string) {
  await supabase.from('agent_conversas').insert({ telefone, role, conteudo })
}

// ── Agente principal ──────────────────────────────────────────

const SYSTEM_PROMPT = `Você é a assistente virtual da Guaxi, uma confeitaria artesanal.
Seu nome é Guaxi. Você é simpática, direta e usa linguagem informal mas profissional.

Você pode:
- Informar produtos disponíveis e preços
- Criar encomendas/pedidos
- Consultar status de pedidos existentes

Ao criar um pedido, confirme os itens e valor total antes de finalizar.
Responda sempre em português brasileiro. Seja concisa — máximo 3 parágrafos por mensagem.
Nunca invente preços: use sempre a ferramenta listar_produtos para buscar valores reais.`

export async function runAgent(
  supabase: SupabaseClient,
  telefone: string,
  userMessage: string,
  nomeContato?: string
): Promise<string> {
  // Salva mensagem do usuário
  await saveMessage(supabase, telefone, 'user', userMessage)

  const history = await loadHistory(supabase, telefone)

  // Agentic loop com tool use
  const messages: Anthropic.MessageParam[] = history

  let response: string | null = null

  for (let turn = 0; turn < 5; turn++) {
    const result = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      tools:      TOOLS,
      messages,
    })

    if (result.stop_reason === 'end_turn') {
      response = result.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('')
      break
    }

    if (result.stop_reason === 'tool_use') {
      // Adiciona resposta do assistente ao histórico temporário
      messages.push({ role: 'assistant', content: result.content })

      // Executa todas as ferramentas solicitadas
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of result.content) {
        if (block.type !== 'tool_use') continue
        const toolResult = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
          supabase,
          telefone
        )
        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     toolResult,
        })
      }

      messages.push({ role: 'user', content: toolResults })
      continue
    }

    break
  }

  const finalResponse = response || 'Desculpe, não consegui processar sua mensagem. Tente novamente.'

  // Salva resposta do assistente
  await saveMessage(supabase, telefone, 'assistant', finalResponse)

  return finalResponse
}
