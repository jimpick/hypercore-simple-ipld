const hypercore = require('hypercore')
const rimraf = require('rimraf')
const randomAccess = require('random-access-storage')
const raf = require('random-access-file')
const argv = require('minimist')(process.argv.slice(2))
const uint64be = require('uint64be')
const ipfsAPI = require('ipfs-api')
const multihash = require('multihashes')
const CID = require('cids')
const tree = require('flat-tree')

const ipfs = new ipfsAPI('/ip4/127.0.0.1/tcp/5001')

const nodeCids = new Map()

const pendingTreeNodes = new Set()

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
        processPendingTreeNodesFromStart(() => {
          writeRoots(err => {
            if (err) bail(err)
            console.log('Finished')
          })
        })
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
            const hash = data.slice(0, 32)
            const size = data.length > 32 ? uint64be.decode(data, 32) : null
            console.log('_write:', name, offset, '<=',
              'Hash:', hash.toString('hex'), 'Size:', size)
            if (offset >= 32) {
              let treeData
              const nodeIndex = (offset - 32) / 40
              if (nodeIndex % 2 === 0) {
                // Leaf
                const mhash = multihash.encode(hash, 'blake2b-256')
                const cid = new CID(1, 'raw', mhash)
                treeData = {
                  size: size,
                  leaf: {'/': cid.toBaseEncodedString()}
                }
                writeTree(nodeIndex, treeData, err => {
                  if (err) bail(err)
                })
              } else {
                // Parent
                pendingTreeNodes.add([nodeIndex, size, hash])
              }
              processPendingTreeNodesFromStart()
            }
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
              if (err) bail(err)
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
      }
    })
    ra.label = 'proxy'
    return ra
  }
}

let pendingTreeNodesIterator

function processPendingTreeNodesFromStart (cb) {
  pendingTreeNodesIterator = pendingTreeNodes.values()
  processPendingTreeNodes(cb)
}

function processPendingTreeNodes (cb) {
  const pending = pendingTreeNodesIterator.next()
  if (!pending.done) {
    const [nodeIndex, size, hash] = pending.value
    const leftCid = nodeCids.get(nodeIndex - 1)
    const rightCid = nodeCids.get(nodeIndex + 1)
    if (!leftCid || !rightCid) {
      return processPendingTreeNodes(cb)
    }
    const treeData = {
      size,
      hash,
      left: {'/': leftCid},
      right: {'/': rightCid}
    }
    pendingTreeNodes.delete(pending.value)
    writeTree(nodeIndex, treeData, err => {
      if (err) bail(err)
      processPendingTreeNodesFromStart(cb)
    })
  } else {
    // Finished
    if (cb) cb()
  }
}

function writeTree (nodeIndex, treeData, cb) {
  const options = {format: 'dag-cbor', hashAlg: 'sha3-512'}
  ipfs.dag.put(treeData, options, (err, cid) => {
    if (err) bail(err)
    console.log(`Tree ${nodeIndex} CID:`,
      cid.toBaseEncodedString())
    nodeCids.set(nodeIndex, cid.toBaseEncodedString())
    cb()
  })
}

function writeRoots (cb) {
  console.log('Write roots', feed.length, tree.fullRoots(feed.length * 2))
  const data = {
    length: feed.length,
    roots: tree.fullRoots(feed.length * 2).map(
      nodeIndex => ({'/': nodeCids.get(nodeIndex)})
    )
  }
  const options = {format: 'dag-cbor', hashAlg: 'sha3-512'}
  ipfs.dag.put(data, options, (err, cid) => {
    if (err) return cb(err)
    console.log(`Roots CID:`, cid.toBaseEncodedString('base32'))
    cb()
  })
}