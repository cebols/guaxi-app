import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'

const TEAL = '#0d9488'
const GRAY = '#6b7280'
const BORDER = '#e5e7eb'

function fmtR(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function makeStyles(size, comFotos) {
  const isA5 = size === 'a5'
  return StyleSheet.create({
    page: {
      backgroundColor: '#ffffff',
      padding: isA5 ? 22 : 30,
      paddingBottom: 40,
      fontFamily: 'Helvetica',
    },
    header: {
      marginBottom: 16,
      paddingBottom: 10,
      borderBottomWidth: 2,
      borderBottomColor: TEAL,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    loja: { fontSize: isA5 ? 18 : 24, fontFamily: 'Helvetica-Bold', color: '#111827' },
    headerRight: { alignItems: 'flex-end' },
    cardapioLabel: { fontSize: isA5 ? 11 : 13, color: TEAL, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
    data: { fontSize: 8, color: GRAY, marginTop: 2 },
    catLabel: {
      fontSize: 10, fontFamily: 'Helvetica-Bold', color: TEAL,
      textTransform: 'uppercase', letterSpacing: 0.8,
      marginTop: 10, marginBottom: 6,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    card: {
      width: isA5 ? '100%' : '48%',
      flexDirection: 'row',
      marginBottom: 12,
      borderWidth: 0.5,
      borderColor: BORDER,
      borderRadius: 6,
      padding: 6,
    },
    img: { width: 52, height: 52, borderRadius: 4, marginRight: 8, objectFit: 'cover' },
    imgPlaceholder: {
      width: 52, height: 52, borderRadius: 4, marginRight: 8,
      backgroundColor: '#f3f4f6',
    },
    body: { flex: 1, justifyContent: 'center' },
    nome: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: '#111827' },
    desc: { fontSize: 7.5, color: GRAY, marginTop: 2, lineHeight: 1.3 },
    preco: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: TEAL, marginTop: 3 },
    footer: {
      position: 'absolute', bottom: 16, left: 30, right: 30,
      borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 4,
    },
    footerText: { fontSize: 7, color: GRAY, textAlign: 'center' },
  })
}

function ProdutoCard({ p, styles, comFotos }) {
  const desc = (p.descricao || '').length > 90 ? p.descricao.slice(0, 90) + '…' : p.descricao
  return (
    <View style={styles.card} wrap={false}>
      {comFotos && (
        p.imagemUrl
          ? <Image style={styles.img} src={p.imagemUrl} />
          : <View style={styles.imgPlaceholder} />
      )}
      <View style={styles.body}>
        <Text style={styles.nome}>{p.nome}</Text>
        {desc ? <Text style={styles.desc}>{desc}</Text> : null}
        {p.preco > 0 ? <Text style={styles.preco}>R$ {fmtR(p.preco)}</Text> : null}
      </View>
    </View>
  )
}

export function CardapioDocument({ produtos, nomeLoja, size = 'a4', comFotos = true }) {
  const styles = makeStyles(size, comFotos)
  const hoje = new Date().toLocaleDateString('pt-BR')

  // Agrupa por categoria, mantendo a ordem de chegada.
  const grupos = []
  const idx = {}
  for (const p of produtos) {
    const cat = p.categoria || ''
    if (!(cat in idx)) { idx[cat] = grupos.length; grupos.push({ cat, itens: [] }) }
    grupos[idx[cat]].itens.push(p)
  }

  return (
    <Document title="Cardápio" author="Guaxi">
      <Page size={size === 'a5' ? 'A5' : 'A4'} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.loja}>{nomeLoja || 'Cardápio'}</Text>
          <View style={styles.headerRight}>
            <Text style={styles.cardapioLabel}>CARDÁPIO</Text>
            <Text style={styles.data}>{hoje}</Text>
          </View>
        </View>

        {grupos.map((g, gi) => (
          <View key={gi}>
            {g.cat ? <Text style={styles.catLabel}>{g.cat}</Text> : null}
            <View style={styles.grid}>
              {g.itens.map((p, i) => (
                <ProdutoCard key={i} p={p} styles={styles} comFotos={comFotos} />
              ))}
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{nomeLoja ? `${nomeLoja} · ` : ''}Cardápio gerado no Guaxi</Text>
        </View>
      </Page>
    </Document>
  )
}
