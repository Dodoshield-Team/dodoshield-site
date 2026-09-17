// Pings the DodoShield servers every 30 s and writes /out/status.json for the public site.
const fs = require('fs')
const https = require('https')
const { getServerStatus } = require('./serverstatus')
// Monobank personal API token (read-only). Mounted from the host, never committed.
const MONO_TOKEN = (() => { try { return fs.readFileSync('/secrets/mono-token.txt', 'utf8').trim() } catch (e) { return null } })()
const JAR_SEND_ID = 'jar/4KmkzrFSKJ'
let jar = null
function fetchJar() {
    if (!MONO_TOKEN) return
    const req = https.get('https://api.monobank.ua/personal/client-info', { headers: { 'X-Token': MONO_TOKEN }, timeout: 15000 }, res => {
        let body = ''
        res.on('data', d => body += d)
        res.on('end', () => {
            try {
                const j = JSON.parse(body)
                const found = (j.jars || []).find(x => x.sendId === JAR_SEND_ID)
                if (found) jar = { balance: found.balance / 100, goal: found.goal / 100, title: found.title, updated: new Date().toISOString() }
            } catch (e) { /* keep last value */ }
        })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => {})
}
const SERVERS = {
    immortal: { host: '127.0.0.1', port: 25569 },
    hub: { host: '127.0.0.1', port: 25565 }
}
async function tick() {
    const out = { updated: new Date().toISOString(), servers: {}, jar }
    for (const [id, s] of Object.entries(SERVERS)) {
        try {
            const r = await getServerStatus(s.host, s.port)
            out.servers[id] = { online: true, players: r.players.online, max: r.players.max }
        } catch (e) {
            out.servers[id] = { online: false }
        }
    }
    fs.writeFileSync('/out/status.json.tmp', JSON.stringify(out))
    fs.renameSync('/out/status.json.tmp', '/out/status.json')
}
fetchJar()
setInterval(fetchJar, 90000) // Monobank allows 1 request / 60 s
tick().catch(() => {})
setInterval(() => tick().catch(() => {}), 30000)
