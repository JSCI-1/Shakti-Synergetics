import React, { useState } from 'react'
import './RawMaterialView.css'

const PRODUCTS = ['-- Select product --', 'Sulphur', 'Oil', 'Zinc Oxide', 'Stearic Acid', 'Carbon Black']
const STATUS_OPTIONS = ['-- Select --', 'Pending', 'Approved', 'Rejected']

export default function RawMaterialView() {
  const [form, setForm] = useState({
    date: '2026-09-21',
    product: '',
    openingBalance: '',
    qtyReceived: '',
    materialReturn: '',
    qtyIssuedForProdn: '',
    qtyIssuedToBalance: '',
    dispatchAsIs: '',
    closingBalance: '0.000',
    status: '',
    remarks: '',
    qtyIssuedToBallMill: '',
    netBalance: '',
  })

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    alert('Raw Material entry saved!')
  }

  return (
    <div className="raw-material">
      <div className="rm-section-title">RAW MATERIAL ENTRY</div>

      <form className="rm-form" onSubmit={handleSubmit}>
        {/* Row 1: Date + Product */}
        <div className="rm-row two-col">
          <div className="rm-field">
            <label className="rm-label">Date <span className="required">*</span></label>
            <input
              type="date"
              name="date"
              className="rm-input"
              value={form.date}
              onChange={handleChange}
              required
            />
          </div>
          <div className="rm-field">
            <label className="rm-label">Name of Product <span className="required">*</span></label>
            <select name="product" className="rm-select" value={form.product} onChange={handleChange} required>
              {PRODUCTS.map((p) => (
                <option key={p} value={p === '-- Select product --' ? '' : p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Opening Balance, Qty Received, Material Return */}
        <div className="rm-row three-col">
          <div className="rm-field">
            <label className="rm-label">Opening Balance</label>
            <input type="number" name="openingBalance" className="rm-input" placeholder="0" value={form.openingBalance} onChange={handleChange} />
          </div>
          <div className="rm-field">
            <label className="rm-label">Qty Received</label>
            <input type="number" name="qtyReceived" className="rm-input" placeholder="0" value={form.qtyReceived} onChange={handleChange} />
          </div>
          <div className="rm-field">
            <label className="rm-label">Material Return</label>
            <input type="number" name="materialReturn" className="rm-input" placeholder="0" value={form.materialReturn} onChange={handleChange} />
          </div>
        </div>

        {/* Row 3: Qty Issued for Prodn, Qty Issued to Balance, Dispatch as it is */}
        <div className="rm-row three-col">
          <div className="rm-field">
            <label className="rm-label">Qty Issued for Prodn</label>
            <input type="number" name="qtyIssuedForProdn" className="rm-input" placeholder="0" value={form.qtyIssuedForProdn} onChange={handleChange} />
          </div>
          <div className="rm-field">
            <label className="rm-label">Qty Issued to Balance</label>
            <input type="number" name="qtyIssuedToBalance" className="rm-input" placeholder="0" value={form.qtyIssuedToBalance} onChange={handleChange} />
          </div>
          <div className="rm-field">
            <label className="rm-label">Dispatch as it is</label>
            <input type="number" name="dispatchAsIs" className="rm-input" placeholder="0" value={form.dispatchAsIs} onChange={handleChange} />
          </div>
        </div>

        {/* Row 4: Closing Balance, Status, Remarks */}
        <div className="rm-row three-col">
          <div className="rm-field">
            <label className="rm-label">Closing Balance</label>
            <input
              type="text"
              name="closingBalance"
              className="rm-input closing-balance"
              value={form.closingBalance}
              readOnly
            />
          </div>
          <div className="rm-field">
            <label className="rm-label">Status</label>
            <select name="status" className="rm-select" value={form.status} onChange={handleChange}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s === '-- Select --' ? '' : s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="rm-field">
            <label className="rm-label">Remarks</label>
            <input type="text" name="remarks" className="rm-input" placeholder="Optional note..." value={form.remarks} onChange={handleChange} />
          </div>
        </div>

        {/* Formula Fields */}
        <div className="formula-section">
          <div className="formula-title">FORMULA FIELDS (EXCEL CROSS-REFERENCES)</div>
          <div className="rm-row three-col">
            <div className="rm-field">
              <label className="rm-label">Closing Balance (C3+D3+E3-F3-G3-H3)</label>
              <input type="text" className="rm-input closing-balance" value={form.closingBalance} readOnly />
            </div>
            <div className="rm-field">
              <label className="rm-label">Qty Issued to Ball Mill (G col)</label>
              <input type="number" name="qtyIssuedToBallMill" className="rm-input" placeholder="0" value={form.qtyIssuedToBallMill} onChange={handleChange} />
            </div>
            <div className="rm-field">
              <label className="rm-label">Net Balance (M col = I - N)</label>
              <input type="number" name="netBalance" className="rm-input" placeholder="0" value={form.netBalance} onChange={handleChange} />
            </div>
          </div>
        </div>

        <div className="rm-actions">
          <button type="submit" className="rm-submit-btn">Save Entry</button>
          <button type="button" className="rm-cancel-btn" onClick={() => setForm({ ...form, product: '', openingBalance: '', qtyReceived: '', materialReturn: '', qtyIssuedForProdn: '', qtyIssuedToBalance: '', dispatchAsIs: '', status: '', remarks: '', qtyIssuedToBallMill: '', netBalance: '' })}>
            Reset
          </button>
        </div>
      </form>
    </div>
  )
}
