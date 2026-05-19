import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'

// ── helpers ──────────────────────────────────────────────────

function parseInstrucoes(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  return raw ? [{ tipo: 'nota', descricao: raw }] : []
}

function fmtQtd(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

function fmtR(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const ACAO_LABEL = {
  misturar: 'Misturar', bater: 'Bater', assar: 'Assar', cozinhar: 'Cozinhar',
  resfriar: 'Resfriar', congelar: 'Congelar', decorar: 'Decorar',
  derreter: 'Derreter', temperar: 'Temperar', montar: 'Montar',
  mixar: 'Mixar', liquidificar: 'Liquidificar', processar: 'Processar',
}

// ── styles ────────────────────────────────────────────────────

const TEAL = '#0d9488'
const GRAY = '#6b7280'
const BORDER = '#e5e7eb'

function makeStyles(size) {
  const isCard = size === 'card'
  const isA5   = size === 'a5'

  return StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
      padding: isCard ? 14 : isA5 ? 22 : 28,
      fontFamily: 'Helvetica',
    },
    header: {
      marginBottom: isCard ? 6 : 10,
      paddingBottom: isCard ? 6 : 10,
      borderBottomWidth: 1.5,
      borderBottomColor: TEAL,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    headerLeft: {
      flex: 1,
      flexDirection: 'column',
      marginRight: 8,
    },
    nome: {
      fontSize: isCard ? 13 : isA5 ? 16 : 20,
      fontFamily: 'Helvetica-Bold',
      color: '#111827',
    },
    badge: {
      fontSize: isCard ? 7 : 9,
      color: TEAL,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: TEAL,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 2,
      marginTop: 2,
      flexShrink: 0,
    },
    rendimento: {
      fontSize: isCard ? 8 : 10,
      color: GRAY,
      marginTop: 4,
    },
    sectionLabel: {
      fontSize: isCard ? 7 : 9,
      fontFamily: 'Helvetica-Bold',
      color: TEAL,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 4,
      marginTop: isCard ? 6 : 10,
    },
    tableHeader: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
      paddingBottom: 3,
      marginBottom: 2,
    },
    tableHeaderText: {
      fontSize: isCard ? 7 : 8,
      fontFamily: 'Helvetica-Bold',
      color: GRAY,
      textTransform: 'uppercase',
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: isCard ? 2 : 3,
      borderBottomWidth: 0.5,
      borderBottomColor: BORDER,
      alignItems: 'center',
    },
    tableRowAlt: {
      backgroundColor: '#f9fafb',
    },
    cellNome:  { flex: 3 },
    cellQtd:   { flex: 1.2, textAlign: 'right' },
    cellUnid:  { flex: 0.9, textAlign: 'right', marginLeft: 4 },
    cellCusto: { flex: 1.2, textAlign: 'right' },
    cellText: {
      fontSize: isCard ? 8 : 9.5,
      color: '#111827',
    },
    costBox: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 16,
      marginTop: isCard ? 6 : 10,
      paddingTop: isCard ? 6 : 8,
      borderTopWidth: 1,
      borderTopColor: BORDER,
    },
    costItem: {
      alignItems: 'flex-end',
    },
    costLabel: {
      fontSize: isCard ? 7 : 8,
      color: GRAY,
    },
    costValue: {
      fontSize: isCard ? 10 : 12,
      fontFamily: 'Helvetica-Bold',
      color: TEAL,
    },
    stepRow: {
      flexDirection: 'row',
      marginBottom: isA5 ? 4 : 6,
      alignItems: 'flex-start',
    },
    stepNum: {
      width: 18,
      height: 18,
      backgroundColor: TEAL,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
      marginTop: 1,
      flexShrink: 0,
    },
    stepNumText: {
      fontSize: 8,
      color: '#fff',
      fontFamily: 'Helvetica-Bold',
    },
    stepAcao: {
      fontSize: isA5 ? 8 : 9,
      fontFamily: 'Helvetica-Bold',
      color: TEAL,
    },
    stepDesc: {
      fontSize: isA5 ? 8.5 : 10,
      color: '#374151',
      flex: 1,
      lineHeight: 1.4,
    },
    infoRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: isCard ? 6 : 8,
    },
    infoBox: {
      flex: 1,
      backgroundColor: '#f3f4f6',
      borderRadius: 4,
      padding: 6,
    },
    infoLabel: {
      fontSize: 7,
      color: GRAY,
      fontFamily: 'Helvetica-Bold',
      textTransform: 'uppercase',
    },
    infoValue: {
      fontSize: isCard ? 9 : 11,
      fontFamily: 'Helvetica-Bold',
      color: '#111827',
      marginTop: 2,
    },
    footer: {
      position: 'absolute',
      bottom: 14,
      left: 28,
      right: 28,
      borderTopWidth: 0.5,
      borderTopColor: BORDER,
      paddingTop: 4,
    },
    footerText: {
      fontSize: 7,
      color: GRAY,
      textAlign: 'center',
    },
  })
}

// ── Page size map ─────────────────────────────────────────────

const PAGE_SIZES = {
  card: [283.46, 425.20],  // 10×15cm in points
  a5:   'A5',
  a4:   'A4',
}

// ── Single recipe page ────────────────────────────────────────

function ReceitaPage({ receita, size, styles }) {
  const isCard = size === 'card'
  const showSteps = !isCard
  const steps = parseInstrucoes(receita.instrucoes)
  const hasSteps = steps.length > 0
  const hasForno = receita.tempoForno && receita.tempForno
  const hasResfriamento = receita.tempoResfriamento

  return (
    <Page size={PAGE_SIZES[size]} style={styles.page}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.nome}>{receita.nome}</Text>
          <Text style={styles.rendimento}>
            {'Rendimento: '}
            {fmtQtd(receita.rendimento)} {receita.unidadeGera}
            {receita.pesoLiquido ? `  ·  ${receita.pesoLiquido}g líquido` : ''}
          </Text>
        </View>
        {receita.tipo && receita.tipo !== 'Outro' && (
          <Text style={styles.badge}>{receita.tipo}</Text>
        )}
      </View>

      {/* Ingredientes */}
      <Text style={styles.sectionLabel}>Ingredientes</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderText, styles.cellNome]}>Ingrediente</Text>
        <Text style={[styles.tableHeaderText, styles.cellQtd]}>Qtd</Text>
        <Text style={[styles.tableHeaderText, styles.cellUnid]}>Un</Text>
        {!isCard && <Text style={[styles.tableHeaderText, styles.cellCusto]}>Custo</Text>}
      </View>
      {(receita.ingredientes || []).map((ing, i) => (
        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
          <Text style={[styles.cellText, styles.cellNome]}>{ing.nome}</Text>
          <Text style={[styles.cellText, styles.cellQtd]}>{fmtQtd(ing.quantidade)}</Text>
          <Text style={[styles.cellText, styles.cellUnid]}>{ing.unidade}</Text>
          {!isCard && (
            <Text style={[styles.cellText, styles.cellCusto]}>
              {ing.custoUnit > 0 ? `R$ ${fmtR(ing.quantidade * (ing.custoUnit || 0))}` : '—'}
            </Text>
          )}
        </View>
      ))}

      {/* Forno / Resfriamento info */}
      {(hasForno || hasResfriamento) && (
        <View style={styles.infoRow}>
          {hasForno && (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>🔥 Forno</Text>
              <Text style={styles.infoValue}>{receita.tempForno}°C · {receita.tempoForno} min</Text>
            </View>
          )}
          {hasResfriamento && (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>❄️ {receita.tipoResfriamento || 'Resfriar'}</Text>
              <Text style={styles.infoValue}>{receita.tempoResfriamento}h</Text>
            </View>
          )}
        </View>
      )}

      {/* Custo */}
      <View style={styles.costBox}>
        <View style={styles.costItem}>
          <Text style={styles.costLabel}>Custo total</Text>
          <Text style={styles.costValue}>R$ {fmtR(receita.custoTotal)}</Text>
        </View>
        {receita.custoUnid > 0 && (
          <View style={styles.costItem}>
            <Text style={styles.costLabel}>Por {receita.unidadeGera}</Text>
            <Text style={styles.costValue}>R$ {fmtR(receita.custoUnid)}</Text>
          </View>
        )}
      </View>

      {/* Steps — A5 / A4 only */}
      {showSteps && hasSteps && (
        <>
          <Text style={styles.sectionLabel}>Modo de preparo</Text>
          {steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepAcao}>{ACAO_LABEL[step.tipo] || step.tipo}</Text>
                {step.descricao ? <Text style={styles.stepDesc}>{step.descricao}</Text> : null}
                {(step.ingredientes || []).length > 0 && (
                  <Text style={[styles.stepDesc, { color: TEAL, marginTop: 2 }]}>
                    {step.ingredientes.join(', ')}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </>
      )}

      {/* Footer — A4 only */}
      {size === 'a4' && (
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Guaxi · Ficha Técnica</Text>
        </View>
      )}
    </Page>
  )
}

// ── Document ──────────────────────────────────────────────────

export function FichaTecnicaDocument({ receitas, size }) {
  const styles = makeStyles(size)
  return (
    <Document title="Fichas Técnicas" author="Guaxi">
      {receitas.map(r => (
        <ReceitaPage key={r.id} receita={r} size={size} styles={styles} />
      ))}
    </Document>
  )
}
