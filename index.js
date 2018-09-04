const hypercore = require('hypercore')
const ram = require('random-access-memory')
const tree = require('flat-tree')
const dagPB = require('ipld-dag-pb')
const ipfsAPI = require('ipfs-api')

const ipfs = new ipfsAPI('/ip4/127.0.0.1/tcp/5001')

const recordDataCids = []
const nodeCids = []
const nodeSizes = []
const signatureNodeCids = []

const feed = hypercore(ram)
feed.append('record a', err => {
  if (err) throw err
  feed.append('record b', err => {
    if (err) throw err
    feed.append('record c', err => {
      if (err) throw err
      dumpHypercore(feed, err => {
        if (err) throw err
        console.log('Done.')
      })
    })
  })
})

function dumpHypercore (feed, cb) {
  dumpRecords(0, err => {
    if (err) return cb(err)
    const roots = tree.fullRoots(feed.length * 2)
    const crawl = roots.reduce(crawler, [])
    console.log('Crawl', crawl.join(' '))
    dumpNodes(crawl, err => {
      if (err) return cb(err)
      dumpRoots(feed.length - 1, cb)
    })
  })
  
  function dumpRecords (index, cb) {
    if (index >= feed.length) return cb()
    dumpRecord(index, err => {
      if (err) return cb(err)
      dumpRecords(index + 1, cb)
    })
  }

  function dumpNodes (crawl, cb) {
    if (crawl.length === 0) return cb()
    const index = crawl.shift()
    dumpNode(index, err => {
      if (err) return cb(err)
      dumpNodes(crawl, cb)
    })
  }
}

function dumpRecord (index, cb) {
  feed.get(index, (err, data) => {
    if (err) return cb(err)
    console.log('Data', index, data.toString())
    dagPB.DAGNode.create(data, (err, node) => {
      if (err) return cb(err)
      const opts = { format: 'dag-pb', hashAlg: 'sha2-256' }
      ipfs.dag.put(node, opts, (err, cid) => {
        if (err) return cb(err)
        console.log('CID:', cid.toBaseEncodedString())
        recordDataCids[index] = cid
        cb()
      })
    })
  })
}

function crawler (acc, root) {
  const children = tree.children(root)
  if (children) {
    acc = acc.concat(crawler([], children[0])) // Left
    acc = acc.concat(crawler([], children[1])) // Right
  }
  return acc.concat(root)
}

function dumpNode (index, cb) {
  feed._storage.getNode(index, (err, node) => {
    if (err) return cb(err)
    console.log('Node', index, node)
    feed._storage.getSignature(index, (err, signature) => {
      if (err) {
        console.log('Sign', index, err.message)
      } else {
        console.log('Sign', index, signature)
      }
      if (index % 2 === 0) {
        // Leaf node
        const data = {
          index: index,
          hash: node.hash,
          size: node.size,
          leaf: {'/': recordDataCids[index / 2].toBaseEncodedString()}
        }
        const options = { format: 'dag-cbor', hashAlg: 'sha3-512' }
        ipfs.dag.put(data, options, (err, cid) => {
          if (err) return cb(err)
          nodeCids[index] = cid
          nodeSizes[index] = node.size
          console.log('CID:', cid.toBaseEncodedString())
          cb()
        })
      } else {
        // Branch node
        const [left, right] = tree.children(index)
        const data = {
          index: index,
          hash: node.hash,
          size: node.size,
          left: {'/': nodeCids[left].toBaseEncodedString()},
          right: {'/': nodeCids[right].toBaseEncodedString()}
        }
        const options = { format: 'dag-cbor', hashAlg: 'sha3-512' }
        ipfs.dag.put(data, options, (err, cid) => {
          if (err) return cb(err)
          nodeCids[index] = cid
          nodeSizes[index] = node.size
          console.log('CID:', cid.toBaseEncodedString())
          cb()
        })
      }
    })
  })
}

function dumpRoots (index, cb) {
  const roots = tree.fullRoots((index + 1) * 2)
  const data = {
    record: index,
    size: roots.reduce((acc, root) => {
      return acc + nodeSizes[root]
    }, 0),
    roots: roots.map(root => {
      return {
        root,
        link: { '/': nodeCids[root].toBaseEncodedString() }
      }
    })
  }
  const options = { format: 'dag-cbor', hashAlg: 'sha3-512' }
  ipfs.dag.put(data, options, (err, cid) => {
    if (err) return cb(err)
    console.log('Root CID:', cid.toBaseEncodedString())
    cb()
  })
}

