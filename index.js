const hypercore = require('hypercore')
const ram = require('random-access-memory')
const print = require('print-flat-tree')
const dagPB = require('ipld-dag-pb')
const ipfsAPI = require('ipfs-api')

const ipfs = new ipfsAPI('/ip4/127.0.0.1/tcp/5001')

const recordDataCids = []
const nodeCids = []
const signatureNodeCids = []

const feed = hypercore(ram)
feed.append('record a', err => {
  if (err) throw err
  feed.append('record b', err => {
    if (err) throw err
    dumpHypercore(feed, err => {
      if (err) throw err
      console.log('Done.')
    })
  })
})

function dumpHypercore (feed, cb) {
  dumpRecords(0, err => {
    if (err) return cb(err)
    dumpNodes(0, err => {
      console.log('Blocks:', feed.tree.blocks())
    })
  })
  
  function dumpRecords (index, cb) {
    if (index >= feed.length) return cb()
    dumpRecord(index, err => {
      if (err) return cb(err)
      dumpRecords(index + 1, cb)
    })
  }

  function dumpNodes (index, cb) {
    if (index >= feed.length * 2 + 1) return cb()
    dumpNode(index, err => {
      if (err) return cb(err)
      dumpNodes(index + 1, cb)
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
          console.log('CID:', cid.toBaseEncodedString())
          cb()
        })
      } else {
        cb()
      }
    })
  })
}

