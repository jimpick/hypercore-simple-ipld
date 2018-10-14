const hypercore = require('hypercore')
const randomAccess = require('random-access-storage')
const raf = require('random-access-file')
const argv = require('minimist')(process.argv.slice(2))
const uint64be = require('uint64be')
const ipfsAPI = require('ipfs-api')
const multihash = require('multihashes')
const CID = require('cids')

const ipfs = new ipfsAPI('/ip4/127.0.0.1/tcp/5001')

const nodeCids = new Map()

const pendingTreeNodes = new Set()

console.log('** Creating hypercore')
const dir = 'db'
const feed = hypercore(loader(dir), {
  secretKey: null,
  storeSecretKey: false
})
console.log('** Waiting for hypercore to be ready')
feed.ready(() => {
  console.log('** Feed ready, reading first record')
  feed.get(0, (err, data) => {
    if (err) bail(err)
    console.log('Record 0:', data.toString())
    console.log('** First record read, reading second record')
    feed.get(1, (err, data) => {
      if (err) bail(err)
      console.log('Record 1:', data.toString())
      console.log('** Second record read, reading third record')
      feed.get(2, (err, data) => {
        if (err) bail(err)
        console.log('Record 2:', data.toString())
        console.log('** Third record read, done.') 
      })
    })
  })
})

function bail (err) {
  console.error('Error', err)
  process.exit(1)
}

function loader (dir) {
  return function (name) {
    const diskFile = raf(name, {directory: dir})
    diskFile.label = 'diskFile'
    const ra = randomAccess({
      /*
      open: function (req) {
        if (argv.v) {
          console.log('_open:', name)
        }
        diskFile.open(function (err) {
          req.callback(err)
        })
      },
      openReadonly: function (req) {
        if (argv.v) {
          console.log('_openReadonly:', name)
        }
        diskFile.open(function (err) {
          req.callback(err)
        })
      },
      */
      read: function (req) {
        const {offset, size} = req
        diskFile.read(offset, size, function (err, buffer) {
          if (
            argv.v ||
            (
              name !== 'key' &&
              name !== 'secret_key' &&
              name !== 'bitfield' &&
              name !== 'signatures'
            )
          ) {
            if (name === 'tree') {
              const hash = buffer.slice(0, 32)
              const size = offset !== 0 ? uint64be.decode(buffer, 32) : null
              let nodeIndex = null
              if (offset !== 0) {
                nodeIndex = (offset - 32) / 40
              }
              console.log('_read:', name, nodeIndex, offset, '<=',
                'Hash:', hash.toString('hex'), 'Size:', size)
            } else {
              console.log('_read:', name, offset, size, '=>', buffer)
            }
          }
          req.callback(err, buffer)
        })
      },
      write: function (req) {
        const {offset, data} = req
        if (argv.v) {
          if (name === 'tree') {
            const hash = data.slice(0, 32)
            const size = data.length > 32 ? uint64be.decode(data, 32) : null
            console.log('_write:', name, offset, '<=',
              'Hash:', hash.toString('hex'), 'Size:', size)
          } else if (name === 'data') {
            console.log('_write:', name, offset, '<=',
              `"${data.toString()}"`)
          } else {
            console.log('_write:', name, offset, '<=', data)
          }
        }
        diskFile.write(offset, data, function (err) {
          req.callback(err)
        })
      }
    })
    ra.label = 'proxy'
    return ra
  }
}

