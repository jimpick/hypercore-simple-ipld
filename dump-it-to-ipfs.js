const hypercore = require('hypercore')
const rimraf = require('rimraf')
const randomAccess = require('random-access-storage')
const raf = require('random-access-file')
const argv = require('minimist')(process.argv.slice(2))
const uint64be = require('uint64be')
const ipfsAPI = require('ipfs-api')

const ipfs = new ipfsAPI('/ip4/127.0.0.1/tcp/5001')

console.log('** Creating hypercore')
const dir = 'db'
rimraf.sync(dir)
const feed = hypercore(dumper(dir))
console.log('** Waiting for hypercore to be ready')
feed.ready(() => {
  console.log('** Feed ready, writing first record')
  feed.append('record a', err => {
    console.log('** First record written, writing second record')
    if (err) bail(err)
    feed.append('record b', err => {
      if (err) bail(err)
      console.log('** Second record written, writing third record')
      feed.append('record c', err => {
        if (err) bail(err)
        console.log('** Third record written, done.') 
      })
    })
  })
})

function bail (err) {
  console.error('Error', err)
  process.exit(1)
}

function dumper (dir) {
  return function (name) {
    const diskFile = raf(name, {directory: dir})
    diskFile.label = 'diskFile'
    const ra = randomAccess({
      read: function (req) {
        const {offset, size} = req
        diskFile.read(offset, size, function (err, buffer) {
          if (argv.v) {
            console.log('_read:', name, offset, size, '=>', buffer)
          }
          req.callback(err, buffer)
        })
      },
      write: function (req) {
        const {offset, data} = req
        if (
          argv.v ||
          (
            name !== 'bitfield' &&
            name !== 'signatures' &&
            name !== 'key' &&
            name !== 'secret_key' &&
            !(name === 'tree' && offset === 0)
          )
        ) {
          if (name === 'tree') {
            const hash = data.slice(0, 32).toString('hex')
            const size = data.length > 32 ? uint64be.decode(data, 32) : null
            console.log('_write:', name, offset, '<=',
              'Hash:', hash, 'Size:', size)
          } else if (name === 'data') {
            console.log('_write:', name, offset, '<=',
              `"${data.toString()}"`)
            const options = { format: 'raw', hashAlg: 'blake2b-256' }
            const leaf = Buffer.concat([
              Buffer.from([0]),
              uint64be.encode(data.length),
              data
            ])
            ipfs.dag.put(leaf, options, (err, cid) => {
              if (err) return cb(err)
              console.log(`Wrote leaf at offset ${offset} to IPFS:`, leaf)
              console.log('CID:', cid.toBaseEncodedString())
              console.log('Multihash:', cid.multihash.toString('hex'))
            })
          } else {
            console.log('_write:', name, offset, '<=', data)
          }
        }
        diskFile.write(offset, data, function (err) {
          req.callback(err)
        })
      },
      close: function (req) {
        console.log('_close:', name, req)
        process.exit(0)
        req.callback(null)
      }
    })
    ra.label = 'proxy'
    return ra
  }
}
