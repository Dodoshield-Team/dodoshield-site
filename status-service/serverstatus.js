/**
 * Minecraft server list ping (protocol >= 1.7) without a cap on response size.
 * helios-core's implementation gives up after 5 TCP chunks, which is too small for
 * Forge servers whose status JSON carries a large mod list.
 */
const net = require('net')
const dns = require('dns')

function varInt(value) {
    const bytes = []
    do {
        let b = value & 0x7F
        value >>>= 7
        if (value !== 0) b |= 0x80
        bytes.push(b)
    } while (value !== 0)
    return Buffer.from(bytes)
}

function readVarInt(buf, offset) {
    let result = 0, shift = 0, pos = offset
    for (;;) {
        if (pos >= buf.length) return null
        const b = buf[pos++]
        result |= (b & 0x7F) << shift
        if ((b & 0x80) === 0) break
        shift += 7
        if (shift > 35) throw new Error('VarInt too big')
    }
    return { value: result, size: pos - offset }
}

function packet(id, payload) {
    const body = Buffer.concat([varInt(id), payload])
    return Buffer.concat([varInt(body.length), body])
}

function handshake(protocol, host, port) {
    const h = Buffer.from(host, 'utf8')
    const p = Buffer.alloc(2)
    p.writeUInt16BE(port)
    return packet(0x00, Buffer.concat([varInt(protocol), varInt(h.length), h, p, varInt(1)]))
}

async function resolveSrv(host) {
    try {
        const records = await dns.promises.resolveSrv(`_minecraft._tcp.${host}`)
        if (records && records.length > 0) return { host: records[0].name, port: records[0].port }
    } catch (_) { /* no SRV record */ }
    return null
}

/**
 * @returns {Promise<{players:{online:number,max:number}, version:{name:string}}>}
 */
exports.getServerStatus = async function(host, port = 25565, protocol = 47, timeoutMs = 7000) {
    if (port === 25565) {
        const srv = await resolveSrv(host)
        if (srv) { host = srv.host; port = srv.port }
    }
    return new Promise((resolve, reject) => {
        const chunks = []
        let received = 0
        let expected = -1
        const socket = net.connect(port, host, () => {
            socket.write(handshake(protocol, host, port))
            socket.write(packet(0x00, Buffer.alloc(0)))
        })
        const fail = (err) => { socket.destroy(); reject(err) }
        socket.setTimeout(timeoutMs, () => fail(new Error(`Server status timed out (${host}:${port})`)))
        socket.on('error', fail)
        socket.on('data', (data) => {
            chunks.push(data)
            received += data.length
            const buf = Buffer.concat(chunks)
            if (expected < 0) {
                const len = readVarInt(buf, 0)
                if (len == null) return
                expected = len.value + len.size
            }
            if (received < expected) return
            try {
                const len = readVarInt(buf, 0)
                const id = readVarInt(buf, len.size)
                if (id.value !== 0x00) throw new Error(`Unexpected packet id ${id.value}`)
                const strLen = readVarInt(buf, len.size + id.size)
                const start = len.size + id.size + strLen.size
                const parsed = JSON.parse(buf.subarray(start, start + strLen.value).toString('utf8'))
                socket.end()
                resolve({
                    players: { online: parsed.players?.online ?? 0, max: parsed.players?.max ?? 0 },
                    version: { name: parsed.version?.name ?? '' }
                })
            } catch (err) {
                fail(err)
            }
        })
    })
}
