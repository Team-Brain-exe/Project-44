import sys

PATH = "src/App.tsx"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

patches_applied = []

# 1. Update AlertsPage's function signature to accept onNotify
old_sig = '''function AlertsPage({ alerts, onDismiss }: { alerts: AlertEvent[]; onDismiss: (id: number) => void }) {'''
new_sig = '''function AlertsPage({ alerts, onDismiss, onNotify }: { alerts: AlertEvent[]; onDismiss: (id: number) => void; onNotify: (id: number) => void }) {'''

if old_sig in content:
    content = content.replace(old_sig, new_sig, 1)
    patches_applied.append("AlertsPage signature")
else:
    print("FAILED: AlertsPage signature not found")
    sys.exit(1)

# 2. Wire the button's onClick
old_btn = '''                  <Btn small>NOTIFY TEAM</Btn>'''
new_btn = '''                  <Btn small onClick={() => onNotify(a.id)}>NOTIFY TEAM</Btn>'''

if old_btn in content:
    content = content.replace(old_btn, new_btn, 1)
    patches_applied.append("button onClick")
else:
    print("FAILED: NOTIFY TEAM button not found")
    sys.exit(1)

# 3. Pass onNotify from App down to AlertsPage
old_call = '''        {page === "alerts" && <AlertsPage alerts={alerts} onDismiss={dismissAlert} />}'''
new_call = '''        {page === "alerts" && <AlertsPage alerts={alerts} onDismiss={dismissAlert} onNotify={notifyTeam} />}'''

if old_call in content:
    content = content.replace(old_call, new_call, 1)
    patches_applied.append("AlertsPage call")
else:
    print("FAILED: AlertsPage call not found")
    sys.exit(1)

# 4. Update the import to add notifyTeamApi
old_import = '''  generateReroutesApi,
  adaptReroute,
} from "./services/project44"'''
new_import = '''  generateReroutesApi,
  adaptReroute,
  notifyTeamApi,
} from "./services/project44"'''

if old_import in content:
    content = content.replace(old_import, new_import, 1)
    patches_applied.append("import")
else:
    print("FAILED: import block not found")
    sys.exit(1)

# 5. Add the notifyTeam handler function, right after dismissAlert
old_handler = '''  const dismissAlert = (id: number) => {
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, dismissed: true } : a)))
    dismissAlertApi(id).catch(err => console.error("Failed to dismiss alert on server:", err))
  }'''
new_handler = '''  const dismissAlert = (id: number) => {
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, dismissed: true } : a)))
    dismissAlertApi(id).catch(err => console.error("Failed to dismiss alert on server:", err))
  }

  const notifyTeam = (id: number) => {
    const alert = alerts.find(a => a.id === id)
    if (!alert) return
    const message = `[${alert.severity.toUpperCase()}] ${alert.type} at ${alert.location}: ${alert.summary}`
    notifyTeamApi(id, message)
      .then(results => {
        const sent = results.filter(r => r.status === "sent" || r.status === "success").length
        window.alert(`Notified ${sent} of ${results.length} device(s).`)
      })
      .catch(err => {
        console.error("Failed to notify team:", err)
        window.alert("Failed to send notification. Check console for details.")
      })
  }'''

if old_handler in content:
    content = content.replace(old_handler, new_handler, 1)
    patches_applied.append("notifyTeam handler")
else:
    print("FAILED: dismissAlert handler not found")
    sys.exit(1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Applied {len(patches_applied)} patches: {', '.join(patches_applied)}")
