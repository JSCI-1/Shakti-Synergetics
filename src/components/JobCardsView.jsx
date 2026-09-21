import React from 'react'
import './JobCardsView.css'

const SAMPLE_JOBS = [
  {
    id: 455,
    status: 'Pending Stores',
    machine: 'M1',
    date: '21/09/2026',
    shift: 'Day',
    batchNo: '44',
    party: 'R5299',
    plannedProduction: '5 MT',
    oilRequired: '50 kg',
    supplier: 'test',
    lotNumber: '44',
    emptyDate: '21/09/2026',
  },
]

export default function JobCardsView({ selectedJob, onSelectJob }) {
  if (selectedJob) {
    return <JobDetail job={selectedJob} onBack={() => onSelectJob(null)} />
  }

  return (
    <div className="job-cards-list">
      <h2 className="section-heading">Job Cards</h2>
      {SAMPLE_JOBS.map((job) => (
        <div key={job.id} className="job-card-item" onClick={() => onSelectJob(job)}>
          <div className="job-card-item-left">
            <span className="job-number">Job {job.id}</span>
            <span className="job-status">{job.status}</span>
          </div>
          <div className="job-card-item-right">
            <span className="job-machine">{job.machine}</span>
            <span className="job-date">{job.date}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function JobDetail({ job, onBack }) {
  return (
    <div className="job-detail">
      <button className="back-link" onClick={onBack}>&#8592; Back to Job Cards</button>

      <div className="job-header-card">
        <div className="job-header-info">
          <div className="job-title">Job {job.id}</div>
          <div className="job-status-badge">{job.status}</div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">PRODUCTION DETAILS (FILLED BY PRODUCTION INCHARGE)</div>
        <div className="detail-grid">
          <div className="detail-row">
            <div className="detail-item">
              <span className="detail-label">Machine:</span>
              <span className="detail-value">{job.machine}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Job Number:</span>
              <span className="detail-value">{job.id}</span>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-item">
              <span className="detail-label">Date:</span>
              <span className="detail-value">{job.date}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Shift:</span>
              <span className="detail-value">{job.shift}</span>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-item">
              <span className="detail-label">Batch No. (Material Code):</span>
              <span className="detail-value">{job.batchNo}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Party / CODE:</span>
              <span className="detail-value">{job.party}</span>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-item">
              <span className="detail-label">Planned Production:</span>
              <span className="detail-value">{job.plannedProduction}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Oil Required (auto):</span>
              <span className="detail-value highlight">{job.oilRequired}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">SULPHUR DETAILS</div>
        <div className="detail-grid">
          <div className="detail-row">
            <div className="detail-item">
              <span className="detail-label">Supplier:</span>
              <span className="detail-value">{job.supplier}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Lot Number:</span>
              <span className="detail-value">{job.lotNumber}</span>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-item">
              <span className="detail-label">Empty Date:</span>
              <span className="detail-value">{job.emptyDate}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">OIL DETAILS</div>
        <div className="detail-placeholder">No oil details recorded yet.</div>
      </div>
    </div>
  )
}
