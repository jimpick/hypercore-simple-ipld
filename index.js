const hypercore = require('hypercore')
const ram = require('random-access-memory')
const print = require('print-flat-tree')

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
  let index = 0
  dumpNext(err => {
    if (err) return cb(err)
    console.log(feed.tree.blocks())
    // console.log(print(feed.tree))
  })
  
  function dumpNext (cb) {
    if (index >= feed.length) return cb()
    dumpRecord(index, err => {
      if (err) return cb(err)
      index++
      dumpNext(cb)
    })
  }
}

function dumpRecord (index, cb) {
  feed.get(index, (err, data) => {
    if (err) return cb(err)
    console.log('Data', index, data.toString())
    feed._storage.getNode(index, (err, node) => {
      if (err) return cb(err)
      console.log('Node', index, node)
      feed._storage.getSignature(index, (err, signature) => {
        if (err) {
          console.log('Sign', index, err.message)
        } else {
          console.log('Sign', index, signature)
        }
        cb()
      })
    })
  })
}

