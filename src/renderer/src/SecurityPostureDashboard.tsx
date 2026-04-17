import { useEffect, useState } from 'react'
import './security-posture-dashboard.css'
import { SvcState } from './SvcState'
import { FreshnessIndicator, useFreshnessState } from './freshness'

import type {
  AwsConnection,
  SecurityDomainResult,
  SecurityScoreDomain,
  SecurityScoreReport,
  SecurityScoreWeights
} from '@shared/types'
import { getSecurityScoreReport, invalidatePageCache, recordSecuritySnapshot } from './api'

const DOMAIN_LABELS: Record<SecurityScoreDomain, string> = {
  iam: 'IAM & Access',
  network: 'Network Security',
  encryption: 'Encryption',
  logging: 'Logging & Monitoring',
  compliance: 'Compliance Benchmarks'
}

const SEVERITY_BADGE: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'rgba(239, 68, 68, 0.16)', fg: '#ff8b72' },
  medium: { bg: 'rgba(245, 158, 11, 0.16)', fg: '#fbbf24' },
  low: { bg: 'rgba(234, 179, 8, 0.16)', fg: '#facc15' }
}

function scoreTone(score: number): string {
  if (score >= 90) return '#5cc58c'
  if (score >= 70) return '#facc15'
  if (score >= 50) return '#f59a3d'
  return '#ff8b72'
}

function scoreGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

function ScoreRing({ score, size = 144 }: { score: number; size?: number }) {
  const radius = (size - 18) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const tone = scoreTone(score)

  return (
    <svg width={size} height={size} className="spd-score-ring-svg">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(145, 176, 207, 0.12)"
        strokeWidth={10}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={tone}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x={size / 2}
        y={size / 2 - 6}
        textAnchor="middle"
        dominantBaseline="central"
        className="spd-score-ring-value"
        fill="#edf4fb"
      >
        {score}
      </text>
      <text
        x={size / 2}
        y={size / 2 + 18}
        textAnchor="middle"
        dominantBaseline="central"
        className="spd-score-ring-grade"
        fill={tone}
      >
        {scoreGrade(score)}
      </text>
    </svg>
  )
}

function DomainCard({
  result,
  expanded,
  onToggle
}: {
  result: SecurityDomainResult
  expanded: boolean
  onToggle: () => void
}) {
  const passed = result.checks.filter((c) => c.passed).length
  const total = result.checks.length
  const tone = scoreTone(result.score)

  return (
    <div className="panel stack spd-domain-card">
      <button
        type="button"
        className="spd-domain-card-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="spd-domain-card-copy">
          <strong>{DOMAIN_LABELS[result.domain]}</strong>
          <small>{passed}/{total} checks passed</small>
        </div>
        <div className="spd-domain-card-score-block">
          <div
            className="spd-domain-bar-track"
            aria-label={`Score ${result.score} out of 100`}
          >
            <div
              className="spd-domain-bar-fill"
              style={{ width: `${result.score}%`, backgroundColor: tone }}
            />
          </div>
          <strong className="spd-domain-score" style={{ color: tone }}>{result.score}</strong>
        </div>
        <span className={`spd-domain-expand ${expanded ? 'open' : ''}`} aria-hidden>
          {expanded ? '\u25BE' : '\u25B8'}
        </span>
      </button>

      {expanded && (
        <div className="spd-check-list">
          {result.checks.map((check) => {
            const sev = SEVERITY_BADGE[check.severity] ?? SEVERITY_BADGE.low
            return (
              <div key={check.id} className={`spd-check-row ${check.passed ? 'pass' : 'fail'}`}>
                <span className="spd-check-icon" aria-hidden>
                  {check.passed ? '\u2713' : '\u2717'}
                </span>
                <div className="spd-check-body">
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </div>
                <span
                  className="eks-badge"
                  style={{ background: sev.bg, color: sev.fg, fontWeight: 600, fontSize: '0.65rem' }}
                >
                  {check.severity.toUpperCase()}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SecurityPostureDashboard({
  connection,
  refreshNonce = 0
}: {
  connection: AwsConnection
  refreshNonce?: number
}) {
  const [report, setReport] = useState<SecurityScoreReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedDomain, setExpandedDomain] = useState<SecurityScoreDomain | null>(null)
  const [showWeights, setShowWeights] = useState(false)
  const [weights, setWeights] = useState<SecurityScoreWeights>({
    iam: 30,
    network: 25,
    encryption: 20,
    logging: 15,
    compliance: 10
  })
  const freshness = useFreshnessState()

  async function loadReport() {
    setLoading(true)
    setError('')
    freshness.beginRefresh()
    try {
      const result = await getSecurityScoreReport(connection, weights)
      setReport(result)
      freshness.completeRefresh()

      try {
        const failedChecks = result.domainResults.flatMap((d) => d.checks.filter((c) => !c.passed))
        const high = failedChecks.filter((c) => c.severity === 'high').length
        const medium = failedChecks.filter((c) => c.severity === 'medium').length
        const low = failedChecks.filter((c) => c.severity === 'low').length
        const total = failedChecks.length
        const complianceDomain = result.domainResults.find((d) => d.domain === 'compliance')
        const passRate = complianceDomain ? complianceDomain.score : 0
        const scope = `${connection.profile || 'session'}::${connection.region}`
        const scopeLabel = connection.profile
          ? `${connection.profile} / ${connection.region}`
          : `session / ${connection.region}`

        const domainScores: Record<SecurityScoreDomain, number> = {
          iam: 0, network: 0, encryption: 0, logging: 0, compliance: 0
        }
        for (const d of result.domainResults) {
          domainScores[d.domain] = d.score
        }

        await recordSecuritySnapshot({
          scope,
          scopeLabel,
          overallScore: result.overallScore,
          domainScores,
          findingCounts: { high, medium, low, total },
          complianceBenchmarkPassRate: passRate,
          newFindings: 0,
          remediatedFindings: 0
        })
      } catch {
        /* best-effort snapshot */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      freshness.failRefresh()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReport()

  }, [connection.profile, connection.region, refreshNonce])

  function handleRefresh() {
    invalidatePageCache('security-score')
    void loadReport()
  }

  function handleWeightChange(domain: SecurityScoreDomain, value: number) {
    setWeights((prev) => ({ ...prev, [domain]: value }))
  }

  if (loading && !report) {
    return <SvcState variant="loading" resourceName="security posture" />
  }

  if (error && !report) {
    return <SvcState variant="error" resourceName="security posture" error={error} />
  }

  if (!report) {
    return <SvcState variant="empty" resourceName="security posture" />
  }

  const failedChecks = report.domainResults.flatMap((d) => d.checks.filter((c) => !c.passed))
  const highFailures = failedChecks.filter((c) => c.severity === 'high').length
  const mediumFailures = failedChecks.filter((c) => c.severity === 'medium').length

  return (
    <div className="svc-console stack spd-console">
      {/* Hero */}
      <section className="iam-shell-hero spd-hero">
        <div className="iam-shell-hero-copy">
          <div className="eyebrow">Security posture</div>
          <h2>Security Posture Dashboard</h2>
          <p>
            Unified security score across IAM, network, encryption, logging, and compliance
            domains. Adjust weights to tune scoring for your environment.
          </p>
          <div className="iam-shell-meta-strip">
            <div className="iam-shell-meta-pill">
              <span>Profile</span><strong>{connection.profile || 'session'}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Region</span><strong>{connection.region}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Checks</span><strong>{report.domainResults.reduce((n, d) => n + d.checks.length, 0)}</strong>
            </div>
            <div className="iam-shell-meta-pill">
              <span>Generated</span><strong>{new Date(report.generatedAt).toLocaleTimeString()}</strong>
            </div>
          </div>
        </div>
        <div className="iam-shell-hero-stats spd-hero-stats">
          <div className="iam-shell-stat-card iam-shell-stat-card-accent spd-hero-score-card">
            <ScoreRing score={report.overallScore} />
            <div className="spd-hero-score-copy">
              <span>Overall score</span>
              <strong>{report.overallScore} / 100</strong>
              <small>Grade {scoreGrade(report.overallScore)}</small>
            </div>
          </div>
          <div className="iam-shell-stat-card">
            <span>Critical findings</span>
            <strong style={{ color: '#ff8b72' }}>{highFailures}</strong>
            <small>High-severity checks failing</small>
          </div>
          <div className="iam-shell-stat-card">
            <span>Warnings</span>
            <strong style={{ color: '#fbbf24' }}>{mediumFailures}</strong>
            <small>Medium-severity findings</small>
          </div>
          <div className="iam-shell-stat-card">
            <span>Domains</span>
            <strong>{report.domainResults.length}</strong>
            <small>Scored across posture</small>
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="iam-shell-toolbar">
        <div className="iam-tab-bar">
          <button
            type="button"
            className={`svc-tab ${!showWeights ? 'active' : ''}`}
            onClick={() => setShowWeights(false)}
          >
            Domain checks
          </button>
          <button
            type="button"
            className={`svc-tab ${showWeights ? 'active' : ''}`}
            onClick={() => setShowWeights(true)}
          >
            Scoring weights
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <FreshnessIndicator freshness={freshness.freshness} />
            <button
              type="button"
              className="svc-btn"
              onClick={handleRefresh}
              disabled={loading}
            >
              {loading ? 'Scanning\u2026' : 'Rescan'}
            </button>
          </div>
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="error-banner">
          <strong>Some checks could not complete:</strong>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {report.warnings.map((w, i) => (
              <li key={i} style={{ fontSize: '0.8rem' }}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Domain Bars Summary */}
      <section className="panel stack spd-summary-panel">
        <div className="panel-header">
          <h3>Domain scores</h3>
        </div>
        <div className="spd-domain-summary">
          {report.domainResults.map((result) => (
            <div key={result.domain} className="spd-domain-summary-row">
              <span className="spd-domain-summary-label">{DOMAIN_LABELS[result.domain]}</span>
              <div className="spd-domain-bar-track">
                <div
                  className="spd-domain-bar-fill"
                  style={{ width: `${result.score}%`, backgroundColor: scoreTone(result.score) }}
                />
              </div>
              <strong className="spd-domain-summary-value" style={{ color: scoreTone(result.score) }}>
                {result.score}
              </strong>
            </div>
          ))}
        </div>
      </section>

      {/* Tab Content */}
      {showWeights ? (
        <section className="panel stack spd-weights-panel">
          <div className="panel-header">
            <h3>Adjust scoring weights</h3>
            <small style={{ color: '#8fa3ba' }}>Tune how each domain contributes to the overall score.</small>
          </div>
          <div className="spd-weights-body">
            {(['iam', 'network', 'encryption', 'logging', 'compliance'] as SecurityScoreDomain[]).map((domain) => (
              <div key={domain} className="spd-weight-row">
                <label className="field">
                  <span>{DOMAIN_LABELS[domain]}</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={weights[domain]}
                  onChange={(e) => handleWeightChange(domain, Number(e.target.value))}
                />
                <strong>{weights[domain]}%</strong>
              </div>
            ))}
          </div>
          <div className="spd-weights-actions">
            <button type="button" className="svc-btn" onClick={handleRefresh} disabled={loading}>
              {loading ? 'Recalculating\u2026' : 'Apply & recalculate'}
            </button>
          </div>
        </section>
      ) : (
        <div className="spd-domain-list">
          {report.domainResults.map((result) => (
            <DomainCard
              key={result.domain}
              result={result}
              expanded={expandedDomain === result.domain}
              onToggle={() => setExpandedDomain(expandedDomain === result.domain ? null : result.domain)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
