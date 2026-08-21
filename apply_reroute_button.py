import re
import sys

PATH = "src/App.tsx"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

original = content
patches_applied = []

# 1. Update the import line to add generateReroutesApi and adaptReroute
old_import = '''import {
  fetchDashboardData,
  dismissAlertApi,
  setRouteWatchedApi,
  applyRerouteApi,
  dismissRerouteApi,
} from "./services/project44"'''

new_import = '''import {
  fetchDashboardData,
  dismissAlertApi,
  setRouteWatchedApi,
  applyRerouteApi,
  dismissRerouteApi,
  generateReroutesApi,
  adaptReroute,
} from "./services/project44"'''

if old_import in content:
    content = content.replace(old_import, new_import, 1)
    patches_applied.append("import")
else:
    print("FAILED: import block not found")
    sys.exit(1)

# 2. Add generatingReroutes state near the other ML state
old_state = '''  // ML state
  const [mlScores, setMlScores] = useState<Record<number, MLScore>>({})
  const [mlRunning, setMlRunning] = useState(false)
  const [expandedMLId, setExpandedMLId] = useState<number | null>(null)'''

new_state = '''  // ML state
  const [mlScores, setMlScores] = useState<Record<number, MLScore>>({})
  const [mlRunning, setMlRunning] = useState(false)
  const [expandedMLId, setExpandedMLId] = useState<number | null>(null)

  // Reroute generation state
  const [generatingReroutes, setGeneratingReroutes] = useState(false)'''

if old_state in content:
    content = content.replace(old_state, new_state, 1)
    patches_applied.append("state")
else:
    print("FAILED: ML state block not found")
    sys.exit(1)

# 3. Add the generateSuggestions handler, right after dismissReroute
old_handler = '''  const dismissReroute = (id: number) => {
    setReroutes(prev => prev.map(r => (r.id === id ? { ...r, dismissed: true } : r)))
    dismissRerouteApi(id).catch(err => console.error("Failed to dismiss reroute on server:", err))
  }'''

new_handler = '''  const dismissReroute = (id: number) => {
    setReroutes(prev => prev.map(r => (r.id === id ? { ...r, dismissed: true } : r)))
    dismissRerouteApi(id).catch(err => console.error("Failed to dismiss reroute on server:", err))
  }

  const generateSuggestions = async () => {
    if (generatingReroutes) return
    setGeneratingReroutes(true)
    try {
      const targets = routes.filter(r => r.risk === "critical" || r.risk === "high")
      const results = await Promise.all(
        targets.map(r => generateReroutesApi(r.id).catch(err => {
          console.error(`Failed to generate reroutes for route ${r.id}:`, err)
          return [] as Awaited<ReturnType<typeof generateReroutesApi>>
        }))
      )
      const newReroutes = results.flat().map(rr => adaptReroute(rr, new Map()))
      setReroutes(prev => {
        const existingIds = new Set(prev.map(r => r.id))
        const deduped = newReroutes.filter(r => !existingIds.has(r.id))
        return [...prev, ...deduped]
      })
    } finally {
      setGeneratingReroutes(false)
    }
  }'''

if old_handler in content:
    content = content.replace(old_handler, new_handler, 1)
    patches_applied.append("handler")
else:
    print("FAILED: dismissReroute handler not found")
    sys.exit(1)

# 4. Pass the new props into <DashboardView ... />
old_call = '''            onApplyReroute={applyReroute}
            onDismissReroute={dismissReroute}
            mlScores={mlScores}'''

new_call = '''            onApplyReroute={applyReroute}
            onDismissReroute={dismissReroute}
            onGenerateReroutes={generateSuggestions}
            generatingReroutes={generatingReroutes}
            mlScores={mlScores}'''

if old_call in content:
    content = content.replace(old_call, new_call, 1)
    patches_applied.append("dashboard call")
else:
    print("FAILED: DashboardView call not found")
    sys.exit(1)

# 5. Add to DashboardView's prop destructuring + type signature
old_sig = '''  onApplyReroute,
  onDismissReroute,
  mlScores,'''

new_sig = '''  onApplyReroute,
  onDismissReroute,
  onGenerateReroutes,
  generatingReroutes,
  mlScores,'''

if old_sig in content:
    content = content.replace(old_sig, new_sig, 1)
    patches_applied.append("dashboard destructure")
else:
    print("FAILED: DashboardView destructure not found")
    sys.exit(1)

old_types = '''  onApplyReroute: (id: number) => void
  onDismissReroute: (id: number) => void
  mlScores: Record<number, MLScore>'''

new_types = '''  onApplyReroute: (id: number) => void
  onDismissReroute: (id: number) => void
  onGenerateReroutes: () => void
  generatingReroutes: boolean
  mlScores: Record<number, MLScore>'''

if old_types in content:
    content = content.replace(old_types, new_types, 1)
    patches_applied.append("dashboard types")
else:
    print("FAILED: DashboardView types not found")
    sys.exit(1)

# 6. Add the button in the AI Rerouting header
old_header = '''          <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "#22c55e" }}>
            {reroutes.filter(r => !r.applied && !r.dismissed).length} suggestions
          </span>
        </div>'''

new_header = '''          <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "#22c55e" }}>
            {reroutes.filter(r => !r.applied && !r.dismissed).length} suggestions
          </span>
        </div>
        <div style={{ padding: "8px 14px 0" }}>
          <button
            onClick={onGenerateReroutes}
            disabled={generatingReroutes}
            style={{
              width: "100%",
              padding: "6px 10px",
              fontSize: 9,
              fontFamily: "DM Mono, monospace",
              fontWeight: 700,
              letterSpacing: "0.06em",
              background: "var(--primary-dim)",
              color: "var(--primary)",
              border: "1px solid var(--primary)40",
              borderRadius: 4,
              cursor: generatingReroutes ? "default" : "pointer",
              opacity: generatingReroutes ? 0.6 : 1,
            }}
          >
            {generatingReroutes ? "GENERATING…" : "⟳ GENERATE SUGGESTIONS"}
          </button>
        </div>'''

if old_header in content:
    content = content.replace(old_header, new_header, 1)
    patches_applied.append("button")
else:
    print("FAILED: AI Rerouting header not found")
    sys.exit(1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Applied {len(patches_applied)} patches: {', '.join(patches_applied)}")
