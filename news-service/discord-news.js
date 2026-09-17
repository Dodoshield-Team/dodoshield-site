// Turns pinned messages of one Discord channel into news.json for the site and the launcher.
//
// Pin a message in the news channel -> it shows up on dodoshield.com and in the launcher
// within a minute. Unpin or edit it -> the change follows. Nothing else in the channel
// is published.
//
// Env: DISCORD_CHANNEL_ID (required), DISCORD_TOKEN_FILE (default /secrets/discord-token.txt),
//      NEWS_TARGETS (comma separated output paths), POLL_MS (default 60000), NEWS_LIMIT (default 8).

const fs = require('fs')
const path = require('path')
const https = require('https')

const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID
const TOKEN_FILE = process.env.DISCORD_TOKEN_FILE || '/secrets/discord-token.txt'
const TARGETS = (process.env.NEWS_TARGETS || '/out/launcher/news.json,/out/site/news.json').split(',').map(s => s.trim()).filter(Boolean)
const POLL_MS = Number(process.env.POLL_MS || 60000)
const LIMIT = Number(process.env.NEWS_LIMIT || 8)

const TOKEN = (() => {
    try {
        return fs.readFileSync(TOKEN_FILE, 'utf8').trim()
    } catch (err) {
        return null
    }
})()

const log = (...args) => console.log(new Date().toISOString(), ...args)

function api(pathname) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'discord.com',
            path: '/api/v10' + pathname,
            method: 'GET',
            headers: {
                Authorization: 'Bot ' + TOKEN,
                'User-Agent': 'DodoShieldNews (https://dodoshield.com, 1.0)'
            },
            timeout: 15000
        }, res => {
            let body = ''
            res.on('data', chunk => body += chunk)
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(body))
                    } catch (err) {
                        reject(new Error('bad JSON from ' + pathname))
                    }
                } else {
                    const err = new Error('HTTP ' + res.statusCode + ' from ' + pathname + ': ' + body.slice(0, 200))
                    err.status = res.statusCode
                    reject(err)
                }
            })
        })
        req.on('timeout', () => req.destroy(new Error('timeout')))
        req.on('error', reject)
        req.end()
    })
}

// Discord replaced GET /channels/:id/pins with GET /channels/:id/messages/pins, which answers
// { items: [{ pinned_at, message }] }. Try the new shape first and fall back to the old array.
async function fetchPinned() {
    try {
        const data = await api(`/channels/${CHANNEL_ID}/messages/pins?limit=50`)
        if (Array.isArray(data)) {
            return data
        }
        if (data && Array.isArray(data.items)) {
            return data.items.map(item => item.message).filter(Boolean)
        }
        return []
    } catch (err) {
        if (err.status === 404 || err.status === 405) {
            const data = await api(`/channels/${CHANNEL_ID}/pins`)
            return Array.isArray(data) ? data : []
        }
        throw err
    }
}

// Discord markup means nothing outside Discord, so strip it down to plain text.
function toPlainText(raw) {
    return String(raw || '')
        .replace(/<a?:(\w+):\d+>/g, '')          // custom emoji
        .replace(/<@[!&]?\d+>/g, '')             // user and role mentions
        .replace(/<#\d+>/g, '')                  // channel mentions
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/(\*\*\*|\*\*|\*|__|_|~~|`)/g, '')
        .replace(/^>\s?/gm, '')
        .replace(/[ \t]+$/gm, '')
        .trim()
}

function toNewsItem(message) {
    const text = toPlainText(message.content)
    if (text === '') {
        return null
    }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '')
    const title = lines[0].slice(0, 90)
    const body = lines.slice(1).join(' ').slice(0, 500)
    return {
        date: (message.edited_timestamp || message.timestamp || '').slice(0, 10),
        title,
        text: body,
        // Keeps the ordering stable when two posts share a date.
        _ts: Date.parse(message.timestamp || '') || 0
    }
}

function writeNews(items) {
    const payload = JSON.stringify({ news: items.map(({ _ts, ...item }) => item) }, null, 2) + '\n'
    for (const target of TARGETS) {
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true })
            // Write and rename, so a reader never sees a half-written file.
            const tmp = target + '.tmp'
            fs.writeFileSync(tmp, payload)
            fs.renameSync(tmp, target)
        } catch (err) {
            log('could not write', target, err.message)
        }
    }
}

async function tick() {
    try {
        const pinned = await fetchPinned()
        const items = pinned
            .map(toNewsItem)
            .filter(Boolean)
            .sort((a, b) => b._ts - a._ts)
            .slice(0, LIMIT)
        writeNews(items)
        log('published', items.length, 'news item(s)')
    } catch (err) {
        // Keep the previous news.json on any failure - stale news beats an empty panel.
        log('poll failed:', err.message)
    }
}

// Run without DISCORD_CHANNEL_ID to print the channels the bot can see, so the news
// channel id can be picked from the logs instead of the Discord UI.
async function listChannels() {
    const me = await api('/users/@me')
    log('signed in as:', me.username + (me.discriminator && me.discriminator !== '0' ? '#' + me.discriminator : ''), '(' + me.id + ')')
    const guilds = await api('/users/@me/guilds')
    for (const guild of guilds) {
        log('guild:', guild.name, '(' + guild.id + ')')
        try {
            const member = await api(`/guilds/${guild.id}/members/${me.id}`)
            const roles = await api(`/guilds/${guild.id}/roles`)
            const names = (member.roles || []).map(id => {
                const role = roles.find(r => r.id === id)
                return role ? role.name : id
            })
            log('   roles:', names.length ? names.join(', ') : '(none)')
        } catch (err) {
            log('   could not read own roles:', err.message)
        }
        try {
            const channels = await api(`/guilds/${guild.id}/channels`)
            channels
                .filter(c => c.type === 0 || c.type === 5)   // text and announcement channels
                .sort((a, b) => (a.position || 0) - (b.position || 0))
                .forEach(c => log('   #' + c.name, '->', c.id))
        } catch (err) {
            log('   could not list channels:', err.message)
        }
    }
}

if (TOKEN == null) {
    log('no bot token at', TOKEN_FILE, '- nothing to do')
    process.exit(1)
}
if (!CHANNEL_ID) {
    log('DISCORD_CHANNEL_ID is not set - listing what the bot can see instead')
    listChannels()
        .catch(err => log('could not list guilds:', err.message))
        .then(() => process.exit(0))
    return
}

if (!/^\d+$/.test(CHANNEL_ID)) {
    log('DISCORD_CHANNEL_ID must be the numeric channel id, got:', CHANNEL_ID)
    log('In Discord: Settings -> Advanced -> Developer Mode, then right click the channel -> Copy Channel ID')
    process.exit(1)
}

log('watching channel', CHANNEL_ID, '| targets:', TARGETS.join(', '))
api(`/channels/${CHANNEL_ID}`)
    .then(channel => log('channel name: #' + channel.name))
    .catch(err => log('cannot read the channel:', err.message))
tick()
setInterval(tick, POLL_MS)
