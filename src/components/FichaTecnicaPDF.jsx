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
  incorporar: 'Incorporar', ferver: 'Ferver', aquecer: 'Aquecer',
  descansar: 'Descansar', cortar: 'Cortar', esticar: 'Esticar',
}

// ── styles ────────────────────────────────────────────────────

const TEAL = '#0d9488'
const GRAY = '#6b7280'
const BORDER = '#e5e7eb'

function makeStyles(size) {
  const isA5 = size === 'a5'

  return StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
      padding: isA5 ? 22 : 28,
      paddingBottom: size === 'a4' ? 44 : isA5 ? 22 : 28,
      fontFamily: 'Helvetica',
    },
    header: {
      marginBottom: 10,
      paddingBottom: 10,
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
      fontSize: isA5 ? 16 : 20,
      fontFamily: 'Helvetica-Bold',
      color: '#111827',
    },
    badge: {
      fontSize: 9,
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
      fontSize: 12,
      color: GRAY,
      marginTop: 4,
    },
    sectionLabel: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: TEAL,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 4,
      marginTop: 10,
    },
    tableHeader: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
      paddingBottom: 3,
      marginBottom: 2,
    },
    tableHeaderText: {
      fontSize: 8,
      fontFamily: 'Helvetica-Bold',
      color: GRAY,
      textTransform: 'uppercase',
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 3,
      borderBottomWidth: 0.5,
      borderBottomColor: BORDER,
      alignItems: 'center',
    },
    tableRowAlt: {
      backgroundColor: '#f9fafb',
    },
    cellNome: { flex: 3 },
    cellQtd:  { flex: 1.5, textAlign: 'right' },
    cellMult: { flex: 1.2, textAlign: 'right' },
    cellText: {
      fontSize: isA5 ? 8.5 : 9.5,
      color: '#111827',
    },
    cellTextMult: {
      fontSize: isA5 ? 8 : 9,
      color: GRAY,
    },
    costBox: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: BORDER,
    },
    costItem: {
      alignItems: 'flex-end',
      marginLeft: 16,
    },
    costLabel: {
      fontSize: 8,
      color: GRAY,
    },
    costValue: {
      fontSize: 12,
      fontFamily: 'Helvetica-Bold',
      color: TEAL,
    },
    stepRow: {
      flexDirection: 'row',
      marginBottom: isA5 ? 8 : 12,
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
      marginTop: 8,
    },
    infoBox: {
      flex: 1,
      backgroundColor: '#f3f4f6',
      borderRadius: 4,
      padding: 6,
      marginRight: 8,
    },
    infoLabel: {
      fontSize: 7,
      color: GRAY,
      fontFamily: 'Helvetica-Bold',
      textTransform: 'uppercase',
    },
    infoValue: {
      fontSize: 11,
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
  a5: 'A5',
  a4: 'A4',
}

// ── Single recipe page ────────────────────────────────────────

function ReceitaPage({ receita, size, styles }) {
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
        <Text style={[styles.tableHeaderText, styles.cellQtd]}>x1</Text>
        <Text style={[styles.tableHeaderText, styles.cellMult]}>x2</Text>
        <Text style={[styles.tableHeaderText, styles.cellMult]}>x3</Text>
        <Text style={[styles.tableHeaderText, styles.cellMult]}>x4</Text>
      </View>
      {(receita.ingredientes || []).map((ing, i) => {
        const q = Number(ing.quantidade || 0)
        const u = ing.unidade || ''
        const fmt1 = `${fmtQtd(q)}${u}`
        const fmtN = (n) => `${fmtQtd(q * n)}${u}`
        return (
          <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
            <Text style={[styles.cellText, styles.cellNome]}>{ing.nome}</Text>
            <Text style={[styles.cellText, styles.cellQtd]}>{fmt1}</Text>
            <Text style={[styles.cellTextMult, styles.cellMult]}>{fmtN(2)}</Text>
            <Text style={[styles.cellTextMult, styles.cellMult]}>{fmtN(3)}</Text>
            <Text style={[styles.cellTextMult, styles.cellMult]}>{fmtN(4)}</Text>
          </View>
        )
      })}

      {/* Forno / Resfriamento info */}
      {(hasForno || hasResfriamento) && (
        <View style={styles.infoRow}>
          {hasForno && (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Forno</Text>
              <Text style={styles.infoValue}>{receita.tempForno}°C · {receita.tempoForno} min</Text>
            </View>
          )}
          {hasResfriamento && (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>{receita.tipoResfriamento || 'Resfriar'}</Text>
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

      {/* Steps */}
      {hasSteps && (
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
