const fs = require('fs')
const hypercore = require('hypercore')
const randomAccess = require('random-access-storage')
const raf = require('random-access-file')
const argv = require('minimist')(process.argv.slice(2))
const uint64be = require('uint64be')
const ipfsAPI = require('ipfs-api')
const thunky = require('thunky')
const tree = require('flat-tree')

console.log('** Loading IPFS')
const ipfs = new ipfsAPI('/ip4/127.0.0.1/tcp/5001')
const latestCid = fs.readFileSync('./db/latest', 'utf8')
console.log('** Loading hypercore')
const dir = 'db'
const feed = hypercore(loader(ipfs, latestCid, dir), {
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

function loader (ipfs, latestCide, dir) {
  const treeSizes = new Map()
  const getLength = thunky(function (cb) {
    ipfs.dag.get(latestCid, (err, data) => {
      if (err) bail(err)
      const {length, sizes} = data.value
      console.log('Latest length:', length)
      console.log('Latest root sizes:', sizes.join(' '))
      const roots = tree.fullRoots(length * 2)
      roots.forEach((root, index) => {
        treeSizes.set(root, sizes[index])
      })
      cb(null, length)
    })
  })
  return function (name) {
    const diskFile = raf(name, {directory: dir})
    diskFile.label = 'diskFile'
    const ra = randomAccess({
      read: function (req) {
        const {offset, size} = req
        if (name === 'tree') {
          let nodeIndex = null
          if (offset !== 0) {
            nodeIndex = (offset - 32) / 40
          }
          // console.log('_read:', name, nodeIndex)
          getIPLDPath(nodeIndex, getLength, (err, ipldPath) => {
            if (err) bail(err)
            // console.log(`IPLD path for ${nodeIndex}:`, ipldPath)
            ipfs.dag.get(latestCid, ipldPath, (err, data) => {
              if (err) bail(err)
              let {size, hash, leaf} = data.value
              if (leaf) {
                hash = leaf['/'].slice(-32)
              }
              console.log('_read (IPLD):', name, nodeIndex, '<=',
                'Hash:', hash.toString('hex'), 'Size:', size)
              treeSizes.set(nodeIndex, size)
              const buffer = Buffer.concat([
                hash,
                uint64be.encode(size)
              ])
              req.callback(err, buffer)
            })
          })
        } else if (name === 'data') {
          getDataForOffset(offset, getLength, treeSizes, (err, data) => {
            if (err) bail(err)
            data = data.slice(0, size)
            console.log('_read (IPLD):', name, offset, size, '<=', 
              `"${data.toString()}"`)
            req.callback(err, data)
          })
        } else {
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
              console.log('_read:', name, offset, size, '=>', buffer)
            }
            req.callback(err, buffer)
          })
        }
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

function getIPLDPath (nodeIndex, getLength, cb) {
  getLength((err, length) => {
    if (err) return cb(err)
    const roots = tree.fullRoots(length * 2)
    const descendants = []

    checkNodeIndex(nodeIndex)

    function checkNodeIndex (nodeIndex) {
      const rootIndex = roots.indexOf(nodeIndex)
      if (rootIndex >= 0) {
        let path = `roots/${rootIndex}`
        let lastIndex = nodeIndex
        for (let descendantIndex of descendants) {
          path += '/' + (descendantIndex < lastIndex ? 'left' : 'right')
          lastIndex = descendantIndex
        }
        cb(null, path)
      } else {
        descendants.unshift(nodeIndex)
        checkNodeIndex(tree.parent(nodeIndex))
      }
    }
  })
}

function getDataForOffset (offset, getLength, treeSizes, cb) {
  console.log('Jim getDataForOffset', offset)
  getLength((err, length) => {
    if (err) return cb(err)
    const roots = tree.fullRoots(length * 2)
    /*
    for (let root of roots) {
      console.log(`Jim root ${root}`, treeSizes.get(root))
    }
    */

    findNodeIndexForOffset(nodeIndex => {
      getIPLDPath(nodeIndex, getLength, (err, ipldPath) => {
        ipfs.dag.get(latestCid, ipldPath, (err, data) => {
          if (err) return cb(err)
          const {size, leaf} = data.value
          const leafHash = leaf['/']
          treeSizes.set(nodeIndex, size)
          ipfs.block.get(leafHash, (err, block) => {
            if (err) return cb(err)
            cb(null, block.data.slice(9))
          })
        })
      })
    })

    function findNodeIndexForOffset (cb) {
      // Start at roots
      let rootStartOffset = 0
      let rootEndOffset = 0
      for (let root of roots) {
        const [leftLeafNode, rightLeafNode] = tree.spans(root)
        const size = treeSizes.get(root)
        rootStartOffset = rootEndOffset
        rootEndOffset = rootStartOffset + size
        console.log('Jim findRoot', root, 'size', size,
          'startOffset', rootStartOffset, 'endOffset', rootEndOffset,
          'left', leftLeafNode, 'right', rightLeafNode)
        if (offset >= rootEndOffset) continue
        if (offset === rootStartOffset) {
          // First node in sub-tree
          return cb(leftLeafNode)
        } else if (
          offset < rootEndOffset &&
          rightLeafNode === leftLeafNode + 2
        ) {
          // Only 2 nodes in sub-tree, pick right node
          return cb(rightLeafNode)
        } else {
          // Iterate, find sizes
          bail(new Error('Not implemented'))
          const children = tree.children(root)
        }
      }
    }
  })
}