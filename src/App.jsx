import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { ArrowRightLeft, DollarSign, Moon, Sun } from 'lucide-react'
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, setDoc, writeBatch } from 'firebase/firestore'
import { db, isFirebaseReady } from './firebase'
import './App.css'

const STORAGE_KEY = 'stickers_history_react_v1'
const STICKER_PRICE = 2000
const TEBAN_SHARE = 1000
const FIRESTORE_HISTORY_COLLECTION = 'stickers_history'
const THEME_STORAGE_KEY = 'stickers_theme'
const BASE_URL = import.meta.env.BASE_URL
const assetPath = (fileName) => `${BASE_URL}${fileName}`
const SEED_HISTORY = [
  { id: 'seed-2026-03-28', date: '2026-03-28', tEfe: 13, aEfe: 14, tBreb: 3, aBreb: 0 },
  { id: 'seed-2026-03-29', date: '2026-03-29', tEfe: 1, aEfe: 3, tBreb: 0, aBreb: 2 },
  { id: 'seed-2026-04-03', date: '2026-04-03', tEfe: 0, aEfe: 3, tBreb: 0, aBreb: 3 },
  { id: 'seed-2026-04-04', date: '2026-04-04', tEfe: 4, aEfe: 4, tBreb: 0, aBreb: 0 },
  { id: 'seed-2026-04-09', date: '2026-04-09', tEfe: 3, aEfe: 2, tBreb: 0, aBreb: 0 },
  { id: 'seed-2026-04-10', date: '2026-04-10', tEfe: 1, aEfe: 0, tBreb: 0, aBreb: 0 },
  { id: 'seed-2026-04-11', date: '2026-04-11', tEfe: 1, aEfe: 0, tBreb: 1, aBreb: 0 },
]

const todayISO = () => new Date().toISOString().slice(0, 10)

const safeInt = (value) => {
  const parsed = Number.parseInt(value ?? '0', 10)
  if (Number.isNaN(parsed)) return 0
  return Math.max(parsed, 0)
}

const makeId = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value)

const toStoredRow = (row) => ({
  id: row.id,
  date: row.date,
  tEfe: safeInt(row.tEfe),
  aEfe: safeInt(row.aEfe),
  tBreb: safeInt(row.tBreb),
  aBreb: safeInt(row.aBreb),
})

const calcHistoryRow = (row) => {
  const tEfe = safeInt(row.tEfe)
  const aEfe = safeInt(row.aEfe)
  const tBreb = safeInt(row.tBreb)
  const aBreb = safeInt(row.aBreb)

  const alejaMeDebe = tEfe * TEBAN_SHARE
  const yoLeDebo = tBreb * TEBAN_SHARE + aBreb * STICKER_PRICE
  const balance = alejaMeDebe - yoLeDebo
  const totalStickers = tEfe + aEfe + tBreb + aBreb

  return {
    ...row,
    tEfe,
    aEfe,
    tBreb,
    aBreb,
    alejaMeDebe,
    yoLeDebo,
    balance,
    totalStickers,
  }
}

const sortHistoryRows = (rows) => [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)))

const mergeWithSeedRows = (rows) => {
  const normalized = sortHistoryRows(rows.map(calcHistoryRow))
  const datesInRows = new Set(normalized.map((row) => row.date))
  const missingSeed = SEED_HISTORY.filter((row) => !datesInRows.has(row.date)).map(calcHistoryRow)
  return sortHistoryRows([...normalized, ...missingSeed])
}

const loadHistory = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const stored = Array.isArray(parsed) ? parsed : []
    return mergeWithSeedRows(stored)
  } catch {
    return mergeWithSeedRows([])
  }
}

const loadImageDataUrl = async (src) => {
  const response = await fetch(src)
  const blob = await response.blob()

  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const drawPdfHeader = (doc, title, subtitle, badge, createdAt, logoDataUrl) => {
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFillColor(10, 25, 47)
  doc.rect(0, 0, pageWidth, 92, 'F')
  doc.setFillColor(33, 123, 173)
  doc.rect(0, 92, pageWidth, 4, 'F')

  if (logoDataUrl) {
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(34, 16, 56, 56, 12, 12, 'F')
    doc.addImage(logoDataUrl, 'PNG', 39, 21, 46, 46)
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(title, logoDataUrl ? 100 : 40, 42)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(subtitle, logoDataUrl ? 100 : 40, 60)

  doc.setFillColor(33, 123, 173)
  doc.roundedRect(pageWidth - 170, 22, 130, 28, 6, 6, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(badge, pageWidth - 105, 40, { align: 'center' })

  doc.setTextColor(210, 225, 240)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Generado: ${createdAt}`, pageWidth - 36, 74, { align: 'right' })
  doc.setTextColor(44, 62, 80)
}

const drawMetricCard = (doc, x, y, w, h, label, value, accent, fill) => {
  doc.setFillColor(...fill)
  doc.roundedRect(x, y, w, h, 10, 10, 'F')
  doc.setDrawColor(...accent)
  doc.roundedRect(x, y, w, h, 10, 10, 'S')
  doc.setFillColor(...accent)
  doc.rect(x, y, 6, h, 'F')
  doc.setTextColor(58, 70, 88)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(label, x + 14, y + 16)
  doc.setTextColor(13, 30, 55)
  doc.setFontSize(13)
  doc.text(value, x + 14, y + 35)
}

function App() {
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
    return 'dark'
  })
  const [history, setHistory] = useState(loadHistory)
  const [billingMonth, setBillingMonth] = useState(todayISO().slice(0, 7))
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportMode, setExportMode] = useState('history')
  const [activeView, setActiveView] = useState('live')

  const totals = useMemo(() => {
    const favor = history.reduce((acc, row) => acc + row.alejaMeDebe, 0)
    const contra = history.reduce((acc, row) => acc + row.yoLeDebo, 0)
    const balance = favor - contra
    const stickers = history.reduce((acc, row) => acc + row.totalStickers, 0)

    return {
      favor,
      contra,
      balance,
      stickers,
      days: history.length,
    }
  }, [history])

  const persist = (next) => {
    setHistory(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map(toStoredRow)))
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.classList.toggle('theme-dark', theme === 'dark')
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!isFirebaseReady || !db) return

    const historyCollection = collection(db, FIRESTORE_HISTORY_COLLECTION)
    let unsubscribe = () => {}
    let isActive = true

    const startSync = async () => {
      try {
        const snapshot = await getDocs(historyCollection)

        if (snapshot.empty) {
          const seedBatch = writeBatch(db)
          for (const seedRow of SEED_HISTORY) {
            seedBatch.set(doc(historyCollection, seedRow.id), toStoredRow(seedRow))
          }
          await seedBatch.commit()
        }

        unsubscribe = onSnapshot(query(historyCollection, orderBy('date', 'desc')), (liveSnapshot) => {
          if (!isActive) return
          const remoteRows = liveSnapshot.docs.map((item) => calcHistoryRow({ id: item.id, ...item.data() }))
          setHistory(remoteRows)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteRows.map(toStoredRow)))
        })
      } catch (error) {
        console.error('No se pudo sincronizar con Firebase', error)
      }
    }

    void startSync()

    return () => {
      isActive = false
      unsubscribe()
    }
  }, [])

  const calcRow = calcHistoryRow

  const sortHistory = sortHistoryRows

  const registerSale = (field) => {
    const today = todayISO()
    const historyCollection = isFirebaseReady && db ? collection(db, FIRESTORE_HISTORY_COLLECTION) : null
    let found = false
    let changedRow = null

    const updated = history.map((row) => {
      if (row.date !== today) return row
      found = true
      const nextValue = safeInt(row[field]) + 1
      changedRow = calcRow({ ...row, [field]: nextValue })
      return changedRow
    })

    if (!found) {
      const base = calcRow({
        id: makeId(),
        date: today,
        tEfe: 0,
        aEfe: 0,
        tBreb: 0,
        aBreb: 0,
      })
      const newRow = calcRow({ ...base, [field]: 1 })
      persist(sortHistory([newRow, ...history]))

      if (historyCollection) {
        void setDoc(doc(historyCollection, newRow.id), toStoredRow(newRow)).catch((error) => {
          console.error('No se pudo guardar en Firebase', error)
        })
      }

      return
    }

    persist(sortHistory(updated))

    if (changedRow && historyCollection) {
      void setDoc(doc(historyCollection, changedRow.id), toStoredRow(changedRow)).catch((error) => {
        console.error('No se pudo guardar en Firebase', error)
      })
    }
  }

  const deleteRow = (id) => {
    const ok = window.confirm('Vas a eliminar este registro. Esta accion no se puede deshacer. Continuar?')
    if (!ok) return

    persist(history.filter((row) => row.id !== id))

    if (isFirebaseReady && db) {
      const historyCollection = collection(db, FIRESTORE_HISTORY_COLLECTION)
      void deleteDoc(doc(historyCollection, id)).catch((error) => {
        console.error('No se pudo eliminar en Firebase', error)
      })
    }
  }

  const clearAll = () => {
    if (!history.length) return
    const ok = window.confirm('Se eliminara todo el historial de forma permanente. Continuar?')
    if (!ok) return

    const rowsToDelete = [...history]
    persist([])

    if (isFirebaseReady && db) {
      const historyCollection = collection(db, FIRESTORE_HISTORY_COLLECTION)
      const deleteBatch = writeBatch(db)

      for (const row of rowsToDelete) {
        deleteBatch.delete(doc(historyCollection, row.id))
      }

      void deleteBatch.commit().catch((error) => {
        console.error('No se pudo limpiar en Firebase', error)
      })
    }
  }

  const exportHistoryPdf = async () => {
    if (!history.length) {
      window.alert('No hay datos para exportar.')
      return false
    }

    const ordered = [...history].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const createdAt = new Date().toLocaleString('es-CO')
    const logoDataUrl = await loadImageDataUrl(assetPath('logo.png')).catch(() => null)
    const startDate = ordered[0]?.date ?? ''
    const endDate = ordered[ordered.length - 1]?.date ?? ''
    const methodTotals = ordered.reduce(
      (acc, row) => ({
        tebanEfe: acc.tebanEfe + row.tEfe,
        alejaEfe: acc.alejaEfe + row.aEfe,
        tebanBreb: acc.tebanBreb + row.tBreb,
        alejaBreb: acc.alejaBreb + row.aBreb,
      }),
      { tebanEfe: 0, alejaEfe: 0, tebanBreb: 0, alejaBreb: 0 },
    )

    drawPdfHeader(
      doc,
      'Registro de Stickers',
      'Reporte completo de movimientos y balance acumulado',
      'HISTORIAL GENERAL',
      createdAt,
      logoDataUrl,
    )

    const periodY = 118

    doc.setTextColor(58, 70, 88)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Periodo analizado', 40, periodY)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(13, 30, 55)
    doc.text(startDate && endDate ? `${startDate} al ${endDate}` : 'Sin rango disponible', 40, periodY + 12)

    autoTable(doc, {
      startY: 186,
      head: [[
        'Fecha',
        'T Efe',
        'A Efe',
        'T BreB',
        'A BreB',
        'A Favor',
        'En Contra',
        'Balance',
      ]],
      body: ordered.map((row) => [
        row.date,
        row.tEfe,
        row.aEfe,
        row.tBreb,
        row.aBreb,
        formatCurrency(row.alejaMeDebe),
        formatCurrency(row.yoLeDebo),
        formatCurrency(row.balance),
      ]),
      theme: 'grid',
      headStyles: { fillColor: [10, 25, 47], textColor: 255, fontSize: 9, halign: 'center' },
      styles: { fontSize: 8.6, cellPadding: 5, textColor: [36, 52, 73], halign: 'center' },
      columnStyles: {
        0: { fontStyle: 'bold' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
      },
      alternateRowStyles: { fillColor: [245, 248, 255] },
      margin: { left: 32, right: 32 },
      didParseCell: (data) => {
        if (data.section === 'head') {
          data.cell.styles.fillColor = [10, 25, 47]
        }
      },
    })

    const finalY = doc.lastAutoTable?.finalY || 520
    const noteY = Math.min(finalY + 28, 760)

    doc.setDrawColor(216, 226, 237)
    doc.line(40, noteY - 12, 555, noteY - 12)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text('Observaciones y control', 40, noteY)
    doc.setFont('helvetica', 'normal')
    doc.text('• El reporte refleja el consolidado total de movimientos al momento de la exportacion.', 40, noteY + 16)
    doc.text('• Los valores se expresan en pesos colombianos y estan sujetos al registro diario realizado.', 40, noteY + 32)
    doc.text('• Generado automaticamente para fines de control interno y consulta operativa.', 40, noteY + 48)

    doc.setFillColor(10, 25, 47)
    doc.rect(0, doc.internal.pageSize.getHeight() - 42, doc.internal.pageSize.getWidth(), 42, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9)
    doc.text('Registro de Stickers · Historial general', 40, doc.internal.pageSize.getHeight() - 16)
    doc.text('Pagina 1', doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 16, { align: 'right' })

    doc.save(`historial_stickers_${todayISO()}.pdf`)
    return true
  }

  const exportCuentaCobro = async () => {
    const month = (billingMonth || '').trim()
    if (!month) {
      window.alert('Selecciona un mes para generar la cuenta de cobro.')
      return false
    }

    const monthRows = history
      .filter((row) => String(row.date).startsWith(month))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))

    if (!monthRows.length) {
      window.alert('No hay registros para ese mes.')
      return false
    }

    const favor = monthRows.reduce((acc, row) => acc + row.alejaMeDebe, 0)
    const contra = monthRows.reduce((acc, row) => acc + row.yoLeDebo, 0)
    const neto = favor - contra
    const valorCobro = Math.max(neto, 0)

    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const createdAt = new Date().toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const signatureDataUrl = await loadImageDataUrl(assetPath('Firma%20Esteban.png')).catch(() => null)
    const companyName = 'INDUSTRIAS GATO GORDO SAS'
    const companyNit = 'NIT 901.903.584-3'
    const beneficiaryName = 'ESTEBAN SANCHEZ CARDONA'
    const beneficiaryCc = 'C.C. 1089379280'
    const centerX = pageWidth / 2

    doc.setTextColor(25, 25, 25)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Pereira, ${createdAt}`, 40, 50)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(24)
    doc.text('CUENTA DE COBRO', centerX, 110, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.text(companyName, centerX, 160, { align: 'center' })
    doc.setFontSize(11)
    doc.text(companyNit, centerX, 178, { align: 'center' })

    doc.setFontSize(11)
    doc.text('DEBE A:', centerX, 230, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(beneficiaryName, centerX, 252, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text(beneficiaryCc, centerX, 268, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text('LA SUMA DE:', centerX, 330, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text(formatCurrency(valorCobro), centerX, 360, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.text('CONCEPTO:', centerX, 418, { align: 'center' })
    doc.text('Stickers', centerX, 440, { align: 'center' })

    const signatureTop = 500
    doc.setDrawColor(70, 70, 70)
    doc.line(60, signatureTop + 95, 220, signatureTop + 95)

    if (signatureDataUrl) {
      doc.addImage(signatureDataUrl, 'PNG', 50, signatureTop, 170, 90)
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(beneficiaryName, 60, signatureTop + 112)
    doc.setFont('helvetica', 'normal')
    doc.text(beneficiaryCc, 60, signatureTop + 126)

    doc.save(`cuenta_cobro_${month}.pdf`)
    return true
  }

  const openExportModal = () => {
    setIsExportModalOpen(true)
  }

  const closeExportModal = () => {
    setIsExportModalOpen(false)
  }

  const confirmExport = () => {
    const runExport = async () => {
      const ok = exportMode === 'history' ? await exportHistoryPdf() : await exportCuentaCobro()
      if (ok) closeExportModal()
    }

    void runExport()
  }

  const balanceText =
    totals.balance > 0
      ? 'Aleja te debe ese valor'
      : totals.balance < 0
        ? 'Tu le debes ese valor a Aleja'
        : 'Cuentas claras (paz y salvo)'

  const todayData =
    history.find((row) => row.date === todayISO()) ||
    calcRow({
      id: 'today-empty',
      date: todayISO(),
      tEfe: 0,
      aEfe: 0,
      tBreb: 0,
      aBreb: 0,
    })

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  return (
    <>
      <main className="app-shell">
        <header className="topbar reveal">
          <div className="brand">
            <img src={assetPath('logo.png')} alt="Logo" className="lobito-logo-sticker brand-logo w-20 h-20 object-contain" />
            <div>
              <p className="brand-title">Registro de Stickers</p>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Activar tema claro' : 'Activar tema oscuro'}
              title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
            >
              {theme === 'dark' ? (
                <Sun size={18} className="theme-icon" aria-hidden="true" />
              ) : (
                <Moon size={18} className="theme-icon" aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        <section className="view-switch reveal delay-1">
          <button
            type="button"
            className={`switch-btn ${activeView === 'live' ? 'active' : ''}`}
            onClick={() => setActiveView('live')}
          >
            Ventana de Venta en Vivo
          </button>
          <button
            type="button"
            className={`switch-btn ${activeView === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveView('summary')}
          >
            Ventana de Saldos y Balance
          </button>
        </section>

        {activeView === 'live' ? (
          <section className="single-view reveal delay-2">
            <article className="panel form-panel">
              <div className="panel-head">
                <h3>Ventas en vivo</h3>
                <span className="chip">Precio sticker: $2.000</span>
              </div>

              <div className="live-layout">
                <div className="live-summary">
                  <div className="today-box">
                    <p className="today-title">Hoy ({todayData.date})</p>
                    <p className="today-line">Teban efectivo: {todayData.tEfe}</p>
                    <p className="today-line">Aleja efectivo: {todayData.aEfe}</p>
                    <p className="today-line">Teban BreB: {todayData.tBreb}</p>
                    <p className="today-line">Aleja BreB: {todayData.aBreb}</p>
                    <p className="today-total">Balance del dia: {formatCurrency(todayData.balance)}</p>
                  </div>
                </div>

                <div className="live-actions">
                  <div className="live-groups">
                    <section className="person-group teban-group">
                      <p className="group-title">Teban</p>
                      <div className="live-grid">
                        <button type="button" className="sale-btn sale-cash-teban" onClick={() => registerSale('tEfe')}>
                          <span className="sale-btn-content">
                            <DollarSign size={18} aria-hidden="true" />
                            <strong>Efectivo</strong>
                          </span>
                        </button>
                        <button type="button" className="sale-btn sale-breb-teban" onClick={() => registerSale('tBreb')}>
                          <span className="sale-btn-content">
                            <ArrowRightLeft size={16} aria-hidden="true" />
                            <strong>BreB</strong>
                          </span>
                        </button>
                      </div>
                    </section>

                    <section className="person-group aleja-group">
                      <p className="group-title">Aleja</p>
                      <div className="live-grid">
                        <button type="button" className="sale-btn sale-cash-aleja" onClick={() => registerSale('aEfe')}>
                          <span className="sale-btn-content">
                            <DollarSign size={18} aria-hidden="true" />
                            <strong>Efectivo</strong>
                          </span>
                        </button>
                        <button type="button" className="sale-btn sale-breb-aleja" onClick={() => registerSale('aBreb')}>
                          <span className="sale-btn-content">
                            <ArrowRightLeft size={16} aria-hidden="true" />
                            <strong>BreB</strong>
                          </span>
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </article>
          </section>
        ) : (
          <>
            <section className="kpi-grid reveal delay-2">
              <article className="kpi-card kpi-favor">
                <p className="kpi-label">Tu saldo a favor</p>
                <h2 className="kpi-value">{formatCurrency(totals.favor)}</h2>
                <p className="kpi-meta">Plata tuya que tiene Aleja</p>
              </article>

              <article className="kpi-card kpi-contra">
                <p className="kpi-label">Tu saldo en contra</p>
                <h2 className="kpi-value">{formatCurrency(totals.contra)}</h2>
                <p className="kpi-meta">Plata de Aleja que tienes tu</p>
              </article>

              <article className="kpi-card kpi-balance">
                <p className="kpi-label">Balance neto</p>
                <h2 className="kpi-value">{formatCurrency(Math.abs(totals.balance))}</h2>
                <p className="kpi-meta">{balanceText}</p>
              </article>

              <article className="kpi-card kpi-actions">
                <button className="btn primary full-btn" onClick={openExportModal}>Exportar</button>
                <button className="btn ghost full-btn" onClick={clearAll}>Limpiar historial</button>
                <p className="kpi-meta">{totals.days} {totals.days === 1 ? 'dia' : 'dias'} registrados · {totals.stickers} stickers</p>
              </article>
            </section>

            <section className="single-view reveal delay-2">
              <article className="panel history-panel">
                <div className="panel-head">
                  <h3>Historial diario</h3>
                  <span className="chip">Persistencia local</span>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>T Efe</th>
                        <th>A Efe</th>
                        <th>T BreB</th>
                        <th>A BreB</th>
                        <th>A favor</th>
                        <th>En contra</th>
                        <th>Resultado</th>
                        <th>Accion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => {
                        let resultClass = 'result-neutral'
                        let resultText = 'Dia cuadrado en $0'

                        if (row.balance > 0) {
                          resultClass = 'result-positive'
                          resultText = `Aleja te debe ${formatCurrency(row.balance)}`
                        } else if (row.balance < 0) {
                          resultClass = 'result-negative'
                          resultText = `Tu debes ${formatCurrency(Math.abs(row.balance))}`
                        }

                        return (
                          <tr key={row.id}>
                            <td>{row.date}</td>
                            <td>{row.tEfe}</td>
                            <td>{row.aEfe}</td>
                            <td>{row.tBreb}</td>
                            <td>{row.aBreb}</td>
                            <td>{formatCurrency(row.alejaMeDebe)}</td>
                            <td>{formatCurrency(row.yoLeDebo)}</td>
                            <td>
                              <span className={`result-pill ${resultClass}`}>{resultText}</span>
                            </td>
                            <td>
                              <button type="button" className="delete-btn" onClick={() => deleteRow(row.id)}>Eliminar</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {!history.length && (
                  <div className="empty-state">
                    Aun no hay dias registrados. Agrega tu primer dia para empezar el cuadre.
                  </div>
                )}
              </article>
            </section>
          </>
        )}
      </main>

      {isExportModalOpen && (
        <div className="modal-backdrop" onClick={closeExportModal}>
          <section className="export-modal" onClick={(event) => event.stopPropagation()}>
            <header className="export-modal-head">
              <h3>Exportar informacion</h3>
              <button type="button" className="icon-close" onClick={closeExportModal}>✕</button>
            </header>

            <div className="export-options">
              <button
                type="button"
                className={`export-option ${exportMode === 'history' ? 'active' : ''}`}
                onClick={() => setExportMode('history')}
              >
                <span>Historial completo</span>
                <small>Descarga PDF completo con resumen y detalle diario.</small>
              </button>

              <button
                type="button"
                className={`export-option ${exportMode === 'billing' ? 'active' : ''}`}
                onClick={() => setExportMode('billing')}
              >
                <span>Cuenta de Cobro mensual</span>
                <small>Descarga PDF formal del mes elegido con total a cobrar.</small>
              </button>
            </div>

            {exportMode === 'billing' && (
              <div className="billing-row">
                <label htmlFor="billingMonthModal" className="billing-label">Mes cuenta cobro</label>
                <input
                  id="billingMonthModal"
                  type="month"
                  className="billing-input"
                  value={billingMonth}
                  onChange={(event) => setBillingMonth(event.target.value)}
                />
              </div>
            )}

            <footer className="export-modal-actions">
              <button type="button" className="btn ghost" onClick={closeExportModal}>Cancelar</button>
              <button type="button" className="btn primary" onClick={confirmExport}>Exportar ahora</button>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}

export default App
